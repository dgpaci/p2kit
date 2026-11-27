"""Tests of the desk helper: python3 -m unittest discover -s server"""

import http.client
import io
import json
import os
import tempfile
import threading
import unittest
import unittest.mock

import desk_server as ds

WP = '---\nid: WP-01\ntitle: Certificates\nproduct: work-package\nstage: 1\nstatus: {status}\nissue: 498\n---\n\n# Body\nstatus: not frontmatter\n'
NOTES = ('notes:\n'
         '  - { sha: 3f2a9c1, wp: WP-01, kind: blocker, status: open, text: \'waiting for the print template\', date: 2026-11-11 }\n'
         '  - { sha: 3f2a9c1, wp: WP-01, kind: remark, status: open, text: another note, date: 2026-11-12 }\n')


class Project:
    """A home with a registry listing one project folder holding .pm/."""

    def __init__(self, status='completed'):
        self.temp = tempfile.TemporaryDirectory()
        self.home = os.path.realpath(self.temp.name)
        self.root = os.path.join(self.home, 'repo')
        os.makedirs(os.path.join(self.root, '.pm', 'work-packages'))
        os.makedirs(os.path.join(self.root, '.pm', 'registers'))
        os.makedirs(os.path.join(self.home, '.config', 'p2kit'))
        self.write('.pm/project.yaml', 'name: P\nstage: { current: 2 }\n')
        self.write('.pm/work-packages/WP-01.md', WP.format(status=status))
        self.write('.pm/registers/commit-notes.yaml', NOTES)
        with open(os.path.join(self.home, '.config', 'p2kit', 'projects.yaml'), 'w') as handle:
            handle.write('projects:\n  - path: ~/repo\n    added: 2026-11-17\n')

    def write(self, relative, text):
        with open(os.path.join(self.root, relative), 'w') as handle:
            handle.write(text)

    def read(self, relative):
        with open(os.path.join(self.root, relative)) as handle:
            return handle.read()

    def act(self, **request):
        """Preview, then apply with the preview's hash."""
        answer, _ = ds.run_action(self.home, {'project': self.root, **request})
        return ds.run_action(self.home, {'project': self.root, **request, 'confirm': answer['hash']})[0], answer['preview']


class FileActions(unittest.TestCase):
    def setUp(self):
        self.p = Project()

    def tearDown(self):
        self.p.temp.cleanup()

    def test_archive_changes_only_the_status_line(self):
        before = self.p.read('.pm/work-packages/WP-01.md')
        result, preview = self.p.act(kind='wp-status', target='WP-01', value='archived')
        self.assertTrue(result['applied'])
        self.assertEqual(preview['changes'], [{'line': 6, 'before': 'status: completed', 'after': 'status: archived'}])
        self.assertEqual(self.p.read('.pm/work-packages/WP-01.md'), before.replace('status: completed', 'status: archived', 1))

    def test_status_moves_only_along_its_edges(self):
        with self.assertRaisesRegex(ds.ActionError, 'only authorized or in-progress'):
            self.p.act(kind='wp-status', target='WP-01', value='completed')
        self.p.write('.pm/work-packages/WP-01.md', WP.format(status='in-progress'))
        with self.assertRaisesRegex(ds.ActionError, 'only completed'):
            self.p.act(kind='wp-status', target='WP-01', value='archived')
        with self.assertRaisesRegex(ds.ActionError, 'completed or archived'):
            self.p.act(kind='wp-status', target='WP-01', value='cancelled')

    def test_a_preview_applies_only_to_the_file_it_showed(self):
        action = {'project': self.p.root, 'kind': 'wp-link', 'target': 'WP-01', 'field': 'branch', 'value': 'feature/1-x'}
        answer, _ = ds.run_action(self.p.home, action)
        self.p.write('.pm/work-packages/WP-01.md', WP.format(status='completed') + '\nedited\n')
        with self.assertRaisesRegex(ds.ActionError, 'changed since the preview'):
            ds.run_action(self.p.home, {**action, 'confirm': answer['hash']})
        self.assertNotIn('branch', self.p.read('.pm/work-packages/WP-01.md'))

    def wps(self, *fronts):
        """Work packages WP-01.. with the given extra frontmatter lines, all in progress."""
        for n, front in enumerate(fronts, 1):
            self.p.write(f'.pm/work-packages/WP-{n:02d}.md', f'---\nid: WP-{n:02d}\ntitle: T{n}\nstatus: in-progress\n{front}---\n\n# Body\nrank: 9\n')

    def test_a_drop_places_and_renumbers_the_group_in_one_preview(self):
        self.wps('horizon: now\nrank: 1\n', 'horizon: now\nrank: 2\n', '')
        result, preview = self.p.act(kind='wp-place', target='WP-03', horizon='now', beside='WP-02', side='above')
        self.assertTrue(result['applied'])
        self.assertEqual(preview['summary'], 'Place WP-03 in Now at rank 2, renumbering 1 more')
        self.assertEqual([f['file'] for f in preview['files']], ['.pm/work-packages/WP-03.md', '.pm/work-packages/WP-02.md'])
        self.assertEqual(preview['files'][1]['changes'], [{'line': 6, 'before': 'rank: 2', 'after': 'rank: 3'}])
        self.assertIn('status: in-progress\nhorizon: now\nrank: 2\n---\n', self.p.read('.pm/work-packages/WP-03.md'))
        self.assertIn('horizon: now\nrank: 3\n---\n\n# Body\nrank: 9\n', self.p.read('.pm/work-packages/WP-02.md'))
        self.assertIn('rank: 1\n---\n', self.p.read('.pm/work-packages/WP-01.md'))

    def test_a_drop_on_not_placed_clears_horizon_and_rank(self):
        self.wps('horizon: later\nrank: 4\n')
        _, preview = self.p.act(kind='wp-place', target='WP-01', horizon='')
        self.assertEqual(preview['summary'], 'Take WP-01 off the roadmap')
        self.assertEqual(self.p.read('.pm/work-packages/WP-01.md'), '---\nid: WP-01\ntitle: T1\nstatus: in-progress\n---\n\n# Body\nrank: 9\n')
        with self.assertRaisesRegex(ds.ActionError, 'is not placed'):
            self.p.act(kind='wp-place', target='WP-01', horizon='')

    def test_a_drop_applies_only_to_the_roadmap_it_showed(self):
        self.wps('horizon: now\nrank: 1\n', '', 'horizon: next\n')
        action = {'project': self.p.root, 'kind': 'wp-place', 'target': 'WP-02', 'horizon': 'now'}
        answer, _ = ds.run_action(self.p.home, action)
        # A work package the drop does not write moved meanwhile: the order the preview showed is gone.
        self.p.write('.pm/work-packages/WP-03.md', '---\nid: WP-03\nstatus: draft\nhorizon: now\nrank: 2\n---\n')
        with self.assertRaisesRegex(ds.ActionError, 'changed since the preview'):
            ds.run_action(self.p.home, {**action, 'confirm': answer['hash']})
        self.assertNotIn('horizon', self.p.read('.pm/work-packages/WP-02.md'))

    def test_a_drop_is_validated(self):
        self.wps('horizon: now\nrank: 1\n', '')
        for request, error in (({'horizon': 'soon'}, 'now, next or later'), ({'horizon': ['now']}, 'now, next or later'),
                               ({'horizon': 'now', 'beside': 'WP-02'}, 'beside itself'), ({'horizon': 'now', 'beside': '../x'}, 'not a work package id'),
                               ({'horizon': 'now', 'beside': 'WP-01', 'side': 'over'}, 'above or below'), ({'horizon': 'next', 'beside': 'WP-01', 'side': 'above'}, 'not in Next')):
            with self.subTest(request):
                with self.assertRaisesRegex(ds.ActionError, error):
                    self.p.act(kind='wp-place', target='WP-02', **request)
        self.p.write('.pm/work-packages/WP-02.md', '---\nid: WP-02\nstatus: draft\nhorizon: now\nhorizon: next\n---\n')
        with self.assertRaisesRegex(ds.ActionError, 'more than once'):
            self.p.act(kind='wp-place', target='WP-02', horizon='later')

    def test_links_are_validated_and_quoted_within_the_subset(self):
        self.p.act(kind='wp-link', target='WP-01', field='milestone', value="l'anagrafica: soci")
        self.p.act(kind='wp-link', target='WP-01', field='branch', value='feature/12-x')
        self.p.act(kind='wp-link', target='WP-01', field='issue', value=12)
        text = self.p.read('.pm/work-packages/WP-01.md')
        self.assertIn('milestone: "l\'anagrafica: soci"\n', text)
        self.assertIn('branch: feature/12-x\n', text)
        self.assertIn('issue: 12\n', text)
        for field, value in (('branch', 'a..b'), ('branch', '-x'), ('issue', '12'), ('milestone', 'a\nb'), ('milestone', 'it\'s "x"')):
            with self.assertRaises(ds.ActionError):
                self.p.act(kind='wp-link', target='WP-01', field=field, value=value)

    def test_scalars(self):
        self.assertEqual(ds.to_scalar('Sprint 3'), 'Sprint 3')
        self.assertEqual(ds.to_scalar('2026'), "'2026'")
        self.assertEqual(ds.to_scalar('a: b'), "'a: b'")
        self.assertEqual(ds.to_scalar("it's"), '"it\'s"')

    def test_closing_a_note_changes_its_status_only(self):
        result, preview = self.p.act(kind='note-status', target={'sha': '3f2a9c1', 'text': 'waiting for the print template'}, value='closed')
        self.assertEqual(preview['changes'][0]['line'], 2)
        self.assertEqual(self.p.read('.pm/registers/commit-notes.yaml'), NOTES.replace('status: open', 'status: closed', 1))
        with self.assertRaisesRegex(ds.ActionError, 'already closed'):
            self.p.act(kind='note-status', target={'sha': '3f2a9c1', 'text': 'waiting for the print template'}, value='closed')
        with self.assertRaisesRegex(ds.ActionError, 'not found'):
            self.p.act(kind='note-status', target={'sha': '3f2a9c1', 'text': 'note'}, value='closed')
        self.p.write('.pm/registers/commit-notes.yaml', NOTES + NOTES.split('\n')[2] + '\n')
        with self.assertRaisesRegex(ds.ActionError, 'more than one'):
            self.p.act(kind='note-status', target={'sha': '3f2a9c1', 'text': 'another note'}, value='closed')

    def test_only_registered_projects_and_known_work_packages(self):
        with self.assertRaisesRegex(ds.ActionError, 'not in projects.yaml'):
            ds.run_action(self.p.home, {'project': self.p.home, 'kind': 'wp-place', 'target': 'WP-01', 'horizon': 'now'})
        for target in ('../x', 'WP-1', 'WP-09'):
            with self.assertRaises(ds.ActionError):
                self.p.act(kind='wp-place', target=target, horizon='now')
            with self.assertRaises(ds.ActionError):
                self.p.act(kind='wp-link', target=target, field='branch', value='x')


