"""Tests of the time log, the desk clock and the timesheets: python3 -m unittest discover -s server"""

import json
import os
import tempfile
import unittest
import unittest.mock
from datetime import datetime, timedelta

import desk_server as ds
import timelog
import timesheet

DAY = '2026-11-26'
REMOTE = 'hub.example.com/acme/portal'


def at(hour, minute=0, day=DAY):
    return datetime.fromisoformat(f'{day}T{hour:02d}:{minute:02d}:00').astimezone()


class FakeForge:
    """A Forgejo answering the user, issue milestones and tracked times from memory, recording each call."""

    def __init__(self, milestones=None, forge='forgejo'):
        self.forge, self.repo, self.calls, self.milestones = forge, 'acme/portal', [], milestones or {}

    def call(self, method, path, body=None):
        self.calls.append((method, path, body))
        if path == 'user':
            return {'login': 'pm'}
        if path.startswith('repos/acme/portal/issues/') and method == 'GET':
            title = self.milestones.get(int(path.rsplit('/', 1)[1]))
            return {'milestone': {'title': title} if title else None}
        return {}


class Home:
    """A home with one registered project, with no git origin: its intervals match by folder."""

    def __init__(self):
        self.temp = tempfile.TemporaryDirectory()
        self.home = os.path.realpath(self.temp.name)
        self.root = os.path.join(self.home, 'repo')
        os.makedirs(os.path.join(self.root, '.pm', 'work-packages'))
        os.makedirs(os.path.join(self.home, '.config', 'p2kit'))
        with open(os.path.join(self.home, '.config', 'p2kit', 'projects.yaml'), 'w') as handle:
            handle.write('projects:\n  - path: ~/repo\n')
        self.wp('WP-01', 'issue: 85\n')
        self.wp('WP-02', "milestone: 'Timer'\n")

    def wp(self, wp, extra):
        with open(os.path.join(self.root, '.pm', 'work-packages', wp + '.md'), 'w') as handle:
            handle.write(f'---\nid: {wp}\ntitle: {wp}\nstatus: in-progress\n{extra}---\n')

    def log(self, start, end, ref=None, kind='dev', remote=None, project=None, source='forge-desk'):
        timelog.append_interval(self.home, {'start': timelog.iso(start), 'end': timelog.iso(end), 'remote': remote,
                                            'ref': ref, 'kind': kind, 'source': source, 'project': project or self.root})

    def close(self):
        self.temp.cleanup()


class TimelogTest(unittest.TestCase):
    def setUp(self):
        self.h = Home()

    def tearDown(self):
        self.h.close()

    def test_normalize_remote(self):
        self.assertEqual(timelog.normalize_remote('git@GitHub.com:dgpaci/p2kit.git'), 'github.com/dgpaci/p2kit')
        self.assertEqual(timelog.normalize_remote('https://hub.genro.com/softwell/gnrcomm'), 'hub.genro.com/softwell/gnrcomm')
        self.assertIsNone(timelog.normalize_remote('/a/local/path'))

    def test_the_clock_writes_its_time_on_stop_and_a_start_while_running_switches(self):
        clock, stopped = timelog.start_clock(self.h.home, self.h.root, None, 'desk', at(9))
        self.assertEqual((clock['ref'], clock['kind'], stopped), (None, 'desk', []))
        clock, stopped = timelog.start_clock(self.h.home, self.h.root, '#85', 'meeting', at(9, 40))
        self.assertEqual([(s['start'][11:16], s['end'][11:16], s['ref']) for s in stopped], [('09:00', '09:40', None)])
        written = timelog.stop_clock(self.h.home, at(10, 10))
        self.assertEqual([(w['ref'], w['kind'], w['source']) for w in written], [('#85', 'meeting', 'p2kit-desk')])
        self.assertIsNone(timelog.read_clock(self.h.home))
        intervals, errors = timelog.read_day(self.h.home, DAY)
        self.assertEqual((len(intervals), errors), (2, []))

    def test_a_clock_over_midnight_is_cut_into_each_day(self):
        timelog.start_clock(self.h.home, self.h.root, None, 'desk', at(23, 30))
        timelog.stop_clock(self.h.home, at(0, 45, '2026-11-27'))
        self.assertEqual(len(timelog.read_day(self.h.home, DAY)[0]), 1)
        self.assertEqual(timelog.minutes_by_project(self.h.home, '2026-11-27', {self.h.root: None}), {self.h.root: 45})

    def test_a_slip_writes_nothing_and_bad_requests_are_refused(self):
        timelog.start_clock(self.h.home, self.h.root, None, 'desk', at(9))
        self.assertEqual(timelog.stop_clock(self.h.home, at(9) + timedelta(seconds=20)), [])
        with self.assertRaises(timelog.TimelogError):
            timelog.stop_clock(self.h.home)
        with self.assertRaises(timelog.TimelogError):
            timelog.start_clock(self.h.home, self.h.root, None, 'dev')
        with self.assertRaises(timelog.TimelogError):
            timelog.start_clock(self.h.home, self.h.root, '85', 'desk')

    def test_a_bad_line_is_reported_and_skipped(self):
        self.h.log(at(9), at(10))
        with open(timelog.day_path(self.h.home, DAY), 'a') as handle:
            handle.write('not json\n')
        intervals, errors = timelog.read_day(self.h.home, DAY)
        self.assertEqual((len(intervals), len(errors)), (1, 1))

    def test_the_helper_starts_and_stops_the_clock_of_a_registered_project_only(self):
        state = ds.run_clock(self.h.home, {'op': 'start', 'project': self.h.root, 'ref': '#85'})
        self.assertEqual((state['clock']['project'], state['clock']['ref']), (self.h.root, '#85'))
        with self.assertRaises(ds.ActionError):
            ds.run_clock(self.h.home, {'op': 'start', 'project': self.h.home})
        self.assertIsNone(ds.run_clock(self.h.home, {'op': 'stop'})['clock'])
        with self.assertRaises(ds.ActionError):
            ds.run_clock(self.h.home, {'op': 'stop'})


