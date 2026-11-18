#!/usr/bin/env python3
"""The p2kit desk helper: serves the browser desk on 127.0.0.1 and applies its actions.

Started by the mod (hooks/server.ts) for the life of the module; standard library only.
Every action is shown first (POST /action returns a preview and its hash) and applied only
when the request carries that hash and the preview, computed again, still matches it.
It edits files of the projects listed in ~/.config/p2kit/projects.yaml, never commits,
and writes to a forge only through the CLI or token the user has already set up.

stdout, read by the mod: `listening <port>` once, then `changed <project path>` per write.
Each write also stamps ~/.claude/p2kit/desk-changed.json, so every session reads the forge again.
"""

import argparse
import hashlib
import json
import os
import re
import secrets
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

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

WP_ID = re.compile(r'^WP-\d{2,}$')
BRANCH = re.compile(r'^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$')
SHA = re.compile(r'^[0-9a-fA-F]{7,40}$')
PLAIN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9 _.,()/&+-]*$")
SPECIAL = re.compile(r'^([-+.\d]+|true|false|null|yes|no)$', re.I)
REF = re.compile(r'^(PR )?#(\d+)$')
# A status moves only along these edges: completing is the PM stating the Board's decision.
STATUS_FROM = {'completed': ('authorized', 'in-progress'), 'archived': ('completed',)}
HORIZONS = ('now', 'next', 'later', '')
NOTE_STATUS = ('open', 'closed')
LINK_KEYS = ('issue', 'milestone', 'branch')


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
        elif kind == 'wp-horizon':
            if value not in HORIZONS:
                raise ActionError('horizon is now, next or later')
            new_text, change = set_key(text, 'horizon', value or None)
            summary = f'Place {target} in {value.capitalize()}' if value else f'Take {target} off the roadmap'
        elif kind == 'wp-rank':
            if value not in ('', None) and not (isinstance(value, int) and not isinstance(value, bool) and 1 <= value <= 999):
                raise ActionError('rank is a number from 1')
            new_text, change = set_key(text, 'rank', None if value in ('', None) else str(value))
            summary = f'Rank {target} {value}' if value not in ('', None) else f'Drop the rank of {target}'
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
    """Assigning one team member to several issues or pull requests: each item with its assignees before and after; the closed
    ones and those the member already holds are left out, so one stale row does not block the rest."""
    numbers, login = request.get('numbers'), request.get('login')
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
        elif login.lower() in (a.lower() for a in before):
            skipped.append({'ref': ref, 'reason': f'{login} already assigned'})
        else:
            items.append({'ref': ref, 'number': number, 'title': item.get('title', ''), 'before': before, 'after': before + [login]})
    if not items:
        raise ActionError(f'nothing to assign: {", ".join(s["ref"] + " " + s["reason"] for s in skipped)}')
    return {
        'kind': 'assign-many', 'project': root, 'forge': f'{forge.host}/{forge.repo}',
        'summary': f'Assign {people[login]} to {len(items)} item' + ('s' if len(items) > 1 else ''),
        'items': items, 'skipped': skipped,
    }, forge


def apply_assign_many(preview, forge):
    """Patches the items in order, stopping at the first failure; says what was done."""
    done = []
    try:
        for item in preview['items']:
            forge.call('PATCH', f"repos/{forge.repo}/issues/{item['number']}", {'assignees': item['after']})
            done.append(f"{item['ref']} assignees: {', '.join(item['after'])}")
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

    def answer(self, status, body, content_type='application/json; charset=utf-8'):
        data = body if isinstance(body, bytes) else json.dumps(body).encode()
        self.send_response(status)
        self.send_header('Content-Type', content_type)
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