PEOPLE = ('roles:\n'
          '  executive: Anna Rossi\n'
          '  senior_user: [Finizio (Secretary), Roberta, "Rossi, Mario"]\n'
          '  project_manager: Davide Paci\n'
          '  support:\n'
          "    - Daniela D'Alessandro\n"
          '    - roberta\n'
          'team:\n'
          '  wip_limit: 3\n'
          '  people:\n'
          '    Davide Paci: { login: dgpaci }\n'
          '    Eva Neri: { login: eneri }\n'
          'stage: { current: 1 }\n')
LOG = ('entries:\n'
       "  - { id: D-001, date: 2026-11-04, kind: event, source: meeting, text: 'monthly meeting, owner: nobody' }\n"
       "  - { id: D-002, date: 2026-11-04, kind: action, source: meeting, text: 'send the file, today', owner: Roberta, due: 2026-11-04, status: open }\n"
       '  - { id: D-003, date: 2026-11-04, kind: action, source: meeting, text: "l\'ordine", status: open }\n'
       '  - { id: D-004, date: 2026-11-05, kind: action, source: manual, text: call back }\n'
       '  - { id: D-005, date: 2026-11-05, kind: action, source: manual, text: done already, owner: Davide Paci, status: done }\n')


class LogOwner(unittest.TestCase):
    def setUp(self):
        self.p = Project()
        self.p.write('.pm/project.yaml', PEOPLE)
        self.p.write('.pm/registers/daily-log.yaml', LOG)

    def tearDown(self):
        self.p.temp.cleanup()

    def line(self, entry_id):
        return next(line for line in self.p.read('.pm/registers/daily-log.yaml').splitlines() if f'id: {entry_id},' in line)

    def test_the_people_are_the_roles_then_team_people_once_each_without_their_note(self):
        self.assertEqual(ds.project_people(self.p.root), ['Anna Rossi', 'Finizio', 'Roberta', 'Rossi, Mario', 'Davide Paci', "Daniela D'Alessandro", 'Eva Neri'])

    def test_reassigning_changes_only_the_owner_of_that_line(self):
        before = LOG.splitlines()
        result, preview = self.p.act(kind='log-owner', ids=['D-002'], owner='finizio')
        self.assertTrue(result['applied'])
        self.assertEqual(preview['summary'], 'Assign Finizio to D-002')
        after = self.p.read('.pm/registers/daily-log.yaml').splitlines()
        self.assertEqual(after[2], before[2].replace('owner: Roberta', 'owner: Finizio'))
        self.assertEqual([a for i, a in enumerate(after) if i != 2], [b for i, b in enumerate(before) if i != 2])
        self.assertEqual(preview['changes'], [{'line': 3, 'before': before[2], 'after': after[2]}])

    def test_a_new_owner_goes_before_due_or_status_else_last_quoted_when_needed(self):
        self.p.act(kind='log-owner', ids=['D-003', 'D-004'], owner='Rossi, Mario')
        self.assertEqual(self.line('D-003'), '  - { id: D-003, date: 2026-11-04, kind: action, source: meeting, text: "l\'ordine", owner: \'Rossi, Mario\', status: open }')
        self.assertEqual(self.line('D-004'), "  - { id: D-004, date: 2026-11-05, kind: action, source: manual, text: call back, owner: 'Rossi, Mario' }")

    def test_removing_the_owner_drops_the_field(self):
        result, preview = self.p.act(kind='log-owner', ids=['D-002'], owner='')
        self.assertEqual(preview['summary'], 'Remove the owner of D-002')
        self.assertEqual(self.line('D-002'), "  - { id: D-002, date: 2026-11-04, kind: action, source: meeting, text: 'send the file, today', due: 2026-11-04, status: open }")

    def test_several_actions_with_those_left_out(self):
        _, preview = self.p.act(kind='log-owner', ids=['D-001', 'D-002', 'D-003', 'D-005', 'D-009'], owner='Roberta')
        self.assertEqual(preview['summary'], 'Assign Roberta to D-003')
        self.assertEqual([s['reason'] for s in preview['skipped']], [
            'D-001 is not an action: only an action has an owner', 'D-002 is already owned by Roberta',
            'D-005 is done: only an open action is assigned', 'D-009 not found'])
        self.assertIn('owner: Roberta, status: open', self.line('D-003'))

    def test_refused(self):
        cases = ((dict(ids=['D-002'], owner='Marco'), 'Marco is no person of roles or team.people'),
                 (dict(ids=['D-002'], owner='Finizio (Secretary)'), 'is no person'),
                 (dict(ids=['D-004'], owner=''), 'nothing to unassign: D-004 has no owner'),
                 (dict(ids=[], owner='Roberta'), 'pick from 1 to 50 actions'),
                 (dict(ids=['../x'], owner='Roberta'), 'pick from 1 to 50 actions'),
                 (dict(ids=['D-002'], owner=None), 'an owner is a name'))
        for request, message in cases:
            with self.subTest(message), self.assertRaisesRegex(ds.ActionError, message):
                self.p.act(kind='log-owner', **request)
        self.assertEqual(self.p.read('.pm/registers/daily-log.yaml'), LOG)

    def test_a_block_entry_is_not_edited(self):
        self.p.write('.pm/registers/daily-log.yaml', 'entries:\n  - id: D-002\n    kind: action\n    text: x\n')
        with self.assertRaisesRegex(ds.ActionError, 'D-002 is not a one-line entry'):
            self.p.act(kind='log-owner', ids=['D-002'], owner='Roberta')

    def test_a_change_after_the_preview_is_refused(self):
        answer, _ = ds.run_action(self.p.home, {'project': self.p.root, 'kind': 'log-owner', 'ids': ['D-004'], 'owner': 'Roberta'})
        self.p.write('.pm/registers/daily-log.yaml', LOG.replace('call back', 'call back soon'))
        with self.assertRaisesRegex(ds.ActionError, 'changed since the preview'):
            ds.run_action(self.p.home, {'project': self.p.root, 'kind': 'log-owner', 'ids': ['D-004'], 'owner': 'Roberta', 'confirm': answer['hash']})


