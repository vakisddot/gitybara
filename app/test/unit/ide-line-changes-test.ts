import { describe, it } from 'node:test'
import assert from 'node:assert'

import {
  DiffHunk,
  DiffHunkExpansionType,
  DiffHunkHeader,
  DiffLine,
  DiffLineType,
} from '../../src/models/diff'
import {
  getChangeGroupStarts,
  getLineChanges,
  ILineChanges,
  isSameLineChanges,
  NoLineChanges,
} from '../../src/ui/changes/ide/ide-line-changes'

// A line of a diff, written the way a diff is: " " context, "+" added, "-"
// removed, with the line numbers it would have counted along.
function hunk(newStartLine: number, ...lines: string[]): DiffHunk {
  let oldLine = newStartLine
  let newLine = newStartLine

  const diffLines = lines.map(text => {
    const marker = text[0]

    if (marker === '+') {
      return new DiffLine(text, DiffLineType.Add, null, null, newLine++)
    } else if (marker === '-') {
      return new DiffLine(text, DiffLineType.Delete, null, oldLine++, null)
    }

    return new DiffLine(text, DiffLineType.Context, null, oldLine++, newLine++)
  })

  return new DiffHunk(
    new DiffHunkHeader(newStartLine, 0, newStartLine, 0),
    diffLines,
    0,
    0,
    DiffHunkExpansionType.None
  )
}

const sorted = (set: ReadonlySet<number>) =>
  Array.from(set).sort((a, b) => a - b)

