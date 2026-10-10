import { describe, it } from 'node:test'
import assert from 'node:assert'

import {
  getFoldRanges,
  getFoldRangesByStart,
  getVisibleIndexOfLine,
  getVisibleLines,
  pruneFoldedLines,
  unfoldBlocksHiding,
} from '../../src/ui/changes/ide/ide-folding'

describe('ide-folding', () => {
  describe('getFoldRanges', () => {
    it('folds blocks that are indented deeper', () => {
      const ranges = getFoldRanges(['def a():', '    b()', '    c()', 'd()'], 4)

      assert.deepStrictEqual(ranges, [{ start: 0, end: 2 }])
    })

    it('includes the closing brace of a block', () => {
      const ranges = getFoldRanges(['function a() {', '  b()', '}', 'c()'], 4)

      assert.deepStrictEqual(ranges, [{ start: 0, end: 2 }])
    })

    it('includes lines like "});" that close a block', () => {
      const ranges = getFoldRanges(['it(() => {', '  a()', '});', 'b()'], 4)

      assert.deepStrictEqual(ranges, [{ start: 0, end: 2 }])
    })

    it('starts a block on the header when the brace is on the next line', () => {
      const ranges = getFoldRanges(
        ['void A()', '{', '    b();', '}', 'int c;'],
        4
      )

      assert.deepStrictEqual(ranges, [{ start: 0, end: 3 }])
    })

    it('leaves out an else that follows a block', () => {
      const ranges = getFoldRanges(
        ['if (a) {', '  b()', '} else {', '  c()', '}'],
        4
      )

      assert.deepStrictEqual(ranges, [
        { start: 0, end: 1 },
        { start: 2, end: 4 },
      ])
    })

    it('finds blocks inside blocks', () => {
      const ranges = getFoldRanges(
        ['class A {', '  void B() {', '    c()', '  }', '}'],
        4
      )

      assert.deepStrictEqual(ranges, [
        { start: 0, end: 4 },
        { start: 1, end: 3 },
      ])
    })

    it('keeps blank lines inside a block but not after it', () => {
      const ranges = getFoldRanges(['a {', '  b', '', '  c', '}', '', 'd'], 4)

      assert.deepStrictEqual(ranges, [{ start: 0, end: 4 }])

      const noBrace = getFoldRanges(['a:', '  b', '', '', 'c'], 4)

      assert.deepStrictEqual(noBrace, [{ start: 0, end: 1 }])
    })

    it('has no blocks without indentation', () => {
      assert.deepStrictEqual(getFoldRanges(['a', 'b', 'c'], 4), [])
      assert.deepStrictEqual(getFoldRanges([], 4), [])
    })
  })

  describe('getVisibleLines', () => {
    const ranges = getFoldRangesByStart([
      { start: 0, end: 5 },
      { start: 1, end: 3 },
      { start: 7, end: 9 },
    ])

    it('shows every line when nothing is folded', () => {
      assert.deepStrictEqual(
        getVisibleLines(4, ranges, new Set()),
        [0, 1, 2, 3]
      )
    })

    it('hides the lines of a folded block after its first line', () => {
      assert.deepStrictEqual(
        getVisibleLines(11, ranges, new Set([7])),
        [0, 1, 2, 3, 4, 5, 6, 7, 10]
      )
    })

    it('hides folded blocks inside folded blocks along with them', () => {
      assert.deepStrictEqual(
        getVisibleLines(11, ranges, new Set([0, 1])),
        [0, 6, 7, 8, 9, 10]
      )
    })

    it('ignores folded lines that start no block', () => {
      assert.deepStrictEqual(
        getVisibleLines(3, ranges, new Set([2])),
        [0, 1, 2]
      )
    })
  })

  describe('pruneFoldedLines', () => {
    const lines = ['a {', '  b', '}', 'c {', '  d', '}']
    const ranges = getFoldRangesByStart(getFoldRanges(lines, 4))

    it('keeps blocks that start on the same line with the same text', () => {
      const folded = new Map([[3, 'c {']])

      assert.strictEqual(pruneFoldedLines(folded, lines, ranges), folded)
    })

    it('drops blocks whose line changed or is no longer a block', () => {
      const folded = new Map([
        [0, 'something else {'],
        [1, '  b'],
        [3, 'c {'],
      ])

      assert.deepStrictEqual(
        Array.from(pruneFoldedLines(folded, lines, ranges).keys()),
        [3]
      )
    })
  })

  describe('unfoldBlocksHiding', () => {
    const ranges = getFoldRangesByStart([
      { start: 0, end: 5 },
      { start: 1, end: 3 },
      { start: 7, end: 9 },
    ])

    it('unfolds the blocks that hide a line, and only those', () => {
      const folded = new Map([
        [0, 'a'],
        [1, 'b'],
        [7, 'c'],
      ])

      assert.deepStrictEqual(
        Array.from(unfoldBlocksHiding(folded, ranges, 2).keys()),
        [7]
      )
    })

    it('does not unfold a block for its first line', () => {
      const folded = new Map([[7, 'c']])

      assert.strictEqual(unfoldBlocksHiding(folded, ranges, 7), folded)
    })
  })

  describe('getVisibleIndexOfLine', () => {
    it('finds the position of a visible line', () => {
      assert.strictEqual(getVisibleIndexOfLine([0, 1, 5, 6], 5), 2)
    })

    it('finds the line before a hidden line', () => {
      assert.strictEqual(getVisibleIndexOfLine([0, 1, 5, 6], 3), 1)
    })

    it('stays within the lines', () => {
      assert.strictEqual(getVisibleIndexOfLine([2, 3], 0), 0)
      assert.strictEqual(getVisibleIndexOfLine([2, 3], 9), 1)
      assert.strictEqual(getVisibleIndexOfLine([], 4), 0)
    })
  })
})