class RegisterAdd(unittest.TestCase):
    """The contextual dialogs of the desk: Log, + problem, + risk append one entry to their register."""

    def setUp(self):
        self.p = Project()
        self.p.write('.pm/project.yaml', PEOPLE)
        self.p.write('.pm/registers/daily-log.yaml', LOG)
        self.today = ds.time.strftime('%Y-%m-%d')

    def tearDown(self):
        self.p.temp.cleanup()

    def test_a_log_action_is_appended_with_the_next_id_its_owner_as_the_roles_name_it(self):
        result, preview = self.p.act(kind='log-add', type='action', text='call the bank', owner='finizio', due='2026-12-01')
        line = f"  - {{ id: D-006, date: {self.today}, kind: action, source: manual, text: 'call the bank', owner: Finizio, due: 2026-12-01, status: open }}"
        self.assertEqual(self.p.read('.pm/registers/daily-log.yaml'), LOG + line + '\n')
        self.assertEqual(preview['summary'], 'Add D-006 to the daily log')
        self.assertEqual(preview['changes'], [{'line': 7, 'before': '', 'after': line}])
        self.assertEqual(result['done'], ['D-006 written'])

    def test_a_problem_creates_its_register_when_missing(self):
        _, preview = self.p.act(kind='problem-add', title='Test server down', type='problem', priority='high')
        self.assertEqual(self.p.read('.pm/registers/issues.yaml'),
                         f'issues:\n  - id: I-001\n    title: Test server down\n    type: problem\n    priority: high\n    status: open\n    raised: {self.today}\n')
        self.assertEqual((preview['summary'], preview['file']), ('Add problem I-001', os.path.join('.pm', 'registers', 'issues.yaml')))

    def test_a_risk_is_appended_without_a_verdict(self):
        self.p.write('.pm/registers/risks.yaml', 'risks: []\n')
        _, preview = self.p.act(kind='risk-add', title='Key user leaves', cause='one person knows the process', category='threat',
                                probability='medium', impact='high', owner='Eva Neri', response='reduce', actions='pair a second user, write the manual')
        self.assertEqual(self.p.read('.pm/registers/risks.yaml'), 'risks:\n  - id: R-001\n    title: Key user leaves\n    cause: "one person knows the process"\n'
                         '    category: threat\n    probability: medium\n    impact: high\n    owner: Eva Neri\n    status: open\n    response: reduce\n'
                         '    response_actions: "pair a second user, write the manual"\n')
        self.assertEqual(preview['changes'][0], {'line': 1, 'before': 'risks: []', 'after': 'risks:'})

    def test_refused_and_nothing_written(self):
        cases = ((dict(kind='log-add', type='action', text='x', owner='Marco'), 'Marco is no person of roles or team.people'),
                 (dict(kind='log-add', type='note', text='  '), 'a log entry needs a text'),
                 (dict(kind='problem-add', title='x', type='problem', priority=None), 'a priority is low, medium or high'),
                 (dict(kind='risk-add', title='x', category='threat', probability='high', impact=3), 'probability and impact'),
                 (dict(kind='risk-add', title=['x'], category='threat', probability='high', impact='high'), 'a risk needs a title'))
        for request, message in cases:
            with self.subTest(message), self.assertRaisesRegex(ds.ActionError, message):
                self.p.act(**request)
        self.assertEqual(self.p.read('.pm/registers/daily-log.yaml'), LOG)
        self.assertFalse(os.path.exists(os.path.join(self.p.root, '.pm', 'registers', 'issues.yaml')))
        self.assertFalse(os.path.exists(os.path.join(self.p.root, '.pm', 'registers', 'risks.yaml')))

    def test_a_preview_writes_nothing_and_a_change_after_it_is_refused(self):
        answer, changed = ds.run_action(self.p.home, {'project': self.p.root, 'kind': 'log-add', 'type': 'note', 'text': 'a note'})
        self.assertFalse(changed)
        self.assertEqual(self.p.read('.pm/registers/daily-log.yaml'), LOG)
        self.p.write('.pm/registers/daily-log.yaml', LOG + "  - { id: D-006, date: 2026-11-06, kind: note, text: 'meanwhile' }\n")
        with self.assertRaisesRegex(ds.ActionError, 'changed since the preview'):
            ds.run_action(self.p.home, {'project': self.p.root, 'kind': 'log-add', 'type': 'note', 'text': 'a note', 'confirm': answer['hash']})


def shared_cases():
    """server/edit-cases.mjs: one JSON array behind `export default`, run by this suite and tests/edits.test.ts."""
    with open(os.path.join(os.path.dirname(__file__), 'edit-cases.mjs')) as handle:
        return json.loads(handle.read().split('export default', 1)[1])


class ChangedStamp(unittest.TestCase):
    def test_a_write_stamps_when_and_where(self):
        with tempfile.TemporaryDirectory() as home:
            before = int(ds.time.time() * 1000)
            ds.mark_changed(home, '/p')
            with open(os.path.join(home, ds.DESK_DIR, ds.CHANGED_FILE)) as handle:
                stamp = json.load(handle)
            self.assertEqual(stamp['project'], '/p')
            self.assertGreaterEqual(stamp['at'], before)


class SharedCases(unittest.TestCase):
    def test_the_pane_and_the_helper_edit_alike(self):
        for case in shared_cases():
            with self.subTest(case['name']):
                if case['op'] == 'key':
                    run = lambda: ds.set_key(case['text'], case['key'], case['value'])
                elif case['op'] == 'status':
                    run = lambda: ds.set_wp_status(case['text'], case['id'], case['value'])
                elif case['op'] == 'place':
                    with self.subTest(case['name']):
                        if 'error' in case:
                            with self.assertRaisesRegex(ds.ActionError, case['error']):
                                ds.place_wp(case['files'], case['target'], case['horizon'], case['beside'], case['side'])
                        else:
                            self.assertEqual(ds.place_wp(case['files'], case['target'], case['horizon'], case['beside'], case['side']), case['expect'])
                    continue
                elif case['op'] in ('log', 'problem', 'risk'):
                    if case['op'] == 'log':
                        add = lambda: ds.add_log_entry(case['text'], case['day'], case['kind'], case['entryText'], case['owner'], case['due'])
                    elif case['op'] == 'problem':
                        add = lambda: ds.add_problem(case['text'], case['day'], case['title'], case['type'], case['priority'])
                    else:
                        add = lambda: ds.add_risk(case['text'], case['risk'])
                    if 'error' in case:
                        with self.assertRaisesRegex(ds.ActionError, case['error']):
                            add()
                    else:
                        new_text, entry_id, changes = add()
                        self.assertEqual({'text': new_text, 'id': entry_id, 'changes': changes}, case['expect'])
                    continue
                else:
                    run = lambda: ds.set_note_status(case['text'], case['sha'], case['noteText'], case['value'])
                if 'error' in case:
                    with self.assertRaisesRegex(ds.ActionError, case['error']):
                        run()
                else:
                    new_text, change = run()
                    self.assertEqual({'text': new_text, **change}, case['expect'])


class FakeForge:
    forge, host, repo = 'github', 'github.com', 'o/r'

    def __init__(self, milestones, items):
        self.ms, self.items, self.calls = milestones, items, []

    def milestones(self):
        return self.ms

    milestone_key = ds.Forge.milestone_key

    def open_items(self, milestone):
        return [i for i in self.items.values() if (i.get('milestone') or {}).get('title') == milestone['title']]

    def call(self, method, path, body=None):
        self.calls.append((method, path, body))
        if method == 'GET':
            number = int(path.rsplit('/', 1)[1])
            if number not in self.items:
                raise ds.ActionError('HTTP 404')
            return self.items[number]
        if method == 'POST':
            return {'number': 9, 'title': body['title']}
        return {}


class Package(unittest.TestCase):
    def setUp(self):
        self.p = Project()
        self.forge = FakeForge([{'number': 3, 'title': 'Old', 'state': 'open'}], {
            12: {'number': 12, 'title': 'Login', 'state': 'open', 'milestone': None},
            18: {'number': 18, 'title': 'Fix', 'state': 'open', 'milestone': {'title': 'Old'}, 'pull_request': {}},
            20: {'number': 20, 'title': 'Done', 'state': 'closed', 'milestone': None},
        })

    def tearDown(self):
        self.p.temp.cleanup()

    def run_package(self, **request):
        base = {'project': self.p.root, 'kind': 'package', **request}
        answer, _ = ds.run_action(self.p.home, base, self.forge)
        return answer, ds.run_action(self.p.home, {**base, 'confirm': answer['hash']}, self.forge)[0]

    def test_a_package_creates_the_milestone_assigns_the_items_and_writes_the_work_package(self):
        answer, result = self.run_package(refs=['#12', 'PR #18', '#20', '#99'], title='Login', move=['PR #18'])
        preview = answer['preview']
        self.assertEqual(preview['milestone'], {'title': 'Login', 'action': 'create', 'closed': False})
        self.assertEqual([i['ref'] for i in preview['assign']], ['#12'])
        self.assertEqual([(i['ref'], i['milestone']) for i in preview['others']], [('PR #18', 'Old')])
        self.assertEqual([s['ref'] for s in preview['skipped']], ['#20', '#99'])
        self.assertEqual(result['done'], ['milestone Login created', '#12 assigned', 'PR #18 assigned', 'WP-02 written'])
        self.assertIn(('PATCH', 'repos/o/r/issues/18', {'milestone': 9}), self.forge.calls)
        self.assertEqual(self.p.read('.pm/work-packages/WP-02.md'),
                         '---\nid: WP-02\ntitle: Login\nproduct: work-package\nstage: 2\nstatus: draft\nmilestone: Login\n---\n\n'
                         '# Login\n\nPackaged items:\n\n- #12 Login\n- PR #18 Fix\n')

    def test_an_item_in_another_milestone_stays_unless_moved(self):
        self.run_package(refs=['#12', 'PR #18'], title='Login')
        self.assertNotIn(('PATCH', 'repos/o/r/issues/18', {'milestone': 9}), self.forge.calls)

    def test_the_work_package_of_an_existing_milestone(self):
        answer, result = self.run_package(title='Old', fromMilestone=True)
        self.assertEqual(answer['preview']['milestone']['action'], 'reuse')
        self.assertEqual(result['done'], ['WP-02 written'])
        self.assertIn('- PR #18 Fix', self.p.read('.pm/work-packages/WP-02.md'))
        with self.assertRaisesRegex(ds.ActionError, 'already carries'):
            self.run_package(title='Old', fromMilestone=True)


