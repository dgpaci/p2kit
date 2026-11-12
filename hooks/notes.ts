import type { Commit, CommitNote } from '../types'

// git log fields: full sha, short sha, date, subject — split on the unit separator.
export const LOG_FORMAT = '%H%x1f%h%x1f%ad%x1f%s'

/** The commits of a `git log --format=<LOG_FORMAT>` output, in its order. */
export function parseCommits(text: string): Commit[] {
  return text.split('\n').filter(Boolean).map(line => {
    const [sha, short, date, ...subject] = line.split('\x1f')
    return { sha, short, date, subject: subject.join('\x1f') }
  })
}

/** Whether a note's sha names the commit: one is a prefix of the other, case aside. */
export function isNoteOf(note: CommitNote, commit: Commit): boolean {
  const a = note.sha.toLowerCase()
  const b = commit.sha.toLowerCase()
  return Boolean(a) && (b.startsWith(a) || a.startsWith(b))
}
