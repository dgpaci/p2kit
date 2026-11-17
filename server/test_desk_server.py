"""Tests of the desk helper: python3 -m unittest discover -s server"""

import http.client
import json
import os
import tempfile
import threading
import unittest

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

    def milestone_key(self, milestone):
        return milestone['number']

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


if __name__ == '__main__':
    unittest.main()