TEAM = ('name: P\nstage: { current: 2 }\nteam:\n  wip_limit: 3\n  people:\n    Davide Paci: { login: dgpaci, wip_limit: 4 }\n'
        '    "Marco Bianchi": { login: mbianchi }  # a comment\nreporting:\n  people:\n    Eve: { login: eve }\n')


class Assign(unittest.TestCase):
    def setUp(self):
        self.p = Project()
        self.p.write('.pm/project.yaml', TEAM)
        self.forge = FakeForge([], {
            12: {'number': 12, 'title': 'Login', 'state': 'open', 'assignees': [{'login': 'dgpaci'}]},
            18: {'number': 18, 'title': 'Fix', 'state': 'open', 'assignees': None, 'pull_request': {}},
            20: {'number': 20, 'title': 'Done', 'state': 'closed', 'assignees': []},
        })

    def tearDown(self):
        self.p.temp.cleanup()

    def assign(self, **request):
        base = {'project': self.p.root, 'kind': 'assign', **request}
        answer, _ = ds.run_action(self.p.home, base, self.forge)
        return answer, ds.run_action(self.p.home, {**base, 'confirm': answer['hash']}, self.forge)[0]

    def test_the_team_logins_are_read_from_team_people_only(self):
        self.assertEqual(ds.team_logins(self.p.root), {'dgpaci': 'Davide Paci', 'mbianchi': 'Marco Bianchi'})

    def test_the_preview_shows_the_assignees_before_and_after_and_confirm_patches_them(self):
        answer, result = self.assign(number=12, login='mbianchi', op='add')
        preview = answer['preview']
        self.assertEqual((preview['summary'], preview['item']['kind'], preview['before'], preview['after']),
                         ('Assign Marco Bianchi to #12', 'issue', ['dgpaci'], ['dgpaci', 'mbianchi']))
        self.assertEqual(self.forge.calls[-1], ('PATCH', 'repos/o/r/issues/12', {'assignees': ['dgpaci', 'mbianchi']}))
        self.assertEqual(result['done'], ['#12 assignees: dgpaci, mbianchi'])

    def test_a_pull_request_with_no_assignee_and_a_removal(self):
        answer, _ = self.assign(number=18, login='dgpaci', op='add')
        self.assertEqual((answer['preview']['item']['ref'], answer['preview']['before']), ('PR #18', []))
        answer, _ = self.assign(number=12, login='dgpaci', op='remove')
        self.assertEqual(answer['preview']['summary'], 'Unassign Davide Paci from #12')
        self.assertEqual(self.forge.calls[-1], ('PATCH', 'repos/o/r/issues/12', {'assignees': []}))

    def test_only_logins_of_team_people_on_open_items_and_real_changes(self):
        for login in ('eve', 'someone', None):
            with self.assertRaisesRegex(ds.ActionError, 'not a login of team.people'):
                self.assign(number=12, login=login, op='add')
        with self.assertRaisesRegex(ds.ActionError, 'already assigned'):
            self.assign(number=12, login='dgpaci', op='add')
        with self.assertRaisesRegex(ds.ActionError, 'not assigned'):
            self.assign(number=18, login='dgpaci', op='remove')
        with self.assertRaisesRegex(ds.ActionError, 'closed'):
            self.assign(number=20, login='dgpaci', op='add')
        for number, op in ((True, 'add'), ('12', 'add'), (12, 'toggle')):
            with self.assertRaises(ds.ActionError):
                self.assign(number=number, login='dgpaci', op=op)
        self.assertFalse([c for c in self.forge.calls if c[0] == 'PATCH'])

    def test_a_change_on_the_forge_between_preview_and_confirm_is_refused(self):
        base = {'project': self.p.root, 'kind': 'assign', 'number': 12, 'login': 'mbianchi', 'op': 'add'}
        answer, _ = ds.run_action(self.p.home, base, self.forge)
        self.forge.items[12]['assignees'] = [{'login': 'dgpaci'}, {'login': 'other'}]
        with self.assertRaisesRegex(ds.ActionError, 'changed since the preview'):
            ds.run_action(self.p.home, {**base, 'confirm': answer['hash']}, self.forge)
        self.assertFalse([c for c in self.forge.calls if c[0] == 'PATCH'])

    def test_a_checkout_without_pm_is_read_only(self):
        pm = os.path.join(self.p.root, '.pm')
        os.rename(pm, pm + '-gone')
        with self.assertRaisesRegex(ds.ActionError, 'read-only'):
            self.assign(number=12, login='mbianchi', op='add')


class AssignMany(unittest.TestCase):
    """One member assigned to, or unassigned from, the issues and pull requests picked on the Activity or Team tab, in one preview and one Confirm."""
    setUp, tearDown = Assign.setUp, Assign.tearDown

    def assign_many(self, **request):
        base = {'project': self.p.root, 'kind': 'assign-many', **request}
        answer, _ = ds.run_action(self.p.home, base, self.forge)
        return answer, ds.run_action(self.p.home, {**base, 'confirm': answer['hash']}, self.forge)[0]

    def test_the_picked_items_are_patched_and_the_closed_or_held_ones_left_out(self):
        answer, result = self.assign_many(numbers=[12, 18, 20, 18], login='dgpaci')
        preview = answer['preview']
        self.assertEqual(preview['summary'], 'Assign Davide Paci to 1 item')
        self.assertEqual([(i['ref'], i['before'], i['after']) for i in preview['items']], [('PR #18', [], ['dgpaci'])])
        self.assertEqual(preview['skipped'], [{'ref': '#12', 'reason': 'dgpaci already assigned'}, {'ref': '#20', 'reason': 'closed'}])
        self.assertEqual([c for c in self.forge.calls if c[0] == 'PATCH'], [('PATCH', 'repos/o/r/issues/18', {'assignees': ['dgpaci']})])
        self.assertEqual(result['done'], ['PR #18 assignees: dgpaci'])

    def test_two_items_and_the_refusals(self):
        answer, result = self.assign_many(numbers=[12, 18], login='mbianchi')
        self.assertEqual(answer['preview']['summary'], 'Assign Marco Bianchi to 2 items')
        self.assertEqual(result['done'], ['#12 assignees: dgpaci, mbianchi', 'PR #18 assignees: mbianchi'])
        with self.assertRaisesRegex(ds.ActionError, 'nothing to assign'):
            self.assign_many(numbers=[20], login='dgpaci')
        with self.assertRaisesRegex(ds.ActionError, 'not a login of team.people'):
            self.assign_many(numbers=[12], login='eve')
        for numbers in ([], None, [True], ['12'], list(range(1, ds.MAX_ASSIGN_MANY + 2))):
            with self.assertRaises(ds.ActionError):
                self.assign_many(numbers=numbers, login='dgpaci')

    def test_remove_unassigns_the_member_and_leaves_out_who_does_not_hold_it(self):
        answer, result = self.assign_many(numbers=[12, 18, 20], login='dgpaci', op='remove')
        preview = answer['preview']
        self.assertEqual(preview['summary'], 'Unassign Davide Paci from 1 item')
        self.assertEqual([(i['ref'], i['before'], i['after']) for i in preview['items']], [('#12', ['dgpaci'], [])])
        self.assertEqual(preview['skipped'], [{'ref': 'PR #18', 'reason': 'dgpaci not assigned'}, {'ref': '#20', 'reason': 'closed'}])
        self.assertEqual([c for c in self.forge.calls if c[0] == 'PATCH'], [('PATCH', 'repos/o/r/issues/12', {'assignees': []})])
        self.assertEqual(result['done'], ['#12 assignees: none'])
        with self.assertRaisesRegex(ds.ActionError, 'nothing to unassign'):
            self.assign_many(numbers=[18], login='mbianchi', op='remove')
        with self.assertRaisesRegex(ds.ActionError, 'op is add or remove'):
            self.assign_many(numbers=[12], login='dgpaci', op='swap')


