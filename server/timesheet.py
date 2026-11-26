#!/usr/bin/env python3
"""Crystallizes a day of the local time log into a project's timesheet (docs/pm-schema.md → Timesheets).

Run by /pm-log, from the project's repo:

  python3 timesheet.py show  --project <root> [--date <yyyy-mm-dd>] [--login <login>]
  python3 timesheet.py write --project <root> --hash <hash> [--date …] [--login …] [--replace]
  python3 timesheet.py push  --project <root> [--date …] [--login …]

`show` prints, as JSON, the day's lines per issue and kind with their work package, the overlaps it resolved and the
hash of that draft; `write` writes the same lines to `.pm/timesheets/<login>/<yyyy-mm>.yaml` only while the draft
still has that hash; `push` adds the day's issue lines to the issues' tracked times on Forgejo and marks them sent.
The time log is read across every project, so time counted on one project is never counted again on another.
Standard library only; nothing is committed.
"""

import argparse
import hashlib
import json
import os
import re
import sys

import desk_server as ds
import timelog

TIMESHEETS = os.path.join('.pm', 'timesheets')
LOGIN = re.compile(r'^[A-Za-z0-9][A-Za-z0-9_.-]{0,38}$')
LINE_DATE = re.compile(r'\bdate:\s*([0-9]{4}-[0-9]{2}-[0-9]{2})\b')
HEADER = '# Time crystallized by /pm-log from the local time log (docs/pm-schema.md → Timesheets).\nentries:\n'


class TimesheetError(Exception):
    """A refused request: the message is shown to the user as it is."""


def winner(intervals, active):
    """Of the intervals running at once (indexes), the one the time goes to: one on an issue before one on the project, then the latest started."""
    return max(active, key=lambda index: (intervals[index].get('ref') is not None, intervals[index]['start'], index))


def resolve_day(intervals, day):
    """Cuts the day's intervals where they overlap and gives each piece to one interval.

    Returns the seconds per interval index, and the overlaps as `{from, to, kept, dropped}` (minutes on the dropped ones).
    """
    start_of_day, end_of_day = timelog.day_bounds(day)
    clipped = [(index, max(one['start'], start_of_day), min(one['end'], end_of_day)) for index, one in enumerate(intervals)]
    clipped = [piece for piece in clipped if piece[1] < piece[2]]
    cuts = sorted({moment for _, start, end in clipped for moment in (start, end)})
    seconds, overlaps = {}, []
    for left, right in zip(cuts, cuts[1:]):
        active = [index for index, start, end in clipped if start <= left and end >= right]
        if not active:
            continue
        kept = winner(intervals, active)
        seconds[kept] = seconds.get(kept, 0) + (right - left).total_seconds()
        if len(active) > 1:
            overlaps.append({'from': timelog.iso(left), 'to': timelog.iso(right), 'kept': kept, 'dropped': [index for index in active if index != kept]})
    return seconds, overlaps


def label(interval):
    where = interval.get('remote') or interval.get('project') or 'no project'
    return f"{where} {interval.get('ref') or ''} {interval.get('kind', '')} ({interval.get('source', '?')})".replace('  ', ' ')


def wp_links(root):
    """Per work package id, its `issue:` (a number or None) and `milestone:` from the frontmatter."""
    folder = os.path.join(root, '.pm', 'work-packages')
    links = {}
    for name in sorted(os.listdir(folder)) if os.path.isdir(folder) else []:
        if not re.match(r'^WP-\d{2,}\.md$', name):
            continue
        text = ds.read_text(os.path.join(folder, name))
        try:
            issue, milestone = ds.read_key(text, 'issue'), ds.read_key(text, 'milestone')
        except ds.ActionError:
            continue
        links[name[:-3]] = {'issue': int(issue) if issue and issue.isdigit() else None, 'milestone': milestone or None}
    return links


