#!/usr/bin/env python3
"""The p2kit desk helper: serves the browser desk on 127.0.0.1 and applies its actions.

Started by the mod (hooks/server.ts) for the life of the module; standard library only.
Every action is shown first (POST /action returns a preview and its hash) and applied only
when the request carries that hash and the preview, computed again, still matches it.
It edits files of the projects listed in ~/.config/p2kit/projects.yaml, never commits,
and writes to a forge only through the CLI or token the user has already set up.
GET /doc?path=<file> renders a project's Markdown document as an HTML page (server/doc_page.py).

stdout, read by the mod: `listening <port>` once, then `changed <project path>` per write.
Each write also stamps ~/.claude/p2kit/desk-changed.json, so every session reads the forge again.
"""

import argparse
import hashlib
import json
import math
import os
import re
import secrets
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from doc_page import document_page

DESK_DIR = '.claude/p2kit'
INFO_FILE = 'desk-server.json'
CHANGED_FILE = 'desk-changed.json'
REGISTRY = '.config/p2kit/projects.yaml'
FJ_KEYS = 'Library/Application Support/forgejo-cli.forgejo-cli/keys.json'
TOKEN_HEADER = 'X-P2kit-Token'
MAX_BODY = 64 * 1024
FORGE_TIMEOUT = 30
MAX_TITLE = 200
MAX_ISSUE_BODY = 20000
MAX_ASSIGN_MANY = 50
MAX_DOCUMENT = 2 * 1024 * 1024
# A rendered document loads no script and no frame: only its own inline style and images from the web.
DOC_POLICY = "default-src 'none'; style-src 'unsafe-inline'; img-src http: https: data:; frame-ancestors 'none'; base-uri 'none'"

WP_ID = re.compile(r'^WP-\d{2,}$')
BRANCH = re.compile(r'^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$')
SHA = re.compile(r'^[0-9a-fA-F]{7,40}$')
PLAIN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9 _.,()/&+-]*$")
SPECIAL = re.compile(r'^([-+.\d]+|true|false|null|yes|no)$', re.I)
REF = re.compile(r'^(PR )?#(\d+)$')
# A status moves only along these edges: completing is the PM stating the Board's decision.
STATUS_FROM = {'completed': ('authorized', 'in-progress'), 'archived': ('completed',)}
HORIZON_LABEL = {'now': 'Now', 'next': 'Next', 'later': 'Later'}
CLOSED = ('completed', 'archived', 'cancelled')
RANK = re.compile(r'^\d+(\.\d+)?$')
MAX_RANK = 999
NOTE_STATUS = ('open', 'closed')
LINK_KEYS = ('issue', 'milestone', 'branch')
ENTRY_ID = re.compile(r'^[A-Za-z0-9][A-Za-z0-9_.-]{0,49}$')
FLOW_LINE = re.compile(r'^(\s*-\s*\{)(.*)(\}\s*)$')
# A trailing note in brackets is no part of a person's name: `Finizio (Secretary)` is owner `Finizio`.
NAME_NOTE = re.compile(r'\s*\([^()]*\)\s*$')
MAX_LOG_OWNER = 50


class ActionError(Exception):
    """A refused action: the message is shown to the user as it is."""


# ---------------------------------------------------------------- YAML subset

def to_scalar(value):
    """A text as a scalar of the .pm/ YAML subset: plain when safe, else quoted; the subset has no escapes."""
    if '\n' in value or '\r' in value:
        raise ActionError('a value cannot span lines')
    # A plain scalar the reader would take for a number, a boolean or null is quoted.
    if PLAIN.match(value) and value.strip() == value and not SPECIAL.match(value):
        return value
    if "'" not in value:
        return "'" + value + "'"
    if '"' not in value:
        return '"' + value + '"'
    raise ActionError('a value cannot hold both kinds of quote')


def to_flow_scalar(value):
    """A text as a scalar inside a flow map or list: as to_scalar, and quoted when it holds a comma."""
    rendered = to_scalar(value)
    # A plain scalar never holds a quote (PLAIN), so a comma in it is quoted as it is.
    return "'" + rendered + "'" if ',' in rendered and rendered[0] not in '\'"' else rendered


def from_scalar(raw):
    raw = raw.strip()
    if len(raw) >= 2 and raw[0] == raw[-1] and raw[0] in '\'"':
        return raw[1:-1]
    return raw


def frontmatter_end(lines):
    """The index of the closing `---` of the frontmatter; the file must open with one."""
    if not lines or lines[0].rstrip('\n') != '---':
        raise ActionError('the file has no frontmatter')
    for index in range(1, len(lines)):
        if lines[index].rstrip('\n') == '---':
            return index
    raise ActionError('the frontmatter is not closed')


def key_lines(lines, end, key):
    pattern = re.compile(r'^' + re.escape(key) + r':(\s|$)')
    return [index for index in range(1, end) if pattern.match(lines[index])]


def read_key(text, key):
    lines = text.splitlines(keepends=True)
    found = key_lines(lines, frontmatter_end(lines), key)
    if len(found) > 1:
        raise ActionError(f'{key}: appears more than once')
    return from_scalar(lines[found[0]].split(':', 1)[1].split(' #', 1)[0]) if found else None


def set_key(text, key, rendered):
    """Sets one frontmatter key to an already rendered scalar, or removes it when `rendered` is None.

    Returns (new text, change) where change is {line, before, after}; refuses when the key is
    there more than once. A missing key is added just before the closing `---`.
    """
    lines = text.splitlines(keepends=True)
    end = frontmatter_end(lines)
    found = key_lines(lines, end, key)
    if len(found) > 1:
        raise ActionError(f'{key}: appears more than once')
    after = None if rendered is None else f'{key}: {rendered}\n'
    if found:
        index = found[0]
        before = lines[index]
        if after == before:
            raise ActionError(f'{key} is already {rendered}')
        if after is None:
            del lines[index]
        else:
            lines[index] = after
        return ''.join(lines), {'line': index + 1, 'before': before.rstrip('\n'), 'after': (after or '').rstrip('\n')}
    if after is None:
        raise ActionError(f'{key} is not set')
    lines.insert(end, after)
    return ''.join(lines), {'line': end + 1, 'before': '', 'after': after.rstrip('\n')}


def set_wp_status(text, wp, value):
    """Sets a work package `completed` or `archived`, refused off its edges."""
    status = read_key(text, 'status')
    if status not in STATUS_FROM[value]:
        raise ActionError(f'{wp} is {status}: only {" or ".join(STATUS_FROM[value])} becomes {value}')
    return set_key(text, 'status', value)


def note_field(line, key):
    """The value of `key` in a flow-map line, quotes dropped; None when absent."""
    match = re.search(r'\b' + re.escape(key) + r""":\s*('[^']*'|"[^"]*"|[^,}]*)""", line)
    return from_scalar(match.group(1)) if match else None