class TimesheetTest(unittest.TestCase):
    def setUp(self):
        self.h = Home()
        self.forge = FakeForge({86: 'Timer'})

    def tearDown(self):
        self.h.close()

    def draft(self):
        return timesheet.draft(self.h.root, self.h.home, DAY, None, self.forge)

    def test_lines_sum_per_issue_and_kind_with_their_work_package(self):
        self.h.log(at(9), at(10), '#85')
        self.h.log(at(11), at(11, 30), '#85')
        self.h.log(at(14), at(14, 45), '#86')
        self.h.log(at(15), at(15, 20), None, 'desk', source='p2kit-desk')
        self.h.log(at(16), at(17), '#3', project='/elsewhere')
        result = self.draft()
        self.assertEqual(result['lines'], [
            {'date': DAY, 'ref': '#85', 'wp': 'WP-01', 'kind': 'dev', 'minutes': 90},
            {'date': DAY, 'ref': '#86', 'wp': 'WP-02', 'kind': 'dev', 'minutes': 45},
            {'date': DAY, 'ref': None, 'wp': None, 'kind': 'desk', 'minutes': 20},
        ])
        self.assertEqual((result['login'], result['file']), ('pm', os.path.join('.pm', 'timesheets', 'pm', '2026-11.yaml')))

    def test_overlapping_time_counts_once_an_issue_first_across_projects(self):
        self.h.log(at(9), at(10), None, 'desk', source='p2kit-desk')
        self.h.log(at(9, 30), at(10, 30), '#85')
        self.h.log(at(10, 15), at(10, 45), '#7', project='/elsewhere')
        result = self.draft()
        self.assertEqual([(l['ref'], l['minutes']) for l in result['lines']], [('#85', 45), (None, 30)])
        self.assertEqual(len(result['overlaps']), 2)

    def test_intervals_match_the_project_by_its_origin(self):
        self.h.log(at(9), at(10), '#85', remote=REMOTE, project='/a/worktree')
        with unittest.mock.patch.object(timelog, 'project_remote', return_value=REMOTE):
            self.assertEqual([l['minutes'] for l in self.draft()['lines']], [60])
        self.assertEqual(self.draft()['lines'], [])

    def test_write_needs_the_drafted_hash_and_replaces_a_day_only_when_asked(self):
        self.h.log(at(9), at(10), '#85')
        digest = timesheet.draft_hash(self.draft())
        with self.assertRaises(timesheet.TimesheetError):
            timesheet.write(self.h.root, self.h.home, DAY, 'stale', None, False, self.forge)
        timesheet.write(self.h.root, self.h.home, DAY, digest, None, False, self.forge)
        path = os.path.join(self.h.root, '.pm', 'timesheets', 'pm', '2026-11.yaml')
        with open(path) as handle:
            self.assertIn("  - { date: 2026-11-26, ref: '#85', wp: WP-01, kind: dev, minutes: 60 }\n", handle.read())
        with self.assertRaises(timesheet.TimesheetError):
            timesheet.write(self.h.root, self.h.home, DAY, digest, None, False, self.forge)
        self.h.log(at(11), at(11, 30), '#85')
        digest = timesheet.draft_hash(self.draft())
        self.assertEqual(timesheet.write(self.h.root, self.h.home, DAY, digest, None, True, self.forge)['replaced'], 1)
        with open(path) as handle:
            self.assertEqual(handle.read().count('date: 2026-11-26'), 1)

    def test_a_running_clock_on_the_project_blocks_the_write(self):
        self.h.log(at(9), at(10), '#85')
        timelog.start_clock(self.h.home, self.h.root, None, 'desk', at(10))
        result = self.draft()
        self.assertTrue(result['clockRunning'])
        with self.assertRaises(timesheet.TimesheetError):
            timesheet.write(self.h.root, self.h.home, DAY, timesheet.draft_hash(result), None, False, self.forge)

    def test_push_adds_tracked_times_on_forgejo_once(self):
        self.h.log(at(9), at(10), '#85')
        self.h.log(at(15), at(15, 20), None, 'desk', source='p2kit-desk')
        timesheet.write(self.h.root, self.h.home, DAY, timesheet.draft_hash(self.draft()), None, False, self.forge)
        self.assertEqual(timesheet.push(self.h.root, self.h.home, DAY, None, self.forge)['sent'], [{'ref': '#85', 'minutes': 60}])
        self.assertIn(('POST', 'repos/acme/portal/issues/85/times', {'time': 3600, 'created': '2026-11-26T12:00:00Z'}), self.forge.calls)
        self.assertEqual(timesheet.push(self.h.root, self.h.home, DAY, None, self.forge)['sent'], [])
        with self.assertRaises(timesheet.TimesheetError):
            timesheet.write(self.h.root, self.h.home, DAY, timesheet.draft_hash(self.draft()), None, True, self.forge)
        with self.assertRaises(timesheet.TimesheetError):
            timesheet.push(self.h.root, self.h.home, DAY, None, FakeForge(forge='github'))


if __name__ == '__main__':
    unittest.main()