def wp_of(number, links, forge):
    """The work package of an issue: the one linking it by `issue:`, else the one carrying its milestone (asked of the forge)."""
    for wp, link in links.items():
        if link['issue'] == number:
            return wp
    if forge is None:
        return None
    try:
        found = forge.call('GET', f'repos/{forge.repo}/issues/{number}')
    except ds.ActionError:
        return None
    title = ((found or {}).get('milestone') or {}).get('title')
    return next((wp for wp, link in links.items() if title and link['milestone'] == title), None)


def get_forge(root, home):
    try:
        return ds.Forge(root, home)
    except ds.ActionError:
        return None


def get_login(forge, login):
    """The login the timesheet is filed under: the one given, else the forge's own user."""
    if login is None and forge is not None:
        try:
            login = (forge.call('GET', 'user') or {}).get('login')
        except ds.ActionError:
            login = None
    if not login:
        raise TimesheetError('no login: pass --login (the project has no forge to ask)')
    if not LOGIN.match(login):
        raise TimesheetError(f'not a login: {login}')
    return login


def draft(root, home, day, login=None, forge=None):
    """The timesheet lines of a day for the project at `root`, with what produced them."""
    forge = forge if forge is not None else get_forge(root, home)
    login = get_login(forge, login)
    intervals, errors = timelog.read_day(home, day)
    remote = timelog.project_remote(root)
    seconds, overlaps = resolve_day(intervals, day)
    links = wp_links(root)
    totals = {}
    for index, spent in seconds.items():
        one = intervals[index]
        if not timelog.belongs(one, root, remote):
            continue
        key = (one.get('ref'), one.get('kind', 'dev'))
        totals[key] = totals.get(key, 0) + spent
    lines = []
    for (ref, kind), spent in sorted(totals.items(), key=lambda item: (item[0][0] is None, item[0][0] or '', item[0][1])):
        minutes = round(spent / 60)
        if not minutes:
            continue
        number = int(ref.split('#')[1]) if ref else None
        lines.append({'date': day, 'ref': ref, 'wp': wp_of(number, links, forge) if number else None, 'kind': kind, 'minutes': minutes})
    mine = {index for index, one in enumerate(intervals) if timelog.belongs(one, root, remote)}
    shown = [{'from': o['from'], 'to': o['to'], 'kept': label(intervals[o['kept']]), 'dropped': [label(intervals[i]) for i in o['dropped']]}
             for o in overlaps if mine & {o['kept'], *o['dropped']}]
    clock = timelog.read_clock(home)
    path = timesheet_path(root, login, day)
    return {
        'date': day, 'login': login, 'file': os.path.relpath(path, root), 'lines': lines, 'overlaps': shown, 'errors': errors,
        'clockRunning': bool(clock and timelog.belongs(clock, root, remote)),
        'existing': [line.strip() for line in day_lines(path, day)],
        'forge': forge.forge if forge else None,
    }


def draft_hash(result):
    return hashlib.sha256(json.dumps(result['lines'], sort_keys=True).encode()).hexdigest()


def timesheet_path(root, login, day):
    return os.path.join(root, TIMESHEETS, login, day[:7] + '.yaml')


def day_lines(path, day):
    if not os.path.exists(path):
        return []
    return [line for line in ds.read_text(path).splitlines(keepends=True) if line_date(line) == day]


def line_date(line):
    match = LINE_DATE.search(line) if line.lstrip().startswith('- {') else None
    return match.group(1) if match else None


def render(line):
    fields = [f"date: {line['date']}"]
    if line['ref']:
        fields.append(f"ref: '{line['ref']}'")
    if line['wp']:
        fields.append(f"wp: {line['wp']}")
    fields += [f"kind: {line['kind']}", f"minutes: {line['minutes']}"]
    return '  - { ' + ', '.join(fields) + ' }\n'