def set_note_status(text, sha, note_text, status):
    """Sets `status:` of the one note (a flow map line) whose sha and text are the given ones."""
    lines = text.splitlines(keepends=True)
    sha_field = re.compile(r'\bsha:\s*' + re.escape(sha) + r'\s*[,}]')
    found = [index for index, line in enumerate(lines) if sha_field.search(line) and note_field(line, 'text') == note_text]
    if not found:
        raise ActionError('note not found')
    if len(found) > 1:
        raise ActionError('more than one note matches')
    index = found[0]
    line = lines[index]
    fields = re.findall(r'\bstatus:\s*(open|closed)\b', line)
    if len(fields) != 1:
        raise ActionError('the note has no single status')
    if fields[0] == status:
        raise ActionError(f'the note is already {status}')
    after = re.sub(r'\bstatus:\s*(open|closed)\b', 'status: ' + status, line, count=1)
    lines[index] = after
    return ''.join(lines), {'line': index + 1, 'before': line.rstrip('\n'), 'after': after.rstrip('\n')}


def flow_items(body, keyed):
    """The items of a flow map's or flow list's body, commas inside quotes kept: [{key, start, end, value}] where start and end
    span the whole item and value is its scalar, quotes dropped. A quote opens a quoted scalar only where the scalar starts."""
    items, index, size = [], 0, len(body)
    while index < size:
        while index < size and body[index] == ' ':
            index += 1
        start, key = index, None
        if keyed:
            colon = body.find(':', index)
            if colon < 0:
                raise ActionError('not a flow map')
            key = body[index:colon].strip()
            index = colon + 1
            while index < size and body[index] == ' ':
                index += 1
        value_start = index
        if index < size and body[index] in '\'"':
            close = body.find(body[index], index + 1)
            if close < 0:
                raise ActionError('a quote is not closed')
            index = close + 1
        comma = body.find(',', index)
        index = size if comma < 0 else comma
        end = len(body[:index].rstrip())
        items.append({'key': key, 'start': start, 'end': end, 'value': from_scalar(body[value_start:end])})
        index += 1
    return items


def person_name(person):
    """A person of the roles as an owner names them: a trailing note in brackets dropped."""
    return NAME_NOTE.sub('', person).strip()


def set_log_owner(text, entry_id, owner):
    """Sets `owner:` of the one open action of the Daily Log (a flow-map line) whose id is entry_id, or removes it when owner
    is ''; every other field of the line stays as it is. A new owner goes before `due:` or `status:`, else last."""
    lines = text.splitlines(keepends=True)
    found = []
    for index, line in enumerate(lines):
        match = FLOW_LINE.match(line.rstrip('\n'))
        if match and re.search(r'\bid:\s*' + re.escape(entry_id) + r'\s*[,}]', line):
            fields = flow_items(match.group(2), True)
            if any(f['key'] == 'id' and f['value'] == entry_id for f in fields):
                found.append((index, match, fields))
    if not found:
        if re.search(r'^\s*-?\s*id:\s*' + re.escape(entry_id) + r'\s*$', text, re.M):
            raise ActionError(f'{entry_id} is not a one-line entry')
        raise ActionError(f'{entry_id} not found')
    if len(found) > 1:
        raise ActionError(f'more than one entry is {entry_id}')
    index, match, fields = found[0]
    value = {f['key']: f['value'] for f in fields}
    if value.get('kind') != 'action':
        raise ActionError(f'{entry_id} is not an action: only an action has an owner')
    status = value.get('status') or 'open'
    if status != 'open':
        raise ActionError(f'{entry_id} is {status}: only an open action is assigned')
    current = next((f for f in fields if f['key'] == 'owner'), None)
    held = current['value'] if current else ''
    if not owner and not held:
        raise ActionError(f'{entry_id} has no owner')
    if owner and person_name(held).lower() == owner.lower():
        raise ActionError(f'{entry_id} is already owned by {held}')
    body = match.group(2)
    if not owner:
        position = fields.index(current)
        cut_from = fields[position - 1]['end'] if position else current['start']
        cut_to = current['end'] if position else fields[1]['start'] if len(fields) > 1 else current['end']
        body = body[:cut_from] + body[cut_to:]
    elif current:
        body = body[:current['start']] + 'owner: ' + to_flow_scalar(owner) + body[current['end']:]
    else:
        before = next((f for f in fields if f['key'] in ('due', 'status')), None)
        if before:
            body = body[:before['start']] + 'owner: ' + to_flow_scalar(owner) + ', ' + body[before['start']:]
        else:
            body = body[:fields[-1]['end']] + ', owner: ' + to_flow_scalar(owner) + body[fields[-1]['end']:]
    line = lines[index]
    after = match.group(1) + body + match.group(3) + ('\n' if line.endswith('\n') else '')
    lines[index] = after
    return ''.join(lines), {'line': index + 1, 'before': line.rstrip('\n'), 'after': after.rstrip('\n')}


def place_fields(text):
    """Status, horizon and rank of a work package as the desk reads them: a horizon or a rank it does not take reads as none."""
    horizon = read_key(text, 'horizon') or ''
    rank = read_key(text, 'rank')
    return read_key(text, 'status') or 'draft', horizon if horizon in HORIZON_LABEL else '', float(rank) if rank and RANK.match(rank) else None


