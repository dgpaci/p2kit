"""The local time log and the desk clock that writes to it (docs/pm-schema.md → Time log).

The time log is a contract between tools: one file per local day, `~/.claude/timelog/<yyyy-mm-dd>.jsonl`, one
interval per line, `{start, end, remote, ref, kind, source}`. Any tool may append to it (forge-desk records its
development sessions); p2kit's desk clock appends the PM's own time, and /pm-log reads it to write the timesheets.
Nothing here commits or touches a project's files. Standard library only.
"""

import json
import os
import re
import subprocess
from datetime import datetime, timedelta

TIMELOG_DIR = '.claude/timelog'
CLOCK_FILE = '.claude/p2kit/clock.json'
SOURCE = 'p2kit-desk'
# An interval the PM records after the fact, with /pm-log: their own statement of what they worked on.
MANUAL_SOURCE = 'p2kit-manual'
# Where intervals overlap, declared time beats time a tool inferred: a manual entry, then the desk clock, then the rest.
SOURCE_RANK = {MANUAL_SOURCE: 2, SOURCE: 1}
KINDS = ('dev', 'desk', 'meeting')
# The desk clock records the PM's own time: development sessions are recorded by the tool that runs them.
CLOCK_KINDS = ('desk', 'meeting')
ISSUE_REF = re.compile(r'^#(\d+)$')
GIT_TIMEOUT = 10
# Shorter than this, a start and stop is a slip: nothing is written.
MIN_SECONDS = 60
# A manual entry is one stretch of a working day.
MAX_MANUAL_SECONDS = 24 * 3600


class TimelogError(Exception):
    """A refused clock or time-log request: the message is shown to the user as it is."""


def normalize_remote(url):
    """`host/owner/repo` of a remote URL, host lower-cased, so the worktrees and clones of one repo match; None otherwise."""
    match = re.match(r'^[\w.-]+@([\w.-]+):([\w.-]+)/([\w.-]+?)(?:\.git)?/?$', url) or \
        re.match(r'^(?:ssh|https?)://(?:[^@/]+@)?([\w.-]+)(?::\d+)?/([\w.-]+)/([\w.-]+?)(?:\.git)?/?$', url)
    return f'{match.group(1).lower()}/{match.group(2)}/{match.group(3)}' if match else None


def project_remote(root):
    """The normalized origin of the project at `root`; None when it has none."""
    try:
        result = subprocess.run(['git', '-C', root, 'remote', 'get-url', 'origin'], capture_output=True, text=True, timeout=GIT_TIMEOUT)
    except (OSError, subprocess.SubprocessError):
        return None
    return normalize_remote(result.stdout.strip()) if result.returncode == 0 else None


def now():
    return datetime.now().astimezone()


def iso(moment):
    return moment.isoformat(timespec='seconds')


def parse_time(text):
    """An ISO 8601 time as an aware datetime; a time with no offset is local. Raises ValueError."""
    if not isinstance(text, str):
        raise ValueError('not a time')
    moment = datetime.fromisoformat(text.replace('Z', '+00:00'))
    return moment if moment.tzinfo else moment.astimezone()


def day_bounds(day):
    """The local start and end of an ISO day."""
    start = datetime.fromisoformat(day).astimezone()
    return start, (start + timedelta(days=1)).replace(hour=0, minute=0, second=0).astimezone()


def split_days(start, end):
    """The pieces of [start, end) cut at local midnight, as (day, start, end)."""
    pieces = []
    while start < end:
        midnight = (start + timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)
        cut = min(end, midnight)
        pieces.append((start.date().isoformat(), start, cut))
        start = cut
    return pieces


def day_path(home, day):
    return os.path.join(home, TIMELOG_DIR, day + '.jsonl')


def append_interval(home, entry):
    """Appends one interval to the file of its day; the caller has cut it at midnight."""
    path = day_path(home, parse_time(entry['start']).date().isoformat())
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'a', encoding='utf-8') as handle:
        handle.write(json.dumps(entry, sort_keys=True) + '\n')


def read_day(home, day):
    """The valid intervals of a day's file, each with aware `start` and `end`, and the lines it could not read."""
    path = day_path(home, day)
    intervals, errors = [], []
    if not os.path.exists(path):
        return intervals, errors
    with open(path, encoding='utf-8') as handle:
        for number, line in enumerate(handle, 1):
            if not line.strip():
                continue
            try:
                entry = json.loads(line)
                start, end = parse_time(entry['start']), parse_time(entry['end'])
                if end <= start:
                    raise ValueError('end before start')
                ref = entry.get('ref')
                if ref is not None and not (isinstance(ref, str) and re.match(r'^(PR )?#\d+$', ref)):
                    raise ValueError(f'ref {ref!r}')
                intervals.append({**entry, 'start': start, 'end': end, 'ref': ref})
            except (ValueError, KeyError, TypeError) as error:
                errors.append(f'{os.path.basename(path)} line {number}: {error}')
    return intervals, errors