def write(root, home, day, digest, login=None, replace=False, forge=None):
    """Writes the day's lines, as `show` drafted them under `digest`; a day already written is replaced only with `replace`."""
    result = draft(root, home, day, login, forge)
    if draft_hash(result) != digest:
        raise TimesheetError('the time log changed since the draft: show it again')
    if result['clockRunning']:
        raise TimesheetError('the desk clock is running on this project: stop it first')
    if not result['lines']:
        raise TimesheetError(f'no time logged on {day} for this project')
    path = timesheet_path(root, result['login'], day)
    text = ds.read_text(path) if os.path.exists(path) else HEADER
    old = day_lines(path, day)
    if old and not replace:
        raise TimesheetError(f'{day} is already in {result["file"]}: pass --replace to write it again')
    if any(re.search(r'\bsent:\s*true\b', line) for line in old):
        raise TimesheetError(f'{day} was already sent to the forge: correct its tracked times there, then edit {result["file"]} by hand')
    kept = [line for line in text.splitlines(keepends=True) if line_date(line) != day]
    if kept and not kept[-1].endswith('\n'):
        kept[-1] += '\n'
    os.makedirs(os.path.dirname(path), exist_ok=True)
    ds.write_text(path, ''.join(kept) + ''.join(render(line) for line in result['lines']))
    return {'file': result['file'], 'written': len(result['lines']), 'replaced': len(old)}


def push(root, home, day, login=None, forge=None):
    """Adds the day's issue lines not yet sent to the issues' tracked times on Forgejo, and marks each one `sent: true`."""
    forge = forge if forge is not None else get_forge(root, home)
    if forge is None or forge.forge != 'forgejo':
        raise TimesheetError('only Forgejo tracks time on issues: on GitHub the time stays in the timesheet')
    path = timesheet_path(root, get_login(forge, login), day)
    if not os.path.exists(path):
        raise TimesheetError(f'no timesheet for {day}: write it first')
    lines = ds.read_text(path).splitlines(keepends=True)
    sent = []
    for index, line in enumerate(lines):
        ref = re.search(r"\bref:\s*'?#(\d+)'?", line)
        minutes = re.search(r'\bminutes:\s*(\d+)', line)
        if line_date(line) != day or not ref or not minutes or re.search(r'\bsent:\s*true\b', line):
            continue
        forge.call('POST', f'repos/{forge.repo}/issues/{ref.group(1)}/times', {'time': int(minutes.group(1)) * 60, 'created': f'{day}T12:00:00Z'})
        lines[index] = re.sub(r'\s*\}\s*$', ', sent: true }\n', line)
        ds.write_text(path, ''.join(lines))
        sent.append({'ref': '#' + ref.group(1), 'minutes': int(minutes.group(1))})
    return {'file': os.path.relpath(path, root), 'sent': sent}


def main(argv=None):
    parser = argparse.ArgumentParser(description='p2kit timesheet: crystallize a day of the local time log')
    parser.add_argument('command', choices=('show', 'write', 'push'))
    parser.add_argument('--project', required=True)
    parser.add_argument('--date', default=None)
    parser.add_argument('--login', default=None)
    parser.add_argument('--hash', default=None)
    parser.add_argument('--replace', action='store_true')
    parser.add_argument('--home', default=os.path.expanduser('~'))
    args = parser.parse_args(argv)
    root = os.path.realpath(args.project)
    day = args.date or timelog.now().date().isoformat()
    try:
        if args.command == 'show':
            result = draft(root, args.home, day, args.login)
            result['hash'] = draft_hash(result)
        elif args.command == 'write':
            if not args.hash:
                raise TimesheetError('write needs --hash, from show')
            result = write(root, args.home, day, args.hash, args.login, args.replace)
        else:
            result = push(root, args.home, day, args.login)
    except (TimesheetError, ds.ActionError) as error:
        print(json.dumps({'error': str(error)}))
        return 1
    print(json.dumps(result, indent=2))
    return 0


if __name__ == '__main__':
    sys.exit(main())