describe('ide-line-changes', () => {
  describe('getLineChanges', () => {
    it('marks lines only added as added', () => {
      const changes = getLineChanges([hunk(1, ' a', '+b', '+c', ' d')])

      assert.deepStrictEqual(sorted(changes.added), [1, 2])
      assert.deepStrictEqual(sorted(changes.modified), [])
      assert.deepStrictEqual(sorted(changes.removedBefore), [])
      assert.deepStrictEqual(changes.previousLines, [])
    })

    it('marks lines that replace others as modified', () => {
      const changes = getLineChanges([
        hunk(1, ' a', '-return before', '+return after', ' c'),
      ])

      assert.deepStrictEqual(sorted(changes.modified), [1])
      assert.deepStrictEqual(sorted(changes.added), [])
      assert.deepStrictEqual(sorted(changes.removedBefore), [])
    })

    it('highlights an inserted property without showing the old line', () => {
      const before = '  return { added, modified, removedBefore }'
      const insertion = ', previousLines'
      const after = before.replace('removedBefore', `removedBefore${insertion}`)
      const changes = getLineChanges([hunk(1, `-${before}`, `+${after}`)])
      const start = after.indexOf(insertion)
      assert.deepStrictEqual(changes.inlineChanges, [
        { line: 0, start, end: start + insertion.length },
      ])
      assert.deepStrictEqual(changes.previousLines, [])
      assert.deepStrictEqual(sorted(changes.modified), [0])
    })

    it('highlights an inserted import beside newly added lines at its identifier boundary', () => {
      const before =
        "import { DiffHunk, DiffLineType } from '../../../models/diff'"
      const after =
        "import { DiffHunk, DiffLine, DiffLineType } from '../../../models/diff'"
      const insertion = 'DiffLine, '
      const changes = getLineChanges([
        hunk(
          1,
          `-${before}`,
          `+${after}`,
          "+import { relativeChanges } from '../../diff/changed-range'",
          '+',
          '+export interface IInlineChange {'
        ),
      ])
      const start = after.indexOf(insertion)
      assert.deepStrictEqual(changes.inlineChanges, [
        { line: 0, start, end: start + insertion.length },
      ])
      assert.deepStrictEqual(sorted(changes.modified), [0])
      assert.deepStrictEqual(sorted(changes.added), [1, 2, 3])
      assert.deepStrictEqual(changes.previousLines, [])
    })

    it('shows unrelated code and comments as removals and additions', () => {
      const before = [
        '    if (removedCount > 0 && addedLines.length === 0) {',
        '      removedBefore.add(nextLine)',
      ]
      const after = [
        '    // Pair lines only when the block keeps its size; otherwise old text may',
        '    // have moved between lines and needs the full previous version.',
      ]
      const changes = getLineChanges([
        hunk(
          46,
          ...before.map(line => `-${line}`),
          ...after.map(line => `+${line}`)
        ),
      ])
      assert.deepStrictEqual(sorted(changes.modified), [])
      assert.deepStrictEqual(sorted(changes.added), [45, 46])
      assert.deepStrictEqual(sorted(changes.removedBefore), [45])
      assert.deepStrictEqual(changes.inlineChanges, [])
      assert.deepStrictEqual(changes.previousLines, [
        { line: 45, oldLineNumber: 46, lines: before, inlineChanges: [] },
      ])
    })

    it('does not pair lines based on matching punctuation alone', () => {
      const changes = getLineChanges([hunk(1, '-  alpha()', '+  omega()')])
      assert.deepStrictEqual(sorted(changes.added), [0])
      assert.deepStrictEqual(sorted(changes.modified), [])
      assert.deepStrictEqual(changes.inlineChanges, [])
      assert.strictEqual(changes.previousLines.length, 1)
    })

    it('ignores indentation when deciding whether edited lines are related', () => {
      const changes = getLineChanges([
        hunk(1, '-  return oldValue', '+    return newValue'),
      ])
      assert.deepStrictEqual(sorted(changes.modified), [0])
      assert.deepStrictEqual(sorted(changes.added), [])
      assert.strictEqual(changes.previousLines.length, 1)
    })

    it('preserves a small original line when it gains a large insertion', () => {
      const changes = getLineChanges([
        hunk(1, '-call()', '+call(aVeryLongArgument)'),
      ])
      assert.deepStrictEqual(sorted(changes.modified), [0])
      assert.deepStrictEqual(sorted(changes.added), [])
      assert.deepStrictEqual(changes.previousLines, [])
    })

    it('highlights insertions at either end, including Unicode text', () => {
      const changes = getLineChanges([
        hunk(1, '-value', '+new value', ' context', '-value', '+value 😀'),
      ])
      assert.deepStrictEqual(changes.inlineChanges, [
        { line: 0, start: 0, end: 4 },
        { line: 2, start: 5, end: 8 },
      ])
      assert.deepStrictEqual(changes.previousLines, [])
    })

    it('retains the previous version when text is replaced or deleted within a line', () => {
      const changes = getLineChanges([
        hunk(
          1,
          '-const theme = "light"',
          '+const theme = "mocha"',
          ' context',
          '-call(a, b)',
          '+call(a)'
        ),
      ])
      assert.deepStrictEqual(changes.inlineChanges, [
        { line: 0, start: 15, end: 20 },
      ])
      assert.deepStrictEqual(
        changes.previousLines.map(block => block.lines),
        [['const theme = "light"'], ['call(a, b)']]
      )
    })

    it('keeps a mixed block when one line loses text', () => {
      const changes = getLineChanges([
        hunk(
          1,
          '-return before',
          '-call(b)',
          '+return after',
          '+call(b, extra)'
        ),
      ])
      assert.strictEqual(changes.previousLines.length, 1)
      assert.strictEqual(changes.inlineChanges.length, 2)
    })

    it('omits the previous block when every paired line only gains text', () => {
      const changes = getLineChanges([
        hunk(1, '-call(a)', '-return a', '+call(a, b)', '+return a + b'),
      ])
      assert.deepStrictEqual(changes.previousLines, [])
      assert.deepStrictEqual(changes.inlineChanges, [
        { line: 0, start: 6, end: 9 },
        { line: 1, start: 8, end: 12 },
      ])
    })

    it('highlights paired characters while retaining the old line when text moves across lines', () => {
      const changes = getLineChanges([hunk(1, '-call(a)', '+call(a,', '+  b)')])
      assert.deepStrictEqual(changes.inlineChanges, [
        { line: 0, start: 6, end: 7 },
      ])
      assert.deepStrictEqual(changes.previousLines, [
        {
          line: 0,
          oldLineNumber: 1,
          lines: ['call(a)'],
          inlineChanges: [{ line: 0, start: 6, end: 7 }],
        },
      ])
    })

    it('emphasizes a moved closing parenthesis and the new continuation in an unequal block', () => {
      const before = '      isSameSet(a.removedBefore, b.removedBefore))'
      const after = '      isSameSet(a.removedBefore, b.removedBefore) &&'
      const changes = getLineChanges([
        hunk(
          1,
          `-${before}`,
          `+${after}`,
          '+      a.inlineChanges.length === b.inlineChanges.length &&',
          '+      a.previousLines.length === b.previousLines.length)'
        ),
      ])
      assert.deepStrictEqual(changes.inlineChanges, [
        { line: 0, start: after.length - 3, end: after.length },
      ])
      assert.deepStrictEqual(changes.previousLines, [
        {
          line: 0,
          oldLineNumber: 1,
          lines: [before],
          inlineChanges: [
            { line: 0, start: before.length - 1, end: before.length },
          ],
        },
      ])
      assert.deepStrictEqual(sorted(changes.modified), [0])
      assert.deepStrictEqual(sorted(changes.added), [1, 2])
    })

    it('marks the extra lines of a replacement as added', () => {
      const changes = getLineChanges([
        hunk(1, '-return before', '+return after', '+B', '+C', ' d'),
      ])

      assert.deepStrictEqual(sorted(changes.modified), [0])
      assert.deepStrictEqual(sorted(changes.added), [1, 2])
    })

    it('marks a removal on the line that follows the removed lines', () => {
      const changes = getLineChanges([hunk(1, ' a', '-b', '-c', ' d')])

      assert.deepStrictEqual(sorted(changes.removedBefore), [1])
      assert.deepStrictEqual(sorted(changes.added), [])
      assert.deepStrictEqual(sorted(changes.modified), [])
    })

    it('marks lines removed from the end of the file after the last line', () => {
      const changes = getLineChanges([hunk(1, ' a', ' b', '-c')])

      assert.deepStrictEqual(sorted(changes.removedBefore), [2])
    })

    it('handles several hunks and changes in a hunk', () => {
      const changes = getLineChanges([
        hunk(1, '+a', ' b'),
        hunk(10, ' x', '-return before', '+return after', ' z', '-w', ' v'),
      ])

      assert.deepStrictEqual(sorted(changes.added), [0])
      assert.deepStrictEqual(sorted(changes.modified), [10])
      assert.deepStrictEqual(sorted(changes.removedBefore), [12])
    })

    it('has no changes without hunks', () => {
      assert.ok(isSameLineChanges(getLineChanges([]), NoLineChanges))
    })

    it('keeps old text and line numbers above a replacement of a different size', () => {
      const changes = getLineChanges([
        hunk(10, ' context', '-  first', '-  second', '+replacement', ' next'),
      ])
      assert.deepStrictEqual(changes.previousLines, [
        {
          line: 10,
          oldLineNumber: 11,
          lines: ['  first', '  second'],
          inlineChanges: [],
        },
      ])
    })

    it('positions deletions at the beginning, between changes, and at EOF', () => {
      const changes = getLineChanges([
        hunk(1, '-start', ' a', '-middle', ' b', '-end'),
      ])
      assert.deepStrictEqual(changes.previousLines, [
        { line: 0, oldLineNumber: 1, lines: ['start'], inlineChanges: [] },
        { line: 1, oldLineNumber: 3, lines: ['middle'], inlineChanges: [] },
        { line: 2, oldLineNumber: 5, lines: ['end'], inlineChanges: [] },
      ])
    })
  })

  describe('isSameLineChanges', () => {
    it('refreshes the old emphasis when a different identical argument is removed', () => {
      const a = getLineChanges([hunk(1, '-call(a, a)', '+call(a)')])
      const b = getLineChanges([hunk(1, '-call(a, a)', '+call( a)')])
      assert.deepStrictEqual(a.inlineChanges, [])
      assert.deepStrictEqual(b.inlineChanges, [])
      assert.deepStrictEqual(a.previousLines[0].lines, b.previousLines[0].lines)
      assert.ok(!isSameLineChanges(a, b))
      assert.ok(
        isSameLineChanges(
          a,
          getLineChanges([hunk(1, '-call(a, a)', '+call(a)')])
        )
      )
    })
    it('refreshes an insertion highlight when its position changes', () => {
      const a = getLineChanges([hunk(1, '-abc', '+aXbc')])
      const b = getLineChanges([hunk(1, '-abc', '+abXc')])
      assert.deepStrictEqual(a.previousLines, [])
      assert.deepStrictEqual(b.previousLines, [])
      assert.ok(!isSameLineChanges(a, b))
    })
    it('refreshes previews when only the old text changes', () => {
      const a = getLineChanges([hunk(1, '-before', '+after')])
      const b = getLineChanges([hunk(1, '-different', '+after')])
      assert.ok(!isSameLineChanges(a, b))
      assert.ok(
        isSameLineChanges(a, getLineChanges([hunk(1, '-before', '+after')]))
      )
    })
    it('compares what is marked, not the sets', () => {
      const a = getLineChanges([hunk(1, '+a', ' b')])
      const b = getLineChanges([hunk(1, '+a', ' b')])
      const c = getLineChanges([hunk(1, ' a', '+b')])

      assert.ok(isSameLineChanges(a, b))
      assert.ok(!isSameLineChanges(a, c))
    })
  })

  describe('getChangeGroupStarts', () => {
    const changes = (
      added: number[],
      modified: number[],
      removedBefore: number[]
    ): ILineChanges => ({
      added: new Set(added),
      modified: new Set(modified),
      removedBefore: new Set(removedBefore),
      previousLines: [],
      inlineChanges: [],
    })

    it('has one start for each group of lines next to each other', () => {
      assert.deepStrictEqual(
        getChangeGroupStarts(changes([1, 2], [3], [8]), 10),
        [1, 8]
      )
    })

    it('puts a removal at the end of the file on the last line', () => {
      assert.deepStrictEqual(getChangeGroupStarts(changes([], [], [5]), 5), [4])
    })

    it('has no starts without changes', () => {
      assert.deepStrictEqual(getChangeGroupStarts(NoLineChanges, 10), [])
    })

    it('keeps deletion previews accessible when all lines were removed', () => {
      assert.deepStrictEqual(getChangeGroupStarts(changes([], [], [0]), 0), [0])
    })
  })
})