# ---------------------------------------------------------------- the desk clock

def clock_path(home):
    return os.path.join(home, CLOCK_FILE)


def read_clock(home):
    """The running clock `{start, project, remote, ref, kind}`, or None when it is stopped."""
    path = clock_path(home)
    if not os.path.exists(path):
        return None
    with open(path, encoding='utf-8') as handle:
        try:
            clock = json.load(handle)
        except ValueError:
            return None
    return clock if isinstance(clock, dict) and clock.get('start') else None


def write_clock(home, clock):
    path = clock_path(home)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path + '.tmp', 'w', encoding='utf-8') as handle:
        json.dump(clock, handle)
    os.replace(path + '.tmp', path)


def stop_clock(home, at=None):
    """Stops the running clock and appends its time to the log, cut at midnight; returns the intervals written."""
    clock = read_clock(home)
    if clock is None:
        raise TimelogError('the clock is not running')
    end = at or now()
    start = parse_time(clock['start'])
    written = []
    if (end - start).total_seconds() >= MIN_SECONDS:
        for _, piece_start, piece_end in split_days(start, end):
            entry = {'start': iso(piece_start), 'end': iso(piece_end), 'remote': clock.get('remote'), 'ref': clock.get('ref'),
                     'kind': clock.get('kind', 'desk'), 'source': SOURCE, 'project': clock.get('project')}
            append_interval(home, entry)
            written.append(entry)
    os.remove(clock_path(home))
    return written


def start_clock(home, root, ref=None, kind='desk', at=None):
    """Starts the clock on a project, an issue of it (`#<n>`) or a meeting; a running clock is stopped first (a switch)."""
    if kind not in CLOCK_KINDS:
        raise TimelogError(f'kind must be one of {", ".join(CLOCK_KINDS)}')
    if ref is not None and not (isinstance(ref, str) and ISSUE_REF.match(ref)):
        raise TimelogError('ref must be #<number>')
    moment = at or now()
    stopped = stop_clock(home, moment) if read_clock(home) else []
    clock = {'start': iso(moment), 'project': root, 'remote': project_remote(root), 'ref': ref, 'kind': kind}
    write_clock(home, clock)
    return clock, stopped


def add_interval(home, root, start, end, ref=None, kind='desk', at=None):
    """Records a past interval on a project or an issue of it (`#<n>`), cut at midnight; returns the intervals written.

    The PM's correction of the time log (time the clock missed): it ends no later than now, and the same interval of the
    same project is never recorded twice.
    """
    if kind not in KINDS:
        raise TimelogError(f'kind must be one of {", ".join(KINDS)}')
    if ref is not None and not (isinstance(ref, str) and ISSUE_REF.match(ref)):
        raise TimelogError('ref must be #<number>')
    seconds = (end - start).total_seconds()
    if seconds < MIN_SECONDS:
        raise TimelogError('the interval must end at least a minute after it starts')
    if seconds > MAX_MANUAL_SECONDS:
        raise TimelogError('an interval is at most 24 hours: record a longer stretch day by day')
    if end > (at or now()):
        raise TimelogError('the interval ends in the future: record past time only')
    remote = project_remote(root)
    pieces = [{'start': iso(piece_start), 'end': iso(piece_end), 'remote': remote, 'ref': ref, 'kind': kind,
               'source': MANUAL_SOURCE, 'project': root} for _, piece_start, piece_end in split_days(start, end)]
    for piece in pieces:
        intervals, _ = read_day(home, parse_time(piece['start']).date().isoformat())
        if any(one.get('source') == MANUAL_SOURCE and belongs(one, root, remote) and iso(one['start']) == piece['start']
               and iso(one['end']) == piece['end'] for one in intervals):
            raise TimelogError(f'{piece["start"]} – {piece["end"]} is already recorded on this project')
    for piece in pieces:
        append_interval(home, piece)
    return pieces


def minutes_by_project(home, day, remotes):
    """The minutes logged on `day` per project path; `remotes` maps each project path to its normalized origin or None."""
    intervals, _ = read_day(home, day)
    totals = {}
    for path, remote in remotes.items():
        seconds = sum((one['end'] - one['start']).total_seconds() for one in intervals if belongs(one, path, remote))
        if seconds:
            totals[path] = round(seconds / 60)
    return totals


def belongs(interval, root, remote):
    """An interval is a project's when it names the project's origin, or, with no origin, the project's folder."""
    return (remote is not None and interval.get('remote') == remote) or (interval.get('remote') is None and interval.get('project') == root)
