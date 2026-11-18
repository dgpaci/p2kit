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
        answer, _ = ds.run_action(self.p.home, {'project': self.p.root, 'kind': 'wp-horizon', 'target': 'WP-01', 'value': 'now'})
        self.p.write('.pm/work-packages/WP-01.md', WP.format(status='completed') + '\nedited\n')
        with self.assertRaisesRegex(ds.ActionError, 'changed since the preview'):
            ds.run_action(self.p.home, {'project': self.p.root, 'kind': 'wp-horizon', 'target': 'WP-01', 'value': 'now', 'confirm': answer['hash']})
        self.assertNotIn('horizon', self.p.read('.pm/work-packages/WP-01.md'))

    def test_horizon_and_rank_are_added_before_the_closing_line_and_removed(self):
        self.p.act(kind='wp-horizon', target='WP-01', value='next')
        self.p.act(kind='wp-rank', target='WP-01', value=2)
        text = self.p.read('.pm/work-packages/WP-01.md')
        self.assertIn('issue: 498\nhorizon: next\nrank: 2\n---\n', text)
        self.p.act(kind='wp-horizon', target='WP-01', value='')
        self.assertNotIn('horizon', self.p.read('.pm/work-packages/WP-01.md'))
        with self.assertRaisesRegex(ds.ActionError, 'now, next or later'):
            self.p.act(kind='wp-horizon', target='WP-01', value='soon')
        with self.assertRaisesRegex(ds.ActionError, 'number from 1'):
            self.p.act(kind='wp-rank', target='WP-01', value='2')

    def test_a_key_written_twice_is_refused(self):
        self.p.write('.pm/work-packages/WP-01.md', '---\nid: WP-01\nhorizon: now\nhorizon: next\n---\n')
        with self.assertRaisesRegex(ds.ActionError, 'more than once'):
            self.p.act(kind='wp-horizon', target='WP-01', value='later')

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
            ds.run_action(self.p.home, {'project': self.p.home, 'kind': 'wp-horizon', 'target': 'WP-01', 'value': 'now'})
        for target in ('../x', 'WP-1', 'WP-09'):
            with self.assertRaises(ds.ActionError):
                self.p.act(kind='wp-horizon', target=target, value='now')


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
    """One member assigned to the issues and pull requests picked on the Activity tab, in one preview and one Confirm."""
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
        action = {'project': self.p.root, 'kind': 'wp-horizon', 'target': 'WP-01', 'value': 'now'}
        self.assertEqual(self.request('POST', '/action', action, Origin='https://evil.example')[0], 403)
        self.assertEqual(self.request('POST', '/action', action, Origin=None)[0], 403)
        self.assertEqual(self.request('POST', '/action', action, **{ds.TOKEN_HEADER: 'x'})[0], 403)
        self.assertEqual(self.request('POST', '/action', action, Host='evil.example')[0], 403)
        self.assertEqual(self.request('POST', '/action', action, **{'Content-Type': 'text/plain'})[0], 415)
        status, body = self.request('POST', '/action', action)
        self.assertEqual(status, 200)
        digest = json.loads(body)['hash']
        self.assertEqual(self.request('POST', '/action', {**action, 'confirm': digest})[0], 200)
        self.assertIn('horizon: now', self.p.read('.pm/work-packages/WP-01.md'))
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


if __name__ == '__main__':
    unittest.main()