class IssueMilestone(unittest.TestCase):
    """Attaching an issue or pull request to a work package's milestone: `number` is the key on GitHub, `id` on Forgejo."""

    def setUp(self):
        self.p = Project()
        self.p.write('.pm/work-packages/WP-02.md', '---\nid: WP-02\ntitle: Login\nstatus: draft\nmilestone: Login\n---\n')
        self.p.write('.pm/work-packages/WP-03.md', '---\nid: WP-03\ntitle: Gone\nstatus: draft\nmilestone: Gone\n---\n')
        self.p.write('.pm/work-packages/WP-04.md', '---\nid: WP-04\nstatus: draft\n---\n')
        self.forge = FakeForge([{'number': 3, 'id': 103, 'title': 'Old', 'state': 'open'}, {'number': 9, 'id': 109, 'title': 'Login', 'state': 'closed'}], {
            12: {'number': 12, 'title': 'Login form', 'state': 'open', 'milestone': None},
            18: {'number': 18, 'title': 'Fix', 'state': 'open', 'milestone': {'number': 3, 'id': 103, 'title': 'Old'}, 'pull_request': {}},
            19: {'number': 19, 'title': 'There', 'state': 'open', 'milestone': {'number': 9, 'id': 109, 'title': 'Login'}},
            20: {'number': 20, 'title': 'Done', 'state': 'closed', 'milestone': None},
        })

    def tearDown(self):
        self.p.temp.cleanup()

    def attach(self, **request):
        base = {'project': self.p.root, 'kind': 'issue-milestone', **request}
        answer, _ = ds.run_action(self.p.home, base, self.forge)
        return answer['preview'], ds.run_action(self.p.home, {**base, 'confirm': answer['hash']}, self.forge)[0]

    def test_the_preview_shows_the_item_the_old_and_new_milestone_and_confirm_patches_it(self):
        preview, result = self.attach(number=12, wp='WP-02')
        self.assertEqual((preview['summary'], preview['forge'], preview['item']['kind'], preview['before'], preview['milestone']),
                         ('Attach #12 to Login (WP-02)', 'github.com/o/r', 'issue', '', {'title': 'Login', 'key': 9, 'closed': True, 'action': 'reuse'}))
        self.assertIsNone(preview['link'])
        self.assertEqual(self.forge.calls[-1], ('PATCH', 'repos/o/r/issues/12', {'milestone': 9}))
        self.assertEqual(result['done'], ['#12 in milestone Login'])

    def test_an_item_in_another_milestone_is_a_move_and_forgejo_takes_the_id(self):
        self.forge.forge = 'forgejo'
        preview, _ = self.attach(number=18, wp='WP-02')
        self.assertEqual((preview['summary'], preview['item']['ref'], preview['before']), ('Move PR #18 from Old to Login (WP-02)', 'PR #18', 'Old'))
        self.assertEqual(self.forge.calls[-1], ('PATCH', 'repos/o/r/issues/18', {'milestone': 109}))

    def test_refused_already_there_no_milestone_unknown_milestone_closed_item(self):
        cases = ((dict(number=19, wp='WP-02'), 'already in milestone Login'),
                 (dict(number=12, wp='WP-04'), 'WP-04 has no milestone and no title'),
                 (dict(number=12, wp='WP-03'), 'milestone Gone of WP-03 is not on'),
                 (dict(number=20, wp='WP-02'), 'closed'),
                 (dict(number=12, wp='WP-99'), 'not found'),
                 (dict(number='12', wp='WP-02'), 'is a number'))
        for request, message in cases:
            with self.subTest(request=request), self.assertRaisesRegex(ds.ActionError, message):
                self.attach(**request)
        self.assertFalse([c for c in self.forge.calls if c[0] == 'PATCH'])

    def test_a_work_package_without_milestone_gets_one_named_after_it_created_then_linked(self):
        self.p.write('.pm/work-packages/WP-05.md', '---\nid: WP-05\ntitle: Docs\nstatus: draft\n---\n')
        preview, result = self.attach(number=18, wp='WP-05')
        self.assertEqual((preview['summary'], preview['before'], preview['milestone']),
                         ('Attach PR #18 to WP-05 — create milestone Docs', 'Old', {'title': 'Docs', 'key': None, 'closed': False, 'action': 'create'}))
        self.assertEqual((preview['link']['file'], preview['link']['change']['after']), ('.pm/work-packages/WP-05.md', 'milestone: Docs'))
        self.assertEqual(self.forge.calls[-2:], [('POST', 'repos/o/r/milestones', {'title': 'Docs'}), ('PATCH', 'repos/o/r/issues/18', {'milestone': 9})])
        self.assertIn('milestone: Docs\n', self.p.read('.pm/work-packages/WP-05.md'))
        self.assertEqual(result['done'], ['milestone Docs created', 'PR #18 in milestone Docs', 'WP-05 linked to milestone Docs'])

    def test_a_milestone_already_carrying_the_title_is_reused_and_forgejo_takes_its_id(self):
        self.forge.forge = 'forgejo'
        self.p.write('.pm/work-packages/WP-05.md', '---\nid: WP-05\ntitle: Old\nstatus: draft\n---\n')
        preview, _ = self.attach(number=12, wp='WP-05')
        self.assertEqual((preview['summary'], preview['milestone']['key'], preview['milestone']['action']), ('Attach #12 to WP-05 — reuse milestone Old', 103, 'reuse'))
        self.assertFalse([c for c in self.forge.calls if c[0] == 'POST'])
        self.assertEqual(self.forge.calls[-1], ('PATCH', 'repos/o/r/issues/12', {'milestone': 103}))
        self.assertIn('milestone: Old\n', self.p.read('.pm/work-packages/WP-05.md'))

    def test_a_work_package_edited_between_preview_and_confirm_is_refused_before_the_forge(self):
        self.p.write('.pm/work-packages/WP-05.md', '---\nid: WP-05\ntitle: Docs\nstatus: draft\n---\n')
        base = {'project': self.p.root, 'kind': 'issue-milestone', 'number': 12, 'wp': 'WP-05'}
        answer, _ = ds.run_action(self.p.home, base, self.forge)
        self.p.write('.pm/work-packages/WP-05.md', '---\nid: WP-05\ntitle: Docs\nstatus: authorized\n---\n')
        with self.assertRaisesRegex(ds.ActionError, 'changed since the preview'):
            ds.run_action(self.p.home, {**base, 'confirm': answer['hash']}, self.forge)
        self.assertFalse([c for c in self.forge.calls if c[0] in ('POST', 'PATCH')])

    def test_a_change_on_the_forge_between_preview_and_confirm_is_refused(self):
        base = {'project': self.p.root, 'kind': 'issue-milestone', 'number': 12, 'wp': 'WP-02'}
        answer, _ = ds.run_action(self.p.home, base, self.forge)
        self.forge.items[12]['milestone'] = {'number': 3, 'title': 'Old'}
        with self.assertRaisesRegex(ds.ActionError, 'changed since the preview'):
            ds.run_action(self.p.home, {**base, 'confirm': answer['hash']}, self.forge)
        self.assertFalse([c for c in self.forge.calls if c[0] == 'PATCH'])


class IssueCreate(unittest.TestCase):
    """A new issue from the desk: the title, and optionally a work package's milestone and a team member to assign."""

    def setUp(self):
        self.p = Project()
        self.p.write('.pm/project.yaml', TEAM)
        self.p.write('.pm/work-packages/WP-02.md', '---\nid: WP-02\ntitle: Login\nstatus: draft\nmilestone: Login\n---\n')
        self.forge = FakeForge([{'number': 9, 'id': 109, 'title': 'Login', 'state': 'open'}], {})

    def tearDown(self):
        self.p.temp.cleanup()

    def create(self, **request):
        base = {'project': self.p.root, 'kind': 'issue-create', **request}
        answer, _ = ds.run_action(self.p.home, base, self.forge)
        return answer['preview'], ds.run_action(self.p.home, {**base, 'confirm': answer['hash']}, self.forge)[0]

    def test_the_preview_shows_title_milestone_and_assignee_and_confirm_posts_them(self):
        preview, result = self.create(title=' Export CSV ', body='## Why\nx', wp='WP-02', login='mbianchi')
        self.assertEqual((preview['summary'], preview['issue'], preview['milestone'], preview['assignee']),
                         ('Create issue Export CSV', {'title': 'Export CSV', 'body': '## Why\nx'}, {'title': 'Login', 'key': 9, 'closed': False},
                          {'login': 'mbianchi', 'person': 'Marco Bianchi'}))
        self.assertEqual(self.forge.calls[-1], ('POST', 'repos/o/r/issues', {'title': 'Export CSV', 'body': '## Why\nx', 'milestone': 9, 'assignees': ['mbianchi']}))
        self.assertEqual(result['done'], ['#9 created in Login, assigned to Marco Bianchi'])

    def test_a_bare_issue_and_forgejo_takes_the_milestone_id(self):
        preview, result = self.create(title='Bare')
        self.assertEqual((preview['milestone'], preview['assignee']), (None, None))
        self.assertEqual(self.forge.calls[-1], ('POST', 'repos/o/r/issues', {'title': 'Bare', 'body': ''}))
        self.assertEqual(result['done'], ['#9 created'])
        self.forge.forge = 'forgejo'
        self.create(title='On Forgejo', wp='WP-02')
        self.assertEqual(self.forge.calls[-1][2]['milestone'], 109)

    def test_refused_without_title_off_team_or_without_milestone(self):
        self.p.write('.pm/work-packages/WP-03.md', '---\nid: WP-03\ntitle: Gone\nstatus: draft\nmilestone: Gone\n---\n')
        cases = ((dict(title='  '), 'needs a title'), (dict(title='a\nb'), 'needs a title'), (dict(title='x' * 201), 'needs a title'),
                 (dict(title='x', body=3), 'the body is text'), (dict(title='x', login='eve'), 'not a login of team.people'),
                 (dict(title='x', wp='WP-01'), 'WP-01 has no milestone'), (dict(title='x', wp='WP-03'), 'milestone Gone of WP-03 is not on'),
                 (dict(title='x', wp='WP-99'), 'not found'))
        for request, message in cases:
            with self.subTest(request=request), self.assertRaisesRegex(ds.ActionError, message):
                self.create(**request)
        self.assertFalse([c for c in self.forge.calls if c[0] == 'POST'])


