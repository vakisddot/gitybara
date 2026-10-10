import { DiffHunk, DiffLineType } from '../../../models/diff'

/**
 * Which lines of the current version of a file differ from the committed one,
 * to mark them in the gutter. Lines are numbered from 0.
 */
export interface ILineChanges {
  /** Lines that are new */
  readonly added: ReadonlySet<number>

  /** Lines that replace other lines */
  readonly modified: ReadonlySet<number>

  /**
   * Lines that have lines removed right before them. The line after the last
   * one is included when lines were removed from the end of the file.
   */
  readonly removedBefore: ReadonlySet<number>
}

export const NoLineChanges: ILineChanges = {
  added: new Set<number>(),
  modified: new Set<number>(),
  removedBefore: new Set<number>(),
}

/**
 * Work out which lines changed from the hunks of the diff between the
 * committed version of a file and the current one.
 *
 * Lines removed and added right next to each other count as modified, as many
 * of them as there are removed lines, and the rest of the added ones as added.
 */
export function getLineChanges(hunks: ReadonlyArray<DiffHunk>): ILineChanges {
  const added = new Set<number>()
  const modified = new Set<number>()
  const removedBefore = new Set<number>()

  for (const hunk of hunks) {
    // The index of the line of the new file that comes next
    let nextLine = Math.max(hunk.header.newStartLine - 1, 0)
    let removedCount = 0
    let addedLines = new Array<number>()

    const endGroup = () => {
      if (removedCount > 0 && addedLines.length === 0) {
        removedBefore.add(nextLine)
      }

      addedLines.forEach((line, i) =>
        (i < removedCount ? modified : added).add(line)
      )

      removedCount = 0
      addedLines = []
    }

    for (const line of hunk.lines) {
      if (line.type === DiffLineType.Delete) {
        removedCount++
      } else if (
        line.type === DiffLineType.Add &&
        line.newLineNumber !== null
      ) {
        addedLines.push(line.newLineNumber - 1)
        nextLine = line.newLineNumber
      } else if (
        line.type === DiffLineType.Context &&
        line.newLineNumber !== null
      ) {
        endGroup()
        nextLine = line.newLineNumber
      } else {
        endGroup()
      }
    }

    endGroup()
  }

  return { added, modified, removedBefore }
}

function isSameSet(a: ReadonlySet<number>, b: ReadonlySet<number>) {
  if (a.size !== b.size) {
    return false
  }

  for (const value of a) {
    if (!b.has(value)) {
      return false
    }
  }

  return true
}

export function isSameLineChanges(a: ILineChanges, b: ILineChanges) {
  return (
    a === b ||
    (isSameSet(a.added, b.added) &&
      isSameSet(a.modified, b.modified) &&
      isSameSet(a.removedBefore, b.removedBefore))
  )
}

/**
 * The first line of each group of lines next to each other that have changes,
 * in order. A group is where "next change" and "previous change" jump to.
 */
export function getChangeGroupStarts(
  changes: ILineChanges,
  lineCount: number
): ReadonlyArray<number> {
  const isChanged = (line: number) =>
    changes.added.has(line) ||
    changes.modified.has(line) ||
    changes.removedBefore.has(line) ||
    // Lines removed from the end of the file are marked on the last line
    (line === lineCount - 1 && changes.removedBefore.has(lineCount))

  const starts = new Array<number>()

  for (let line = 0; line < lineCount; line++) {
    if (isChanged(line) && (line === 0 || !isChanged(line - 1))) {
      starts.push(line)
    }
  }

  return starts
}
