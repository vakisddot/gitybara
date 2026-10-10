import { DiffHunk, DiffLine, DiffLineType } from '../../../models/diff'
import { relativeChanges } from '../../diff/changed-range'

export interface IInlineChange {
  readonly line: number
  readonly start: number
  readonly end: number
}

export interface IPreviousLineBlock {
  /** Where the old block belongs in the current file, from 0 (including EOF). */
  readonly line: number
  readonly oldLineNumber: number
  readonly lines: ReadonlyArray<string>
  /** Character removals, with line indices relative to this previous block. */
  readonly inlineChanges: ReadonlyArray<IInlineChange>
}

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

  readonly previousLines: ReadonlyArray<IPreviousLineBlock>
  readonly inlineChanges: ReadonlyArray<IInlineChange>
}

export const NoLineChanges: ILineChanges = {
  added: new Set<number>(),
  modified: new Set<number>(),
  removedBefore: new Set<number>(),
  previousLines: [],
  inlineChanges: [],
}

/** Pair conservatively: shared indentation or punctuation is not enough. */
function canPairLines(before: string, after: string): boolean {
  before = before.trim()
  after = after.trim()
  if (before === after) {
    return true
  }

  const { stringARange, stringBRange } = relativeChanges(before, after)
  const commonText =
    before.slice(0, stringARange.location) +
    before.slice(stringARange.location + stringARange.length)
  const wordLength = (text: string) =>
    text.replace(/[^\p{L}\p{N}_$]/gu, '').length
  const shared = wordLength(commonText)

  // A pure insertion/deletion retains one complete version. Otherwise require
  // at least half of both lines' word characters in the common prefix/suffix.
  return (
    shared > 0 &&
    (stringARange.length === 0 ||
      stringBRange.length === 0 ||
      shared * 2 >= Math.max(wordLength(before), wordLength(after)))
  )
}

/**
 * Work out which lines changed from the hunks of the diff between the
 * committed version of a file and the current one.
 *
 * Pair related lines at the same position in a removal/addition block as
 * modified. Unrelated lines remain separate removals and additions.
 */
export function getLineChanges(hunks: ReadonlyArray<DiffHunk>): ILineChanges {
  const added = new Set<number>()
  const modified = new Set<number>()
  const removedBefore = new Set<number>()
  const previousLines = new Array<IPreviousLineBlock>()
  const inlineChanges = new Array<IInlineChange>()

  for (const hunk of hunks) {
    // The index of the line of the new file that comes next
    let nextLine = Math.max(hunk.header.newStartLine - 1, 0)
    let removedLines = new Array<DiffLine>()
    let addedLines = new Array<{ line: number; content: string }>()

    const endGroup = () => {
      const previousInlineChanges = new Array<IInlineChange>()
      let insertionOnly =
        removedLines.length > 0 && removedLines.length <= addedLines.length
      let hasUnpairedRemovals = removedLines.length > addedLines.length
      addedLines.forEach(({ line, content }, i) => {
        const before = removedLines[i]?.content
        if (before === undefined || !canPairLines(before, content)) {
          added.add(line)
          if (before !== undefined) {
            insertionOnly = false
            hasUnpairedRemovals = true
          }
          return
        }

        modified.add(line)
        const { stringARange, stringBRange } = relativeChanges(before, content)
        insertionOnly = insertionOnly && stringARange.length === 0
        if (stringARange.length > 0) {
          previousInlineChanges.push({
            line: i,
            start: stringARange.location,
            end: stringARange.location + stringARange.length,
          })
        }
        if (stringBRange.length > 0) {
          let start = stringBRange.location
          let end = start + stringBRange.length
          // Repeated identifier prefixes can split an insertion (DiffLine /
          // DiffLineType). Shift an equivalent span to the identifier boundary.
          if (stringARange.length === 0) {
            while (
              start > 0 &&
              /[\p{L}\p{N}_$]/u.test(content[start - 1]) &&
              content[start - 1] === content[end - 1]
            ) {
              start--
              end--
            }
          }
          inlineChanges.push({ line, start, end })
        }
      })

      if (removedLines.length > 0 && !insertionOnly) {
        const line = addedLines[0]?.line ?? nextLine
        previousLines.push({
          line,
          oldLineNumber:
            removedLines[0].oldLineNumber ?? hunk.header.oldStartLine,
          lines: removedLines.map(line => line.content),
          inlineChanges: previousInlineChanges,
        })

        if (hasUnpairedRemovals) {
          removedBefore.add(line)
        }
      }

      removedLines = []
      addedLines = []
    }

    for (const line of hunk.lines) {
      if (line.type === DiffLineType.Delete) {
        removedLines.push(line)
      } else if (
        line.type === DiffLineType.Add &&
        line.newLineNumber !== null
      ) {
        addedLines.push({ line: line.newLineNumber - 1, content: line.content })
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

  return { added, modified, removedBefore, previousLines, inlineChanges }
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

function isSameInlineChanges(
  a: ReadonlyArray<IInlineChange>,
  b: ReadonlyArray<IInlineChange>
) {
  return (
    a.length === b.length &&
    a.every((range, i) => {
      const other = b[i]
      return (
        range.line === other.line &&
        range.start === other.start &&
        range.end === other.end
      )
    })
  )
}

export function isSameLineChanges(a: ILineChanges, b: ILineChanges) {
  return (
    a === b ||
    (isSameSet(a.added, b.added) &&
      isSameSet(a.modified, b.modified) &&
      isSameSet(a.removedBefore, b.removedBefore) &&
      isSameInlineChanges(a.inlineChanges, b.inlineChanges) &&
      a.previousLines.length === b.previousLines.length &&
      a.previousLines.every((block, i) => {
        const other = b.previousLines[i]
        return (
          block.line === other.line &&
          block.oldLineNumber === other.oldLineNumber &&
          block.lines.length === other.lines.length &&
          isSameInlineChanges(block.inlineChanges, other.inlineChanges) &&
          block.lines.every((line, j) => line === other.lines[j])
        )
      }))
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
  // CodeMirror still displays one blank line when the file has become empty.
  lineCount = Math.max(1, lineCount)
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