class ForgeTransport(unittest.TestCase):
    """The PATCH of an assign as each forge receives it: `gh api --input -` on GitHub, the REST API with the fj token on Forgejo."""

    def forge(self, kind, host, home=''):
        forge = ds.Forge.__new__(ds.Forge)
        forge.forge, forge.host, forge.repo, forge.home = kind, host, 'o/r', home
        return forge

    def test_github_goes_through_gh_api(self):
        seen = {}

        def run(argv, input=None, **kwargs):
            seen.update(argv=argv, input=input)
            return ds.subprocess.CompletedProcess(argv, 0, stdout='{}', stderr='')
        with unittest.mock.patch.object(ds.subprocess, 'run', run):
            self.forge('github', 'github.com').call('PATCH', 'repos/o/r/issues/12', {'assignees': ['dgpaci']})
        self.assertEqual(seen['argv'], ['gh', 'api', '-X', 'PATCH', 'repos/o/r/issues/12', '--input', '-'])
        self.assertEqual(json.loads(seen['input']), {'assignees': ['dgpaci']})

    def test_forgejo_goes_through_the_rest_api_with_the_fj_token(self):
        with tempfile.TemporaryDirectory() as home:
            keys = os.path.join(home, ds.FJ_KEYS)
            os.makedirs(os.path.dirname(keys))
            with open(keys, 'w') as handle:
                json.dump({'hosts': {'hub.example': {'token': 't0k'}}}, handle)
            seen = {}

            class Response(io.BytesIO):
                def __enter__(self):
                    return self

                def __exit__(self, *args):
                    return False

            def urlopen(request, timeout=None):
                seen.update(url=request.full_url, method=request.get_method(), body=json.loads(request.data), auth=request.get_header('Authorization'))
                return Response(b'{}')
            with unittest.mock.patch.object(ds.urllib.request, 'urlopen', urlopen):
                self.forge('forgejo', 'hub.example', home).call('PATCH', 'repos/o/r/issues/18', {'assignees': []})
        self.assertEqual(seen, {'url': 'https://hub.example/api/v1/repos/o/r/issues/18', 'method': 'PATCH', 'body': {'assignees': []}, 'auth': 'token t0k'})


CROSS = (TEAM.replace('reporting:', 'repos:\n  - { remote: github.com/acme/core, label: pm }\n  - { remote: hub.genro.com/acme/app, label: pm }  # the app\n'
                      '  - { remote: hub.genro.com/other/app, label: pm }\nreporting:'))


class CrossRepo(unittest.TestCase):
    """A project listing repos: (issue #89): each action works on the item's own repo, never on the origin."""

    def setUp(self):
        self.p = Project()
        self.p.write('.pm/project.yaml', CROSS)
        self.p.write('.pm/work-packages/WP-01.md', WP.format(status='in-progress').replace('issue: 498\n', 'items: [core#3]\n'))
        core = FakeForge([], {3: {'number': 3, 'title': 'Core pull', 'state': 'open', 'pull_request': {}, 'assignees': []},
                              4: {'number': 4, 'title': 'Core issue', 'state': 'open', 'assignees': [{'login': 'dgpaci'}]}})
        app = FakeForge([], {7: {'number': 7, 'title': 'App issue', 'state': 'open', 'assignees': []},
                             8: {'number': 8, 'title': 'Old', 'state': 'closed', 'assignees': []}})
        app.forge, app.host, app.repo = 'forgejo', 'hub.genro.com', 'acme/app'
        self.forges = {'core': core, 'acme/app': app}

    def tearDown(self):
        self.p.temp.cleanup()

    def act(self, **request):
        base = {'project': self.p.root, **request}
        answer, _ = ds.run_action(self.p.home, base, self.forges)
        return answer['preview'], ds.run_action(self.p.home, {**base, 'confirm': answer['hash']}, self.forges)[0]

    def test_the_repos_are_named_as_the_desk_names_them_and_each_has_its_forge_without_git(self):
        self.assertEqual([(r['name'], r['label']) for r in ds.project_repos(self.p.root)], [('core', 'pm'), ('acme/app', 'pm'), ('other/app', 'pm')])
        self.assertIsNone(ds.project_repos(Project().root))
        with unittest.mock.patch.object(ds.subprocess, 'run', side_effect=AssertionError('git asked')):
            forge = ds.Forge(self.p.root, self.p.home, 'acme/app')
            self.assertEqual((forge.forge, forge.host, forge.repo), ('forgejo', 'hub.genro.com', 'acme/app'))
            self.assertEqual(ds.Forge(self.p.root, self.p.home, 'core').forge, 'github')
            with self.assertRaisesRegex(ds.ActionError, 'name the repo'):
                ds.Forge(self.p.root, self.p.home)
            with self.assertRaisesRegex(ds.ActionError, 'nope is not a repo of repos:'):
                ds.Forge(self.p.root, self.p.home, 'nope')

    def test_assigning_patches_each_item_on_its_own_repo(self):
        preview, result = self.act(kind='assign-many', numbers=['PR core#3', 'acme/app#7', 'acme/app#8'], login='mbianchi')
        self.assertEqual(preview['forge'], 'github.com/o/r, hub.genro.com/acme/app')
        self.assertEqual(result['done'], ['PR core#3 assignees: mbianchi', 'acme/app#7 assignees: mbianchi'])
        self.assertEqual(preview['skipped'], [{'ref': 'acme/app#8', 'reason': 'closed'}])
        self.assertIn(('PATCH', 'repos/acme/app/issues/7', {'assignees': ['mbianchi']}), self.forges['acme/app'].calls)
        with self.assertRaisesRegex(ds.ActionError, 'repo#<n> on a cross-repo project'):
            self.act(kind='assign-many', numbers=[7], login='mbianchi')
        _, result = self.act(kind='assign', repo='acme/app', number=7, login='dgpaci', op='add')
        self.assertEqual(result['done'], ['acme/app#7 assignees: dgpaci'])

    def test_an_item_dropped_on_a_work_package_joins_its_items_and_the_forge_is_only_read(self):
        preview, _ = self.act(kind='wp-items', wp='WP-01', ref='acme/app#7')
        self.assertEqual(preview['summary'], 'Attach acme/app#7 to WP-01')
        self.assertEqual(preview['changes'], [{'line': 7, 'before': 'items: [core#3]', 'after': 'items: [core#3, acme/app#7]'}])
        self.assertIn('items: [core#3, acme/app#7]\n', self.p.read('.pm/work-packages/WP-01.md'))
        self.assertEqual({c[0] for f in self.forges.values() for c in f.calls}, {'GET'})
        with self.assertRaisesRegex(ds.ActionError, 'already an item of WP-01'):
            self.act(kind='wp-items', wp='WP-01', ref='PR core#3')
        with self.assertRaisesRegex(ds.ActionError, 'drop it on the work package'):
            self.act(kind='issue-milestone', number=7, wp='WP-01')

    def test_a_package_writes_a_work_package_naming_its_open_items(self):
        preview, result = self.act(kind='package', title='Login', refs=['PR core#3', 'acme/app#8', 'acme/app#7'])
        self.assertEqual(preview['kind'], 'package-items')
        self.assertEqual(preview['skipped'], [{'ref': 'acme/app#8', 'reason': 'closed'}])
        self.assertEqual(result['done'], ['WP-02 written'])
        self.assertEqual(self.p.read('.pm/work-packages/WP-02.md'),
                         '---\nid: WP-02\ntitle: Login\nproduct: work-package\nstage: 2\nstatus: draft\nitems: [core#3, acme/app#7]\n---\n\n'
                         '# Login\n\nPackaged items:\n\n- PR core#3 Core pull\n- acme/app#7 App issue\n')
        self.assertFalse([c for f in self.forges.values() for c in f.calls if c[0] != 'GET'])

    def test_a_new_issue_is_created_on_the_picked_repo_and_joins_the_work_package(self):
        preview, result = self.act(kind='issue-create', repo='acme/app', title='Export', wp='WP-01', login='dgpaci')
        self.assertEqual(preview['forge'], 'hub.genro.com/acme/app')
        self.assertIsNone(preview['milestone'])
        self.assertEqual(result['done'], ['acme/app#9 created, assigned to Davide Paci', 'acme/app#9 in the items of WP-01'])
        self.assertIn(('POST', 'repos/acme/app/issues', {'title': 'Export', 'body': '', 'assignees': ['dgpaci']}), self.forges['acme/app'].calls)
        self.assertIn('items: [core#3, acme/app#9]\n', self.p.read('.pm/work-packages/WP-01.md'))


