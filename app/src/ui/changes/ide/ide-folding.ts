import { getIndentColumns } from './ide-indentation'

/**
 * A block of lines that can be folded, numbered from 0. When it's folded the
 * line it starts on stays visible and the lines after it up to the end, which
 * is included, are hidden.
 */
export interface IFoldRange {
  readonly start: number
  readonly end: number
}

/** Lines with only closing brackets, like `}`, `});` or `],`. */
const ClosingBracketsOnly = /^[)\]}][)\]};,]*$/

/**
 * Find the blocks of a file that can be folded, in the order they start. This
 * goes by indentation, so it works the same for any language: a line starts a
 * block when the lines after it are indented deeper. For code with the opening
 * brace on a line of its own, the block starts on the line above the brace.
 * A line with only closing brackets after the block belongs to it.
 */
export function getFoldRanges(
  lines: ReadonlyArray<string>,
  tabSize: number
): ReadonlyArray<IFoldRange> {
  const lineCount = lines.length
  const indentation = lines.map(line => getIndentColumns(line, tabSize))

  // For each line, the first line from it on that isn't blank
  const nextContentLine = new Array<number>(lineCount + 1).fill(lineCount)
  for (let i = lineCount - 1; i >= 0; i--) {
    nextContentLine[i] = indentation[i] === null ? nextContentLine[i + 1] : i
  }

  const ranges = new Array<IFoldRange>()
  const braceLines = new Set<number>()

  for (let start = 0; start < lineCount; start++) {
    const indent = indentation[start]

    if (indent === null || braceLines.has(start)) {
      continue
    }

    let first = nextContentLine[start + 1]

    if (
      first < lineCount &&
      indentation[first] === indent &&
      lines[first].trim() === '{'
    ) {
      // The block starts on this header, not on the brace under it
      braceLines.add(first)
      first = nextContentLine[first + 1]
    }

    if (first >= lineCount || (indentation[first] ?? 0) <= indent) {
      continue
    }

    // The block goes on as long as lines are blank or indented deeper
    let last = first
    let next = first

    while (next < lineCount) {
      const nextIndent = indentation[next]

      if (nextIndent !== null) {
        if (nextIndent <= indent) {
          break
        }

        last = next
      }

      next++
    }

    const closes =
      next < lineCount &&
      indentation[next] === indent &&
      ClosingBracketsOnly.test(lines[next].trim())

    ranges.push({ start, end: closes ? next : last })
  }

  return ranges
}

export function getFoldRangesByStart(
  ranges: ReadonlyArray<IFoldRange>
): ReadonlyMap<number, IFoldRange> {
  return new Map(ranges.map(range => [range.start, range]))
}
