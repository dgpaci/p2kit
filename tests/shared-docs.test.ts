import { expect, test } from 'claude-code/testing'

import { buildProject, getDocumentTitle } from '../hooks/project'

test('a shared document takes its title from the HTML title, the Markdown title or heading, else the file name', () => {
  expect(getDocumentTitle('2026-07-16.html', '<html><head><title>ANACI &mdash; 16 luglio 2026</title></head>')).toBe('ANACI — 16 luglio 2026')
  expect(getDocumentTitle('note.md', '---\ntitle: Weekly notes\n---\n# Other')).toBe('Weekly notes')
  expect(getDocumentTitle('note.md', '# Kick-off &amp; scope\n')).toBe('Kick-off & scope')
  expect(getDocumentTitle('scan.pdf', '')).toBe('scan')
  expect(getDocumentTitle('page.html', '<p>no title</p>')).toBe('page')
})

test('the documents of the project.yaml folders follow the products of .pm/, each with its folder', () => {
  const project = buildProject({
    path: '/p',
    project: 'name: P\ndocuments:\n  - anaci_app/report\n',
    products: [{ path: '/p/.pm/brief.md', text: '---\ntitle: Project Brief\n---\n' }],
    workPackages: [],
    sharedDocs: [{ folder: 'anaci_app/report/2_Verbali', path: '/p/anaci_app/report/2_Verbali/2026-07-16.html', title: 'ANACI — 16 luglio 2026' }],
    docErrors: ['documents: folder missing not found'],
  }, '2026-11-16')
  expect(project.documents.map(doc => [doc.folder, doc.title, doc.product])).toEqual([
    ['', 'Project Brief', ''],
    ['anaci_app/report/2_Verbali', 'ANACI — 16 luglio 2026', 'shared'],
  ])
  expect(project.errors).toContain('documents: folder missing not found')
})