class FakeClaude:
    """The headless Claude of Draft with Claude: records the call and answers as told."""

    def __init__(self, answer=None, code=0, stdout=None, stderr='', error=None):
        self.answer, self.code, self.stdout, self.stderr, self.error = answer, code, stdout, stderr, error
        self.calls = []

    def __call__(self, command, cwd, prompt, timeout):
        self.calls.append({'command': command, 'cwd': cwd, 'prompt': prompt, 'timeout': timeout})
        if self.error:
            raise self.error
        return self.code, self.stdout if self.stdout is not None else json.dumps(self.answer), self.stderr

    def flag(self, name):
        command = self.calls[-1]['command']
        return command[command.index(name) + 1]


def claude_answer(fields, cost=0.0123, **extra):
    return {'type': 'result', 'subtype': 'success', 'is_error': False, 'result': json.dumps(fields), 'structured_output': fields, 'total_cost_usd': cost, **extra}


class Draft(unittest.TestCase):
    """Draft with Claude: a headless Claude drafts a dialog's fields with the target's skill; nothing is written."""

    def setUp(self):
        self.p = Project()
        self.p.write('.pm/project.yaml', PEOPLE)

    def tearDown(self):
        self.p.temp.cleanup()

    def draft(self, target, fields, fake, **options):
        return ds.run_draft(self.p.home, {'project': self.p.root, 'target': target, 'fields': fields}, run=fake, claude='/bin/claude', day='2026-11-27', **options)

    def test_an_issue_draft_runs_claude_read_only_in_the_project_with_its_skill_and_schema(self):
        fake = FakeClaude(claude_answer({'title': 'Export the daily log as CSV', 'body': '## Why\nx\n\n## What changes\ny\n\n## Done when\nz',
                                         'remarks': 'No work package\ngiven.'}))
        before = {name: self.p.read(name) for name in ('.pm/project.yaml', '.pm/work-packages/WP-01.md', '.pm/registers/commit-notes.yaml')}
        answer = self.draft('issue', {'title': 'csv export', 'body': 'daily log as csv from the desk', 'wp': 'WP-01'}, fake)
        call = fake.calls[0]
        self.assertEqual(call['cwd'], self.p.root)
        self.assertEqual(call['timeout'], ds.DRAFT_TIMEOUT)
        self.assertEqual(call['command'][:2], ['/bin/claude', '-p'])
        self.assertEqual(fake.flag('--tools'), 'Skill,Read')
        self.assertEqual(fake.flag('--output-format'), 'json')
        self.assertEqual(fake.flag('--model'), 'sonnet')
        self.assertIn('--no-session-persistence', call['command'])
        self.assertIn('--strict-mcp-config', call['command'])
        self.assertIn('Draft only', fake.flag('--append-system-prompt'))
        schema = json.loads(fake.flag('--json-schema'))
        self.assertEqual(sorted(schema['properties']), ['body', 'remarks', 'title'])
        self.assertIn('p2kit:pm-issue', call['prompt'])
        self.assertIn('.pm/work-packages/WP-01.md', call['prompt'])
        self.assertIn('daily log as csv from the desk', call['prompt'])
        self.assertEqual(answer['fields']['title'], 'Export the daily log as CSV')
        self.assertTrue(answer['fields']['body'].startswith('## Why'))
        self.assertEqual((answer['model'], answer['cost'], answer['dropped'], answer['remarks']), ('sonnet', 0.0123, [], 'No work package given.'))
        self.assertNotIn('remarks', answer['fields'])
        self.assertIsInstance(answer['seconds'], int)
        self.assertEqual(before, {name: self.p.read(name) for name in before})
        self.assertFalse(os.path.exists(os.path.join(self.p.root, '.pm', 'registers', 'daily-log.yaml')))

    def test_each_target_names_its_skill_and_its_fields_with_the_helpers_enums(self):
        expected = {'issue': ('pm-issue', ['body', 'remarks', 'title']),
                    'risk': ('pm-risk', ['actions', 'category', 'cause', 'impact', 'probability', 'remarks', 'response', 'title']),
                    'problem': ('pm-problem', ['priority', 'remarks', 'title', 'type']),
                    'log': ('pm-log', ['due', 'kind', 'owner', 'remarks', 'text'])}
        for target, (skill, keys) in expected.items():
            fake = FakeClaude(claude_answer({'title': 't', 'text': 't'}))
            self.draft(target, {'notes': 'x'}, fake, model='haiku')
            schema = json.loads(fake.flag('--json-schema'))
            self.assertEqual(sorted(schema['properties']), keys, target)
            self.assertIn(f'p2kit:{skill} skill', fake.calls[0]['prompt'])
            self.assertEqual(fake.flag('--model'), 'haiku')
        risk = ds.draft_schema('risk', [])['properties']
        self.assertEqual(risk['response']['enum'], list(ds.RISK_RESPONSES))
        self.assertEqual(risk['probability']['enum'], list(ds.LEVELS))
        self.assertEqual(ds.draft_schema('problem', [])['properties']['type']['enum'], list(ds.PROBLEM_TYPES))
        log = ds.draft_schema('log', ds.project_people(self.p.root))['properties']
        self.assertEqual(log['kind']['enum'], list(ds.LOG_KINDS))
        self.assertIn('Finizio', log['owner']['enum'])
        self.assertNotIn('owner', ds.draft_schema('log', [])['properties'])

    def test_an_invalid_value_is_dropped_never_passed_on(self):
        fake = FakeClaude(claude_answer({'title': 'API change\nbefore go-live', 'cause': 'vendor', 'category': 'menace', 'probability': 'HIGH',
                                         'impact': 'high', 'response': 'pray', 'actions': 'watch the changelog'}))
        answer = self.draft('risk', {'title': 'api'}, fake)
        self.assertEqual(answer['fields'], {'title': 'API change before go-live', 'cause': 'vendor', 'impact': 'high', 'actions': 'watch the changelog'})
        self.assertEqual(answer['dropped'], ['category', 'probability', 'response'])

    def test_a_log_draft_keeps_an_owner_of_the_project_and_a_due_day_only_on_an_action(self):
        fake = FakeClaude(claude_answer({'kind': 'action', 'text': 'call the bank', 'owner': 'finizio', 'due': '2026-12-01'}))
        self.assertEqual(self.draft('log', {'text': 'bank'}, fake)['fields'], {'kind': 'action', 'text': 'call the bank', 'owner': 'Finizio', 'due': '2026-12-01'})
        fake = FakeClaude(claude_answer({'kind': 'action', 'text': 'call', 'owner': 'Nobody', 'due': 'next week'}))
        answer = self.draft('log', {'text': 'bank'}, fake)
        self.assertEqual((answer['fields'], answer['dropped']), ({'kind': 'action', 'text': 'call'}, ['due', 'owner']))
        fake = FakeClaude(claude_answer({'kind': 'note', 'text': 'noted', 'owner': 'Roberta', 'due': '2026-12-01'}))
        self.assertEqual(self.draft('log', {'text': 'x'}, fake)['fields'], {'kind': 'note', 'text': 'noted'})

    def test_errors_are_clear_and_nothing_is_drafted(self):
        cases = [
            (FakeClaude(claude_answer({}, is_error=True, result='API Error: overloaded')), 'Claude answered with an error: API Error: overloaded'),
            (FakeClaude(code=1, stdout='', stderr='Invalid API key'), 'Claude answered no JSON (exit 1): Invalid API key'),
            (FakeClaude(claude_answer(None)), 'Claude returned no fields'),
            (FakeClaude(claude_answer({'category': 'menace'})), 'Claude returned no usable field'),
            (FakeClaude(error=FileNotFoundError('no such file')), 'claude did not start: no such file'),
        ]
        for fake, message in cases:
            with self.assertRaises(ds.ActionError) as caught:
                self.draft('risk', {'title': 'x'}, fake)
            self.assertEqual(str(caught.exception), message)

    def test_claude_missing_and_bad_requests_are_refused_before_any_run(self):
        fake = FakeClaude(claude_answer({'title': 't'}))
        with unittest.mock.patch.object(ds, 'claude_path', return_value=None), self.assertRaises(ds.ActionError) as caught:
            ds.run_draft(self.p.home, {'project': self.p.root, 'target': 'issue', 'fields': {}}, run=fake)
        self.assertEqual(str(caught.exception), 'claude is not on PATH: the desk helper cannot draft')
        for request in ({'project': self.p.root, 'target': 'report', 'fields': {}}, {'project': self.p.root, 'target': 'issue', 'fields': {'title': 3}},
                        {'project': '/etc', 'target': 'issue', 'fields': {}}):
            with self.assertRaises(ds.ActionError):
                ds.run_draft(self.p.home, request, run=fake, claude='/bin/claude')
        self.assertEqual(fake.calls, [])

    def test_a_run_past_the_timeout_is_killed(self):
        process = unittest.mock.Mock(pid=4242)
        process.communicate.side_effect = [ds.subprocess.TimeoutExpired('claude', 120), ('', '')]
        with unittest.mock.patch.object(ds.subprocess, 'Popen', return_value=process) as popen, unittest.mock.patch.object(ds.os, 'killpg') as killpg:
            with self.assertRaises(ds.ActionError) as caught:
                ds.run_claude(['claude', '-p'], self.p.root, 'prompt', 120)
        self.assertEqual(str(caught.exception), 'Claude did not answer in 120 s: nothing drafted')
        self.assertTrue(popen.call_args.kwargs['start_new_session'])
        self.assertEqual(popen.call_args.kwargs['cwd'], self.p.root)
        killpg.assert_called_once_with(4242, ds.signal.SIGKILL)

    def test_the_model_comes_from_the_flag_else_the_environment_else_sonnet(self):
        for flag, env, expected in ((None, None, 'sonnet'), (None, 'haiku', 'haiku'), ('opus', 'haiku', 'opus')):
            environ = {key: value for key, value in os.environ.items() if key != 'P2KIT_DRAFT_MODEL'}
            with unittest.mock.patch.dict(ds.os.environ, {**environ, **({'P2KIT_DRAFT_MODEL': env} if env else {})}, clear=True):
                server = ds.make_server(self.p.home, draft_model=flag)
                server.server_close()
            self.assertEqual(server.draft_model, expected)