def place_wp(files, target, horizon, beside=None, side=None):
    """Places an open work package in a horizon, above or below `beside` or last; horizon '' takes it off the roadmap.

    files: {id: text} of every work package. The target keeps its rank when it fits between its new neighbours, else takes
    the first free one between them; a group with no room, a tie or a work package with no rank is renumbered 1..n.
    Returns {summary, files: [{id, text, changes}]}, the target first; refuses a move that changes nothing.
    """
    if not isinstance(horizon, str) or horizon not in HORIZON_LABEL and horizon != '':
        raise ActionError('horizon is now, next or later')
    if target not in files:
        raise ActionError(f'{target} not found')
    fields = {}
    for wp, text in files.items():
        try:
            fields[wp] = place_fields(text)
        except ActionError:
            if wp == target:
                raise
    status, current, rank = fields[target]
    if status in CLOSED:
        raise ActionError(f'{target} is {status}: only an open work package is placed')
    edits = {target: []}
    if not horizon:
        edits[target] = [(key, None) for key in ('horizon', 'rank') if read_key(files[target], key) is not None]
        if not edits[target]:
            raise ActionError(f'{target} is not placed')
        summary = f'Take {target} off the roadmap'
    else:
        label = HORIZON_LABEL[horizon]
        group = sorted((wp for wp, (s, h, _) in fields.items() if wp != target and s not in CLOSED and h == horizon),
                       key=lambda wp: (math.inf if fields[wp][2] is None else fields[wp][2], wp))
        if beside is None:
            index = len(group)
        elif beside == target:
            raise ActionError('a work package is not placed beside itself')
        elif beside not in group:
            raise ActionError(f'{beside} is not in {label}')
        elif side not in ('above', 'below'):
            raise ActionError('a work package goes above or below another one')
        else:
            index = group.index(beside) + (side == 'below')
        ranks = [fields[wp][2] for wp in group]
        low = ranks[index - 1] if index else 0
        high = ranks[index] if index < len(group) else MAX_RANK + 1
        ranked = None not in ranks and all(a < b for a, b in zip(ranks, ranks[1:]))
        if ranked and rank is not None and low < rank < high:
            ranking = {target: rank}
        elif ranked and math.floor(low) + 1 < high:
            ranking = {target: math.floor(low) + 1}
        else:
            ranking = {wp: n for n, wp in enumerate(group[:index] + [target] + group[index:], 1)}
        if current != horizon:
            edits[target].append(('horizon', horizon))
        if ranking[target] != rank:
            edits[target].append(('rank', str(ranking[target])))
        for wp in group:
            if wp in ranking and ranking[wp] != fields[wp][2]:
                edits[wp] = [('rank', str(ranking[wp]))]
        more = len(edits) - 1
        shown = int(ranking[target]) if ranking[target] == int(ranking[target]) else ranking[target]
        summary = f'Place {target} in {label} at rank {shown}' + (f', renumbering {more} more' if more else '')
    if not any(edits.values()):
        raise ActionError(f'{target} is already there')
    out = []
    for wp, keys in edits.items():
        text, changes = files[wp], []
        for key, rendered in keys:
            text, change = set_key(text, key, rendered)
            changes.append(change)
        out.append({'id': wp, 'text': text, 'changes': changes})
    return {'summary': summary, 'files': out}


# ---------------------------------------------------------------- projects

def registered_projects(home):
    path = os.path.join(home, REGISTRY)
    if not os.path.exists(path):
        return []
    found = []
    with open(path, encoding='utf-8') as handle:
        for line in handle:
            match = re.match(r'^\s*-\s*path:\s*(.+?)\s*$', line)
            if match:
                value = from_scalar(match.group(1))
                if value == '~' or value.startswith('~/'):
                    value = home + value[1:]
                found.append(os.path.realpath(value))
    return found


def project_root(home, path):
    """The project folder, only when the registry lists it: a request never names a folder of its own."""
    if not isinstance(path, str) or not path:
        raise ActionError('no project')
    real = os.path.realpath(path)
    if real not in registered_projects(home):
        raise ActionError('the project is not in projects.yaml')
    return real


def openable_path(home, path):
    """A file or folder inside a registered project, the only paths the desk opens; never a path of its own."""
    if not isinstance(path, str) or not path:
        raise ActionError('no path')
    real = os.path.realpath(path)
    if not any(real == root or real.startswith(root + os.sep) for root in registered_projects(home)):
        raise ActionError('the path is not inside a project of projects.yaml')
    if not os.path.exists(real):
        raise ActionError(f'{path} not found')
    return real


