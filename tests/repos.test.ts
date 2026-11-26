import { expect, test } from 'claude-code/testing'

import { buildProject } from '../hooks/project'
import { getItemRef, readRepos, toRepoTarget } from '../hooks/repos'
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