class Server(unittest.TestCase):
    def setUp(self):
        self.p = Project()
        os.makedirs(os.path.join(self.p.home, '.claude', 'p2kit'))
        with open(os.path.join(self.p.home, '.claude', 'p2kit', 'desk.html'), 'w') as handle:
            handle.write('<html><script type="application/json" id="data">{}</script></html>')
        self.server = ds.make_server(self.p.home)
        self.port = self.server.server_address[1]
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.p.temp.cleanup()

    def request(self, method, path, body=None, **headers):
        connection = http.client.HTTPConnection('127.0.0.1', self.port, timeout=5)
        base = {'Host': f'127.0.0.1:{self.port}', 'Origin': f'http://127.0.0.1:{self.port}', ds.TOKEN_HEADER: self.server.token, 'Content-Type': 'application/json'}
        base.update(headers)
        connection.request(method, path, body=json.dumps(body) if body is not None else None, headers={k: v for k, v in base.items() if v is not None})
        response = connection.getresponse()
        return response.status, response.read().decode()

    def test_the_page_carries_the_token_and_only_our_host_reads_it(self):
        status, page = self.request('GET', '/')
        self.assertEqual(status, 200)
        self.assertIn(self.server.token, page)
        self.assertEqual(self.request('GET', '/', Host='evil.example')[0], 403)

    def test_an_action_needs_host_origin_and_token(self):
        action = {'project': self.p.root, 'kind': 'wp-link', 'target': 'WP-01', 'field': 'branch', 'value': 'feature/1-x'}
        self.assertEqual(self.request('POST', '/action', action, Origin='https://evil.example')[0], 403)
        self.assertEqual(self.request('POST', '/action', action, Origin=None)[0], 403)
        self.assertEqual(self.request('POST', '/action', action, **{ds.TOKEN_HEADER: 'x'})[0], 403)
        self.assertEqual(self.request('POST', '/action', action, Host='evil.example')[0], 403)
        self.assertEqual(self.request('POST', '/action', action, **{'Content-Type': 'text/plain'})[0], 415)
        status, body = self.request('POST', '/action', action)
        self.assertEqual(status, 200)
        digest = json.loads(body)['hash']
        self.assertEqual(self.request('POST', '/action', {**action, 'confirm': digest})[0], 200)
        self.assertIn('branch: feature/1-x', self.p.read('.pm/work-packages/WP-01.md'))
        status, body = self.request('POST', '/action', {**action, 'confirm': digest})
        self.assertEqual(status, 409)

    def test_open_needs_the_token_and_a_path_inside_a_project(self):
        doc = os.path.join(self.p.root, '.pm', 'project.yaml')
        with unittest.mock.patch.object(ds.subprocess, 'run') as run:
            self.assertEqual(self.request('POST', '/open', {'path': doc}, **{ds.TOKEN_HEADER: 'x'})[0], 403)
            self.assertEqual(self.request('POST', '/open', {'path': doc}, Origin='https://evil.example')[0], 403)
            self.assertEqual(self.request('POST', '/open', {'path': '/etc/hosts'})[0], 409)
            self.assertEqual(self.request('POST', '/open', {'path': self.p.root + '/../repo-x'})[0], 409)
            self.assertEqual(self.request('POST', '/open', {'path': os.path.join(self.p.root, 'missing.md')})[0], 409)
            run.assert_not_called()
            status, body = self.request('POST', '/open', {'path': doc})
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(body)['opened'], doc)
        self.assertEqual(run.call_args[0][0][1], doc)

    def test_a_draft_needs_the_token_and_runs_outside_the_action_lock(self):
        draft = {'project': self.p.root, 'target': 'problem', 'fields': {'title': 'server down'}}
        self.assertEqual(self.request('POST', '/draft', draft, **{ds.TOKEN_HEADER: 'x'})[0], 403)
        self.assertEqual(self.request('POST', '/draft', draft, Origin='https://evil.example')[0], 403)
        seen = []

        def fake(home, request, model):
            seen.append(self.server.lock.locked())
            return {'fields': {'title': 'Test server down'}, 'dropped': [], 'model': model, 'seconds': 1, 'cost': 0.01}
        with unittest.mock.patch.object(ds, 'run_draft', side_effect=fake):
            status, body = self.request('POST', '/draft', draft)
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(body)['fields'], {'title': 'Test server down'})
        self.assertEqual(seen, [False])
        with unittest.mock.patch.object(ds, 'run_draft', side_effect=ds.ActionError('claude is not on PATH: the desk helper cannot draft')):
            status, body = self.request('POST', '/draft', draft)
        self.assertEqual((status, json.loads(body)['error']), (409, 'claude is not on PATH: the desk helper cannot draft'))

    def doc(self, path, **headers):
        return self.request('GET', '/doc?path=' + ds.urllib.parse.quote(path), **headers)

    def test_doc_renders_a_markdown_file_of_a_project_as_html(self):
        self.p.write('.pm/brief.md', '---\ntitle: Brief\n---\n# Brief\n\n<script>x</script> **ok**\n')
        connection = http.client.HTTPConnection('127.0.0.1', self.port, timeout=5)
        connection.request('GET', '/doc?path=' + ds.urllib.parse.quote(os.path.join(self.p.root, '.pm', 'brief.md')), headers={'Host': f'127.0.0.1:{self.port}'})
        response = connection.getresponse()
        page = response.read().decode()
        self.assertEqual(response.status, 200)
        self.assertEqual(response.getheader('Content-Type'), 'text/html; charset=utf-8')
        self.assertIn("default-src 'none'", response.getheader('Content-Security-Policy'))
        self.assertIn('<title>Brief</title>', page)
        self.assertIn('&lt;script&gt;x&lt;/script&gt; <strong>ok</strong>', page)
        self.assertNotIn(self.server.token, page)

    def test_doc_refuses_any_other_file_and_other_hosts(self):
        os.makedirs(os.path.join(self.p.home, 'other'))
        outside = os.path.join(self.p.home, 'other', 'secret.md')
        with open(outside, 'w') as handle:
            handle.write('# secret\n')
        os.symlink(outside, os.path.join(self.p.root, 'link.md'))
        self.p.write('.pm/brief.md', '# Brief\n')
        brief = os.path.join(self.p.root, '.pm', 'brief.md')
        self.assertEqual(self.doc(brief, Host='evil.example')[0], 403)
        self.assertEqual(self.doc(outside)[0], 403)
        self.assertEqual(self.doc(os.path.join(self.p.root, 'link.md'))[0], 403)
        self.assertEqual(self.doc(self.p.root + '/.pm/../../other/secret.md')[0], 403)
        self.assertEqual(self.doc(os.path.join(self.p.root, '.pm', 'project.yaml'))[0], 403)
        self.assertEqual(self.doc('.pm/brief.md')[0], 403)
        self.assertEqual(self.doc('')[0], 403)
        self.assertEqual(self.doc(os.path.join(self.p.root, 'missing.md'))[0], 404)
        self.assertEqual(self.request('GET', '/doc')[0], 403)
        self.assertEqual(self.doc(brief)[0], 200)


if __name__ == '__main__':
    unittest.main()
