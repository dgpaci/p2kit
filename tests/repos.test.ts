import { expect, test } from 'claude-code/testing'

import { buildProject } from '../hooks/project'
import { getItemRef, parseItemRef, readItemRefs, readRepos, toRepoTarget } from '../hooks/repos'
import { parseYaml } from '../hooks/yaml'
import type { Value } from '../hooks/yaml'

const reposOf = (yaml: string): Value | undefined => (parseYaml(yaml) as Record<string, Value>).repos

test('repos: lists the repos of a cross-repo project, each named by its repo, owner/repo when two share the name', () => {
  // wf:contract: project.yaml `repos:` is a list of { remote: host/owner/repo, label }; absent, the project reads its origin ([]).
  const errors: string[] = []
  const yaml = 'repos:\n  - { remote: github.com/genropy/genropy, label: privacy }\n  - { remote: hub.genro.com/anaci/anaci, label: privacy }\n'
    + '  - { remote: hub.genro.com/softwell/docs, label: privacy }\n  - { remote: hub.genro.com/icond/docs/, label: 7 }\n'
  expect(readRepos(reposOf(yaml), errors)).toEqual([
    { remote: 'github.com/genropy/genropy', label: 'privacy', name: 'genropy' },
    { remote: 'hub.genro.com/anaci/anaci', label: 'privacy', name: 'anaci' },
    { remote: 'hub.genro.com/softwell/docs', label: 'privacy', name: 'softwell/docs' },
    { remote: 'hub.genro.com/icond/docs', label: '7', name: 'icond/docs' },
  ])
  expect(errors).toEqual([])
  expect(readRepos(undefined, errors)).toEqual([])
})

test('a malformed repos: entry is reported and left out', () => {
  const errors: string[] = []
  const yaml = 'repos:\n  - { remote: github.com/acme/a, label: x }\n  - { remote: github.com/acme/b }\n  - { remote: acme/c, label: x }\n'
    + '  - { remote: GitHub.com/acme/a, label: y }\n  - github.com/acme/d\n'
  expect(readRepos(reposOf(yaml), errors).map(repo => repo.remote)).toEqual(['github.com/acme/a'])
  expect(errors).toEqual([
    'repos: {"remote":"github.com/acme/b"}: expected { remote, label }',
    'repos: acme/c: expected host/owner/repo',
    'repos: GitHub.com/acme/a listed twice',
    'repos: "github.com/acme/d": expected { remote, label }',
  ])
  const other: string[] = []
  expect(readRepos(reposOf('repos: github.com/acme/a\n'), other)).toEqual([])
  expect(other).toEqual(['repos: expected a list of { remote, label }'])
})

test('the project carries its repos, and a repo is read on its own forge', () => {
  const project = buildProject({ path: '/p', project: 'name: P\nrepos:\n  - { remote: github.com/genropy/genropy, label: privacy }\n', products: [], workPackages: [] }, '2026-11-26')
  expect(project.repos).toEqual([{ remote: 'github.com/genropy/genropy', label: 'privacy', name: 'genropy' }])
  expect(buildProject({ path: '/q', project: 'name: Q\n', products: [], workPackages: [] }, '2026-11-26').repos).toEqual([])
  expect(toRepoTarget(project.repos![0]!)).toEqual({ forge: 'github', host: 'github.com', repo: 'genropy/genropy', label: 'privacy', name: 'genropy' })
  expect(toRepoTarget({ remote: 'hub.genro.com/anaci/anaci', label: 'privacy', name: 'anaci' }).forge).toBe('forgejo')
})

test('an item is named with its repo in front on a cross-repo project', () => {
  expect(getItemRef({ number: 5 })).toBe('#5')
  expect(getItemRef({ number: 5 }, 'pr')).toBe('PR #5')
  expect(getItemRef({ repo: 'genropy', number: 498 })).toBe('genropy#498')
  expect(getItemRef({ repo: 'genropy', number: 12 }, 'pr')).toBe('PR genropy#12')
})

test('the items of a work package are references, repo#n or #n, once each', () => {
  // wf:contract: work package `items:` is a list of `repo#n` (a cross-repo project) or `#n` / a bare number; a malformed one is the
  // wf:contract: error `WP-<nn>: items: <entry> is not a reference like repo#12` and is left out.
  const errors: string[] = []
  const items = (parseYaml("items: [genropy#1974, softwell/docs#3, '#12', 13, genropy#1974, 'PR #4', x#]\n") as Record<string, Value>).items
  expect(readItemRefs('WP-01', items, errors)).toEqual(['genropy#1974', 'softwell/docs#3', '#12', '#13'])
  expect(errors).toEqual(['WP-01: items: "PR #4" is not a reference like repo#12', 'WP-01: items: "x#" is not a reference like repo#12'])
  expect(readItemRefs('WP-01', undefined, errors)).toEqual([])
  expect(parseItemRef('genropy#1974')).toEqual({ repo: 'genropy', number: 1974 })
  expect(parseItemRef('#12')).toEqual({ repo: '', number: 12 })
})

test('a work package with only items: is a work theme', () => {
  const wp = '---\nid: WP-01\ntitle: T\nstage: 1\nstatus: in-progress\nitems: [genropy#1974]\n---\n'
  const project = buildProject({ path: '/p', project: 'name: P\nstage: { current: 1 }\n', products: [], workPackages: [{ path: '/p/.pm/work-packages/WP-01.md', text: wp }] }, '2026-11-26')
  expect(project.workPackages[0]!.delivery?.items).toEqual(['genropy#1974'])
})
