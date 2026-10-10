import { describe, it } from 'node:test'
import assert from 'node:assert'

import { getFoldRanges } from '../../src/ui/changes/ide/ide-folding'

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
})