def open_path(home, path):
    """Opens a project's file or folder in its default application: a page served over http cannot follow a file:// link."""
    real = openable_path(home, path)
    command = 'open' if sys.platform == 'darwin' else 'xdg-open'
    subprocess.run([command, real], check=True, timeout=FORGE_TIMEOUT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    return {'opened': real}


class DocumentRefused(ActionError):
    def __init__(self, status, reason):
        super().__init__(reason)
        self.status = status


def readable_document(home, path):
    """A Markdown file inside a registered project, the only file /doc renders: 403 for any other path, 404 when missing."""
    if not isinstance(path, str) or not path or not os.path.isabs(path):
        raise DocumentRefused(403, 'not an absolute path')
    real = os.path.realpath(path)
    if not any(real.startswith(root + os.sep) for root in registered_projects(home)):
        raise DocumentRefused(403, 'the path is not inside a project of projects.yaml')
    if not real.lower().endswith('.md'):
        raise DocumentRefused(403, 'only Markdown documents are rendered')
    if not os.path.isfile(real):
        raise DocumentRefused(404, f'{path} not found')
    if os.path.getsize(real) > MAX_DOCUMENT:
        raise DocumentRefused(403, 'the document is too large to render')
    return real


def render_document(home, path):
    """The HTML page of a project's Markdown document."""
    real = readable_document(home, path)
    return document_page(real, read_text(real))


def read_text(path):
    with open(path, encoding='utf-8') as handle:
        return handle.read()


def file_hash(text):
    return hashlib.sha256(text.encode('utf-8')).hexdigest()


def wp_path(root, wp):
    if not isinstance(wp, str) or not WP_ID.match(wp):
        raise ActionError('not a work package id')
    path = os.path.join(root, '.pm', 'work-packages', wp + '.md')
    if not os.path.exists(path):
        raise ActionError(f'{wp} not found')
    return path


def current_stage(root):
    path = os.path.join(root, '.pm', 'project.yaml')
    text = read_text(path) if os.path.exists(path) else ''
    match = re.search(r'^stage:\s*\{[^}]*\bcurrent:\s*(\d+)', text, re.M) or re.search(r'^stage:\s*\n(?:\s+.*\n)*?\s+current:\s*(\d+)', text, re.M)
    return int(match.group(1)) if match else None


# ---------------------------------------------------------------- file actions

def plan_file_action(root, request):
    """The preview of a one-line edit: the file, the line before and after, the file's hash; and the new text."""
    kind = request.get('kind')
    target = request.get('target')
    value = request.get('value')
    if kind == 'note-status':
        path = os.path.join(root, '.pm', 'registers', 'commit-notes.yaml')
        if not os.path.exists(path):
            raise ActionError('no commit notes')
        if not isinstance(target, dict) or not SHA.match(str(target.get('sha', ''))) or not str(target.get('text', '')):
            raise ActionError('not a note')
        if value not in NOTE_STATUS:
            raise ActionError('a note is open or closed')
        text = read_text(path)
        new_text, change = set_note_status(text, target['sha'], target['text'], value)
        summary = f"{'Close' if value == 'closed' else 'Reopen'} the note on {target['sha'][:7]}"
    else:
        path = wp_path(root, target)
        text = read_text(path)
        if kind == 'wp-status':
            if value not in STATUS_FROM:
                raise ActionError('a work package is set completed or archived here')
            new_text, change = set_wp_status(text, target, value)
            summary = f'Set {target} {value}'
        elif kind == 'wp-link':
            field = request.get('field')
            if field not in LINK_KEYS:
                raise ActionError('a link is an issue, a milestone or a branch')
            if field == 'issue':
                if not (isinstance(value, int) and not isinstance(value, bool) and value > 0):
                    raise ActionError('an issue is a number')
                rendered = str(value)
            elif field == 'branch':
                if not isinstance(value, str) or not BRANCH.match(value) or '..' in value:
                    raise ActionError('not a branch name')
                rendered = value
            else:
                if not isinstance(value, str) or not value.strip():
                    raise ActionError('no milestone title')
                rendered = to_scalar(value.strip())
            new_text, change = set_key(text, field, rendered)
            summary = f'Link {target} to {field} {value}'
        else:
            raise ActionError('unknown action')
    preview = {
        'kind': kind, 'project': root, 'summary': summary,
        'file': os.path.relpath(path, root), 'fileHash': file_hash(text), 'changes': [change],
    }
    return preview, lambda: write_text(path, new_text)


def work_package_files(root):
    """{id: (path, text)} of the project's work packages: the id is the frontmatter's, else the file name's, as the desk reads it."""
    folder = os.path.join(root, '.pm', 'work-packages')
    found = {}
    for name in sorted(os.listdir(folder)) if os.path.isdir(folder) else []:
        if not name.endswith('.md'):
            continue
        path = os.path.join(folder, name)
        text = read_text(path)
        try:
            wp = read_key(text, 'id') or name[:-3]
        except ActionError:
            wp = name[:-3]
        found.setdefault(wp, (path, text))
    return found


def plan_place(root, request):
    """The preview of a drop in the Work packages tab: every file it changes; the hash covers every work package read."""
    target = request.get('target')
    if not isinstance(target, str) or not WP_ID.match(target):
        raise ActionError('not a work package id')
    beside = request.get('beside')
    if beside is not None and (not isinstance(beside, str) or not WP_ID.match(beside)):
        raise ActionError('not a work package id')
    found = work_package_files(root)
    placed = place_wp({wp: text for wp, (_, text) in found.items()}, target, request.get('horizon'), beside, request.get('side'))
    preview = {
        'kind': 'wp-place', 'project': root, 'summary': placed['summary'],
        'roadmapHash': file_hash(''.join(wp + text for wp, (_, text) in sorted(found.items()))),
        'files': [{'file': os.path.relpath(found[f['id']][0], root), 'fileHash': file_hash(found[f['id']][1]), 'changes': f['changes']}
                  for f in placed['files']],
    }
    return preview, lambda: [write_text(found[f['id']][0], f['text']) for f in placed['files']]


def write_text(path, text):
    temp = path + '.p2kit-tmp'
    with open(temp, 'w', encoding='utf-8') as handle:
        handle.write(text)
    os.replace(temp, path)


# ---------------------------------------------------------------- forge

def detect_forge(url):
    match = re.match(r'^[\w.-]+@([\w.-]+):([\w.-]+)/([\w.-]+?)(?:\.git)?/?$', url) or \
        re.match(r'^(?:ssh|https?)://(?:[^@/]+@)?([\w.-]+)(?::\d+)?/([\w.-]+)/([\w.-]+?)(?:\.git)?/?$', url)
    if not match:
        return None
    host = match.group(1).lower()
    return {'forge': 'github' if host == 'github.com' else 'forgejo', 'host': host, 'repo': f'{match.group(2)}/{match.group(3)}'}


class Forge:
    """GitHub through `gh api`, Forgejo through its REST API with the token `fj auth` saved."""

    def __init__(self, root, home):
        result = subprocess.run(['git', '-C', root, 'remote', 'get-url', 'origin'], capture_output=True, text=True, timeout=FORGE_TIMEOUT)
        target = detect_forge(result.stdout.strip()) if result.returncode == 0 else None
        if not target:
            raise ActionError('the project has no forge origin')
        self.forge, self.host, self.repo, self.home = target['forge'], target['host'], target['repo'], home

    def call(self, method, path, body=None):
        if self.forge == 'github':
            argv = ['gh', 'api', '-X', method, path] + (['--input', '-'] if body is not None else [])
            result = subprocess.run(argv, input=json.dumps(body) if body is not None else None, capture_output=True, text=True, timeout=FORGE_TIMEOUT)
            if result.returncode != 0:
                raise ActionError('gh: ' + (result.stderr.strip().splitlines() or [f'exit {result.returncode}'])[0])
            return json.loads(result.stdout) if result.stdout.strip() else None
        keys_path = os.path.join(self.home, FJ_KEYS)
        token = None
        if os.path.exists(keys_path):
            token = (json.loads(read_text(keys_path)).get('hosts', {}).get(self.host) or {}).get('token')
        if not token:
            raise ActionError(f'no fj token for {self.host}')
        data = json.dumps(body).encode() if body is not None else None
        request = urllib.request.Request(f'https://{self.host}/api/v1/{path}', data=data, method=method,
                                         headers={'Authorization': f'token {token}', 'Accept': 'application/json', 'Content-Type': 'application/json'})
        try:
            with urllib.request.urlopen(request, timeout=FORGE_TIMEOUT) as response:
                raw = response.read()
        except urllib.error.HTTPError as error:
            raise ActionError(f'{self.host}: HTTP {error.code}') from None
        except urllib.error.URLError as error:
            raise ActionError(f'{self.host}: {error.reason}') from None
        return json.loads(raw) if raw.strip() else None

    def milestones(self):
        found, page, size = [], 1, 100 if self.forge == 'github' else 50
        while True:
            query = f'per_page={size}' if self.forge == 'github' else f'limit={size}'
            batch = self.call('GET', f'repos/{self.repo}/milestones?state=all&{query}&page={page}') or []
            found += batch
            if len(batch) < size or page >= 20:
                return found
            page += 1

    def milestone_key(self, milestone):
        return milestone['number'] if self.forge == 'github' else milestone['id']

    def open_items(self, milestone):
        key = self.milestone_key(milestone)
        query = f'milestone={key}&state=open&per_page=100' if self.forge == 'github' else f'milestones={key}&state=open&limit=50'
        return self.call('GET', f'repos/{self.repo}/issues?{query}') or []


def item_ref(item):
    return ('PR #' if item.get('pull_request') is not None else '#') + str(item['number'])


def next_wp_id(root):
    folder = os.path.join(root, '.pm', 'work-packages')
    numbers = [int(m.group(1)) for name in (os.listdir(folder) if os.path.isdir(folder) else []) for m in [re.match(r'^WP-(\d+)\.md$', name)] if m]
    return f'WP-{(max(numbers) + 1) if numbers else 1:02d}'


def wp_carrying(root, title):
    folder = os.path.join(root, '.pm', 'work-packages')
    for name in sorted(os.listdir(folder)) if os.path.isdir(folder) else []:
        if re.match(r'^WP-\d+\.md$', name):
            try:
                if read_key(read_text(os.path.join(folder, name)), 'milestone') == title:
                    return name[:-3]
            except ActionError:
                continue
    return None


def wp_text(wp_id, title, stage, items):
    lines = ['---', f'id: {wp_id}', f'title: {to_scalar(title)}', 'product: work-package']
    if stage is not None:
        lines.append(f'stage: {stage}')
    lines += ['status: draft', f'milestone: {to_scalar(title)}', '---', '', f'# {title}', '']
    if items:
        lines += ['Packaged items:', ''] + [f"- {item['ref']} {item['title']}" for item in items]
    return '\n'.join(lines) + '\n'


def plan_package(root, home, request, forge=None):
    """The plan of a package: the milestone to create or reuse, the items to assign, the work package to write."""
    title = request.get('title')
    if not isinstance(title, str) or not title.strip() or len(title) > 80:
        raise ActionError('the package needs a short title')
    title = title.strip()
    to_scalar(title)
    refs = request.get('refs') or []
    if not isinstance(refs, list) or not all(isinstance(ref, str) and REF.match(ref) for ref in refs):
        raise ActionError('references are #<n> or PR #<n>')
    forge = forge or Forge(root, home)
    milestones = forge.milestones()
    existing = next((m for m in milestones if m.get('title') == title), None)
    if request.get('fromMilestone') and not existing:
        raise ActionError(f'milestone {title} not found')
    assign, others, skipped = [], [], []
    for ref in refs:
        number = int(REF.match(ref).group(2))
        try:
            item = forge.call('GET', f'repos/{forge.repo}/issues/{number}')
        except ActionError as error:
            skipped.append({'ref': ref, 'reason': str(error)})
            continue
        if item.get('state') != 'open':
            skipped.append({'ref': ref, 'reason': 'closed'})
            continue
        current = (item.get('milestone') or {}).get('title') or ''
        entry = {'ref': item_ref(item), 'number': number, 'title': item.get('title', ''), 'milestone': current}
        if current == title:
            skipped.append({'ref': ref, 'reason': 'already in the milestone'})
        elif current:
            others.append(entry)
        else:
            assign.append(entry)
    listed = assign + others
    if request.get('fromMilestone'):
        listed = [{'ref': item_ref(i), 'number': i['number'], 'title': i.get('title', ''), 'milestone': title} for i in forge.open_items(existing)]
    if not request.get('fromMilestone') and not listed:
        raise ActionError('no open item to package')
    reused = wp_carrying(root, title)
    if request.get('fromMilestone') and reused:
        raise ActionError(f'{reused} already carries milestone {title}')
    wp = {'action': 'reuse', 'id': reused} if reused else {'action': 'create', 'id': next_wp_id(root)}
    if not reused:
        wp['file'] = os.path.join('.pm', 'work-packages', wp['id'] + '.md')
        wp['text'] = wp_text(wp['id'], title, current_stage(root), listed)
    return {
        'kind': 'package', 'project': root, 'forge': f'{forge.host}/{forge.repo}',
        'summary': f'Package {title}',
        'milestone': {'title': title, 'action': 'reuse' if existing else 'create', 'closed': bool(existing and existing.get('state') == 'closed')},
        'assign': assign, 'others': others, 'skipped': skipped, 'wp': wp,
    }, forge, existing


def team_logins(root):
    """login → person of `team.people` in .pm/project.yaml, the block form the schema documents."""
    path = os.path.join(root, '.pm', 'project.yaml')
    lines = read_text(path).splitlines() if os.path.exists(path) else []
    found, section, people_indent = {}, None, 0
    for line in lines:
        bare = line.split(' #', 1)[0].rstrip()
        if not bare.strip() or bare.lstrip().startswith('#'):
            continue
        indent = len(bare) - len(bare.lstrip())
        if indent == 0:
            section = 'team' if re.match(r'^team:\s*$', bare) else None
        elif section == 'team' and re.match(r'^\s+people:\s*$', bare):
            section, people_indent = 'people', indent
        elif section == 'people':
            if indent <= people_indent:
                section = 'team'
                continue
            match = re.match(r'^\s+(.+?):\s*\{(.*)\}\s*$', bare)
            login = note_field('{' + match.group(2) + '}', 'login') if match else None
            if login:
                found[login.strip()] = from_scalar(match.group(1))
    return found


def project_people(root):
    """The people of .pm/project.yaml as an owner names them: those of `roles` (a name, a flow list or a block list per role),
    then the keys of `team.people`; each once, case aside, a trailing note in brackets dropped."""
    path = os.path.join(root, '.pm', 'project.yaml')
    lines = read_text(path).splitlines() if os.path.exists(path) else []
    names, section, people_indent, person_indent = [], None, 0, None
    for line in lines:
        bare = line.split(' #', 1)[0].rstrip()
        if not bare.strip() or bare.lstrip().startswith('#'):
            continue
        indent = len(bare) - len(bare.lstrip())
        if indent == 0:
            section = 'roles' if re.match(r'^roles:\s*$', bare) else 'team' if re.match(r'^team:\s*$', bare) else None
        elif section == 'roles':
            match = re.match(r'^\s+[A-Za-z_]+:\s*(.*)$', bare)
            item = re.match(r'^\s+-\s+(.+)$', bare)
            if match and match.group(1).startswith('['):
                names += [one['value'] for one in flow_items(match.group(1).strip()[1:-1], False)]
            elif match and match.group(1):
                names.append(from_scalar(match.group(1)))
            elif item:
                names.append(from_scalar(item.group(1)))
        elif section == 'team' and re.match(r'^\s+people:\s*$', bare):
            section, people_indent, person_indent = 'people', indent, None
        elif section == 'people':
            if indent <= people_indent:
                section = 'team'
                continue
            person_indent = person_indent or indent
            match = re.match(r'^\s+(.+?):(\s|$)', bare)
            if indent == person_indent and match:
                names.append(from_scalar(match.group(1)))
    people, seen = [], set()
    for name in (person_name(one) for one in names):
        if name and name.lower() not in seen:
            seen.add(name.lower())
            people.append(name)
    return people


def plan_log_owner(root, request):
    """The preview of assigning one person to open actions of the Daily Log, or of removing their owner (owner ''): the lines
    before and after, and the actions left out with the reason."""
    ids, owner = request.get('ids'), request.get('owner')
    if not isinstance(ids, list) or not ids or len(ids) > MAX_LOG_OWNER or not all(isinstance(one, str) and ENTRY_ID.match(one) for one in ids):
        raise ActionError(f'pick from 1 to {MAX_LOG_OWNER} actions')
    if not isinstance(owner, str):
        raise ActionError('an owner is a name')
    if owner:
        owner = next((one for one in project_people(root) if one.lower() == owner.strip().lower()), None)
        if owner is None:
            raise ActionError(f"{request.get('owner')} is no person of roles or team.people in .pm/project.yaml")
    path = os.path.join(root, '.pm', 'registers', 'daily-log.yaml')
    if not os.path.exists(path):
        raise ActionError('no daily log')
    text = read_text(path)
    new_text, changes, done, skipped = text, [], [], []
    for entry_id in dict.fromkeys(ids):
        try:
            new_text, change = set_log_owner(new_text, entry_id, owner)
            changes.append(change)
            done.append(entry_id)
        except ActionError as error:
            skipped.append({'ref': entry_id, 'reason': str(error)})
    if not changes:
        raise ActionError(f"nothing to {'assign' if owner else 'unassign'}: {'; '.join(s['reason'] for s in skipped)}")
    done = ', '.join(done)
    preview = {
        'kind': 'log-owner', 'project': root, 'summary': f'Assign {owner} to {done}' if owner else f'Remove the owner of {done}',
        'file': os.path.relpath(path, root), 'fileHash': file_hash(text), 'changes': changes, 'skipped': skipped,
    }
    return preview, lambda: write_text(path, new_text)


def plan_assign(root, home, request, forge=None):
    """The change of the assignees of one issue or pull request: who, before and after, as the forge has it now."""
    number, login, op = request.get('number'), request.get('login'), request.get('op')
    if not (isinstance(number, int) and not isinstance(number, bool) and number > 0):
        raise ActionError('an issue or pull request is a number')
    if op not in ('add', 'remove'):
        raise ActionError('op is add or remove')
    people = team_logins(root)
    if not isinstance(login, str) or login not in people:
        raise ActionError(f'{login} is not a login of team.people in .pm/project.yaml')
    forge = forge or Forge(root, home)
    item = forge.call('GET', f'repos/{forge.repo}/issues/{number}')
    ref = item_ref(item)
    if item.get('state') != 'open':
        raise ActionError(f'{ref} is closed')
    before = [a['login'] for a in item.get('assignees') or [] if a.get('login')]
    held = login.lower() in (a.lower() for a in before)
    if op == 'add' and held:
        raise ActionError(f'{login} is already assigned to {ref}')
    if op == 'remove' and not held:
        raise ActionError(f'{login} is not assigned to {ref}')
    after = before + [login] if op == 'add' else [a for a in before if a.lower() != login.lower()]
    return {
        'kind': 'assign', 'project': root, 'forge': f'{forge.host}/{forge.repo}',
        'summary': f'Assign {people[login]} to {ref}' if op == 'add' else f'Unassign {people[login]} from {ref}',
        'item': {'ref': ref, 'number': number, 'title': item.get('title', ''), 'kind': 'pr' if item.get('pull_request') is not None else 'issue'},
        'before': before, 'after': after,
    }, forge


def apply_assign(preview, forge):
    forge.call('PATCH', f"repos/{forge.repo}/issues/{preview['item']['number']}", {'assignees': preview['after']})
    return [f"{preview['item']['ref']} assignees: {', '.join(preview['after']) or 'none'}"]


def plan_assign_many(root, home, request, forge=None):
    """Assigning one team member to several issues or pull requests, or unassigning them (op add or remove, add by default):
    each item with its assignees before and after; the closed ones, and those the member already holds (add) or does not hold
    (remove), are left out, so one stale row does not block the rest."""
    numbers, login, op = request.get('numbers'), request.get('login'), request.get('op', 'add')
    if op not in ('add', 'remove'):
        raise ActionError('op is add or remove')
    if not isinstance(numbers, list) or not numbers or len(numbers) > MAX_ASSIGN_MANY:
        raise ActionError(f'pick from 1 to {MAX_ASSIGN_MANY} issues or pull requests')
    if not all(isinstance(n, int) and not isinstance(n, bool) and n > 0 for n in numbers):
        raise ActionError('an issue or pull request is a number')
    people = team_logins(root)
    if not isinstance(login, str) or login not in people:
        raise ActionError(f'{login} is not a login of team.people in .pm/project.yaml')
    forge = forge or Forge(root, home)
    items, skipped = [], []
    for number in dict.fromkeys(numbers):
        item = forge.call('GET', f'repos/{forge.repo}/issues/{number}')
        ref = item_ref(item)
        before = [a['login'] for a in item.get('assignees') or [] if a.get('login')]
        if item.get('state') != 'open':
            skipped.append({'ref': ref, 'reason': 'closed'})
        elif op == 'add' and login.lower() in (a.lower() for a in before):
            skipped.append({'ref': ref, 'reason': f'{login} already assigned'})
        elif op == 'remove' and login.lower() not in (a.lower() for a in before):
            skipped.append({'ref': ref, 'reason': f'{login} not assigned'})
        else:
            after = before + [login] if op == 'add' else [a for a in before if a.lower() != login.lower()]
            items.append({'ref': ref, 'number': number, 'title': item.get('title', ''), 'before': before, 'after': after})
    if not items:
        raise ActionError(f'nothing to {"assign" if op == "add" else "unassign"}: {", ".join(s["ref"] + " " + s["reason"] for s in skipped)}')
    count = f'{len(items)} item' + ('s' if len(items) > 1 else '')
    return {
        'kind': 'assign-many', 'project': root, 'forge': f'{forge.host}/{forge.repo}',
        'summary': f'Assign {people[login]} to {count}' if op == 'add' else f'Unassign {people[login]} from {count}',
        'items': items, 'skipped': skipped,
    }, forge


def apply_assign_many(preview, forge):
    """Patches the items in order, stopping at the first failure; says what was done."""
    done = []
    try:
        for item in preview['items']:
            forge.call('PATCH', f"repos/{forge.repo}/issues/{item['number']}", {'assignees': item['after']})
            done.append(f"{item['ref']} assignees: {', '.join(item['after']) or 'none'}")
    except ActionError as error:
        raise ActionError(f"{error} — done before it: {', '.join(done) or 'nothing'}") from None
    return done


def plan_issue_milestone(root, home, request, forge=None):
    """Attaching one issue or pull request to the milestone of a work package: the item, its milestone now and the new one.

    A work package without `milestone:` gets one named after its title: created on the forge, or the one already carrying that
    title reused, and written in the work package's frontmatter; `link` carries that file edit, None otherwise.
    """
    number, wp = request.get('number'), request.get('wp')
    if not (isinstance(number, int) and not isinstance(number, bool) and number > 0):
        raise ActionError('an issue or pull request is a number')
    path = wp_path(root, wp)
    text = read_text(path)
    title, link = read_key(text, 'milestone'), None
    if not title:
        title = (read_key(text, 'title') or '').strip()
        if not title:
            raise ActionError(f'{wp} has no milestone and no title to name one after')
        _, change = set_key(text, 'milestone', to_scalar(title))
        link = {'file': os.path.relpath(path, root), 'fileHash': file_hash(text), 'change': change}
    forge = forge or Forge(root, home)
    milestone = next((m for m in forge.milestones() if m.get('title') == title), None)
    if not milestone and not link:
        raise ActionError(f'milestone {title} of {wp} is not on {forge.host}/{forge.repo}')
    item = forge.call('GET', f'repos/{forge.repo}/issues/{number}')
    ref = item_ref(item)
    if item.get('state') != 'open':
        raise ActionError(f'{ref} is closed')
    before = (item.get('milestone') or {}).get('title') or ''
    if before == title:
        raise ActionError(f'{ref} is already in milestone {title}' + (f': link it to {wp} with /pm-link' if link else ''))
    if link:
        summary = f"Attach {ref} to {wp} — {'reuse' if milestone else 'create'} milestone {title}"
    else:
        summary = f'Move {ref} from {before} to {title} ({wp})' if before else f'Attach {ref} to {title} ({wp})'
    return {
        'kind': 'issue-milestone', 'project': root, 'forge': f'{forge.host}/{forge.repo}', 'wp': wp, 'summary': summary,
        'item': {'ref': ref, 'number': number, 'title': item.get('title', ''), 'kind': 'pr' if item.get('pull_request') is not None else 'issue'},
        'before': before,
        'milestone': {'title': title, 'key': forge.milestone_key(milestone) if milestone else None,
                      'closed': bool(milestone) and milestone.get('state') == 'closed', 'action': 'reuse' if milestone else 'create'},
        'link': link,
    }, forge


def apply_issue_milestone(root, preview, forge):
    """Creates the milestone when planned, attaches the item, writes the work package's `milestone:`; stops at the first failure."""
    done, key = [], preview['milestone']['key']
    try:
        if key is None:
            created = forge.call('POST', f'repos/{forge.repo}/milestones', {'title': preview['milestone']['title']})
            key = forge.milestone_key(created)
            done.append(f"milestone {preview['milestone']['title']} created")
        forge.call('PATCH', f"repos/{forge.repo}/issues/{preview['item']['number']}", {'milestone': key})
        done.append(f"{preview['item']['ref']} in milestone {preview['milestone']['title']}")
        if preview['link']:
            path = os.path.join(root, preview['link']['file'])
            text = read_text(path)
            if file_hash(text) != preview['link']['fileHash']:
                raise ActionError(f"{preview['link']['file']} changed since the preview")
            write_text(path, set_key(text, 'milestone', to_scalar(preview['milestone']['title']))[0])
            done.append(f"{preview['wp']} linked to milestone {preview['milestone']['title']}")
    except ActionError as error:
        raise ActionError(f"{error} — done before it: {', '.join(done) or 'nothing'}") from None
    return done


def plan_issue_create(root, home, request, forge=None):
    """A new issue: its title and body, the milestone of a work package and a team member to assign, all optional but the title."""
    title, body, wp, login = request.get('title'), request.get('body', ''), request.get('wp') or '', request.get('login') or ''
    if not isinstance(title, str) or not title.strip() or len(title.strip()) > MAX_TITLE or '\n' in title:
        raise ActionError(f'the issue needs a title of one line, at most {MAX_TITLE} characters')
    if not isinstance(body, str) or len(body) > MAX_ISSUE_BODY:
        raise ActionError(f'the body is text of at most {MAX_ISSUE_BODY} characters')
    people = team_logins(root)
    if login and (not isinstance(login, str) or login not in people):
        raise ActionError(f'{login} is not a login of team.people in .pm/project.yaml')
    milestone_title = read_key(read_text(wp_path(root, wp)), 'milestone') if wp else None
    if wp and not milestone_title:
        raise ActionError(f'{wp} has no milestone: link one with /pm-link, or create the issue without a work package')
    forge = forge or Forge(root, home)
    milestone = None
    if milestone_title:
        found = next((m for m in forge.milestones() if m.get('title') == milestone_title), None)
        if not found:
            raise ActionError(f'milestone {milestone_title} of {wp} is not on {forge.host}/{forge.repo}')
        milestone = {'title': milestone_title, 'key': forge.milestone_key(found), 'closed': found.get('state') == 'closed'}
    return {
        'kind': 'issue-create', 'project': root, 'forge': f'{forge.host}/{forge.repo}', 'wp': wp,
        'summary': f'Create issue {title.strip()}',
        'issue': {'title': title.strip(), 'body': body.strip()}, 'milestone': milestone,
        'assignee': {'login': login, 'person': people[login]} if login else None,
    }, forge


def apply_issue_create(preview, forge):
    payload = dict(preview['issue'])
    if preview['milestone']:
        payload['milestone'] = preview['milestone']['key']
    if preview['assignee']:
        payload['assignees'] = [preview['assignee']['login']]
    created = forge.call('POST', f'repos/{forge.repo}/issues', payload) or {}
    return [f"#{created.get('number', '?')} created" + (f" in {preview['milestone']['title']}" if preview['milestone'] else '')
            + (f", assigned to {preview['assignee']['person']}" if preview['assignee'] else '')]


def apply_package(root, preview, forge, existing, move):
    """Writes the plan, stopping at the first failure; says what was done."""
    done = []
    try:
        milestone = existing
        if not milestone:
            milestone = forge.call('POST', f'repos/{forge.repo}/milestones', {'title': preview['milestone']['title']})
            done.append(f"milestone {preview['milestone']['title']} created")
        key = forge.milestone_key(milestone)
        for item in preview['assign'] + [o for o in preview['others'] if o['ref'] in move]:
            forge.call('PATCH', f"repos/{forge.repo}/issues/{item['number']}", {'milestone': key})
            done.append(f"{item['ref']} assigned")
        if preview['wp']['action'] == 'create':
            path = os.path.join(root, preview['wp']['file'])
            if os.path.exists(path):
                raise ActionError(f"{preview['wp']['file']} exists already")
            write_text(path, preview['wp']['text'])
            done.append(f"{preview['wp']['id']} written")
    except ActionError as error:
        raise ActionError(f"{error} — done before it: {', '.join(done) or 'nothing'}") from None
    return done


# ---------------------------------------------------------------- actions

def preview_hash(preview):
    return hashlib.sha256(json.dumps(preview, sort_keys=True).encode()).hexdigest()


def run_action(home, request, forge=None):
    """Preview an action; with `confirm` equal to the preview's hash, apply it. Returns the answer and whether a file changed."""
    if not isinstance(request, dict):
        raise ActionError('not an action')
    root = project_root(home, request.get('project'))
    # The desk reads .pm/ from git when the checkout has none: such a project is shown, never written.
    if not os.path.isdir(os.path.join(root, '.pm')):
        raise ActionError('the checkout has no .pm/: the project is read-only until it does')
    if request.get('kind') == 'assign':
        preview, forge = plan_assign(root, home, request, forge)
        apply = lambda: apply_assign(preview, forge)
    elif request.get('kind') == 'assign-many':
        preview, forge = plan_assign_many(root, home, request, forge)
        apply = lambda: apply_assign_many(preview, forge)
    elif request.get('kind') == 'issue-milestone':
        preview, forge = plan_issue_milestone(root, home, request, forge)
        apply = lambda: apply_issue_milestone(root, preview, forge)
    elif request.get('kind') == 'issue-create':
        preview, forge = plan_issue_create(root, home, request, forge)
        apply = lambda: apply_issue_create(preview, forge)
    elif request.get('kind') == 'package':
        preview, forge, existing = plan_package(root, home, request, forge)
        apply = lambda: apply_package(root, preview, forge, existing, request.get('move') or [])
    elif request.get('kind') == 'wp-place':
        preview, write = plan_place(root, request)
        apply = lambda: (write(), ['written'])[1]
    elif request.get('kind') == 'log-owner':
        preview, write = plan_log_owner(root, request)
        apply = lambda: (write(), ['written'])[1]
    else:
        preview, write = plan_file_action(root, request)
        apply = lambda: (write(), ['written'])[1]
    digest = preview_hash(preview)
    confirm = request.get('confirm')
    if confirm is None:
        return {'preview': preview, 'hash': digest}, False
    if confirm != digest:
        raise ActionError('changed since the preview: look at it again')
    return {'applied': True, 'done': apply(), 'summary': preview['summary']}, True


# ---------------------------------------------------------------- server

class Handler(BaseHTTPRequestHandler):
    server_version = 'p2kit-desk'

    def log_message(self, format, *args):
        sys.stderr.write('p2kit desk: ' + (format % args) + '\n')

    def allowed_hosts(self):
        port = self.server.server_address[1]
        return {f'127.0.0.1:{port}', f'localhost:{port}'}

    def answer(self, status, body, content_type='application/json; charset=utf-8', headers=None):
        data = body if isinstance(body, bytes) else json.dumps(body).encode()
        self.send_response(status)
        self.send_header('Content-Type', content_type)
        for name, value in (headers or {}).items():
            self.send_header(name, value)
        self.send_header('Content-Length', str(len(data)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Referrer-Policy', 'no-referrer')
        self.end_headers()
        self.wfile.write(data)

    def refuse(self, status, reason):
        self.answer(status, {'error': reason})

    def do_GET(self):
        # A Host other than ours is a DNS-rebinding page reading the desk: refused.
        if self.headers.get('Host') not in self.allowed_hosts():
            return self.refuse(403, 'host')
        desk = os.path.join(self.server.home, DESK_DIR)
        if self.path in ('/', '/index.html') or self.path.startswith('/?') or self.path.startswith('/#'):
            path = os.path.join(desk, 'desk.html')
            if not os.path.exists(path):
                return self.refuse(404, 'the desk is not written yet')
            page = read_text(path)
            inject = '<script>window.P2KIT_SERVER = ' + json.dumps({'token': self.server.token}) + '</script>\n'
            page = page.replace('<script type="application/json" id="data">', inject + '<script type="application/json" id="data">', 1)
            return self.answer(200, page.encode('utf-8'), 'text/html; charset=utf-8')
        if self.path.split('?')[0] == '/desk.json':
            path = os.path.join(desk, 'desk.json')
            return self.answer(200, read_text(path).encode('utf-8')) if os.path.exists(path) else self.refuse(404, 'no snapshot')
        if self.path == '/health':
            return self.answer(200, {'ok': True, 'pid': os.getpid()})
        # A document of a project, rendered from Markdown: a read, like the page, so it needs our Host and no token.
        url = urllib.parse.urlsplit(self.path)
        if url.path == '/doc':
            paths = urllib.parse.parse_qs(url.query).get('path') or ['']
            try:
                page = render_document(self.server.home, paths[0])
            except DocumentRefused as error:
                return self.refuse(error.status, str(error))
            except (ValueError, OSError) as error:
                return self.refuse(500, f'{type(error).__name__}: {error}')
            return self.answer(200, page.encode('utf-8'), 'text/html; charset=utf-8', {'Content-Security-Policy': DOC_POLICY})
        return self.refuse(404, 'not found')

    def do_POST(self):
        port = self.server.server_address[1]
        if self.headers.get('Host') not in self.allowed_hosts():
            return self.refuse(403, 'host')
        # Any site can post to 127.0.0.1: only our own page, carrying the token it was served, acts.
        if self.headers.get('Origin') not in (f'http://127.0.0.1:{port}', f'http://localhost:{port}'):
            return self.refuse(403, 'origin')
        if not secrets.compare_digest(self.headers.get(TOKEN_HEADER, ''), self.server.token):
            return self.refuse(403, 'token')
        if (self.headers.get('Content-Type') or '').split(';')[0].strip() != 'application/json':
            return self.refuse(415, 'json only')
        if self.path not in ('/action', '/open'):
            return self.refuse(404, 'not found')
        length = int(self.headers.get('Content-Length') or 0)
        if length <= 0 or length > MAX_BODY:
            return self.refuse(413, 'body size')
        try:
            request = json.loads(self.rfile.read(length))
            if self.path == '/open':
                return self.answer(200, open_path(self.server.home, request.get('path') if isinstance(request, dict) else None))
            with self.server.lock:
                result, changed = run_action(self.server.home, request)
        except ActionError as error:
            return self.refuse(409, str(error))
        except (ValueError, OSError, subprocess.SubprocessError) as error:
            return self.refuse(500, f'{type(error).__name__}: {error}')
        if changed:
            mark_changed(self.server.home, request['project'])
            print('changed ' + request['project'], flush=True)
        return self.answer(200, result)


def make_server(home, port=0):
    server = ThreadingHTTPServer(('127.0.0.1', port), Handler)
    server.home = home
    server.token = secrets.token_urlsafe(32)
    server.lock = threading.Lock()
    return server


def write_info(home, server):
    folder = os.path.join(home, DESK_DIR)
    os.makedirs(folder, exist_ok=True)
    path = os.path.join(folder, INFO_FILE)
    descriptor = os.open(path + '.tmp', os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(descriptor, 'w') as handle:
        json.dump({'port': server.server_address[1], 'pid': os.getpid()}, handle)
    os.replace(path + '.tmp', path)


def mark_changed(home, project):
    """Stamps the last write, `{ at, project }` with `at` in epoch ms: a session whose read is older reads the forge again."""
    folder = os.path.join(home, DESK_DIR)
    os.makedirs(folder, exist_ok=True)
    path = os.path.join(folder, CHANGED_FILE)
    with open(path + '.tmp', 'w') as handle:
        json.dump({'at': int(time.time() * 1000), 'project': project}, handle)
    os.replace(path + '.tmp', path)


def main():
    parser = argparse.ArgumentParser(description='p2kit desk helper')
    parser.add_argument('--home', default=os.path.expanduser('~'))
    parser.add_argument('--port', type=int, default=0)
    args = parser.parse_args()
    server = make_server(args.home, args.port)
    write_info(args.home, server)
    print(f'listening {server.server_address[1]}', flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == '__main__':
    main()
