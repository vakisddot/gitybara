import { describe, it } from 'node:test'
import assert from 'node:assert'

import {
  detectIndentUnit,
  getIndentColumns,
  getLineIndentation,
} from '../../src/ui/changes/ide/ide-indentation'

describe('ide-indentation', () => {
  describe('getIndentColumns', () => {
    it('counts spaces', () => {
      assert.strictEqual(getIndentColumns('    a', 4), 4)
      assert.strictEqual(getIndentColumns('a', 4), 0)
    })

    it('moves tabs to the next tab stop', () => {
      assert.strictEqual(getIndentColumns('\ta', 4), 4)
      assert.strictEqual(getIndentColumns('  \ta', 4), 4)
      assert.strictEqual(getIndentColumns('\t\ta', 4), 8)
    })

    it('has no indentation for lines with only whitespace', () => {
      assert.strictEqual(getIndentColumns('', 4), null)
      assert.strictEqual(getIndentColumns('   ', 4), null)
    })
  })

  describe('detectIndentUnit', () => {
    it('finds the indent of files indented with spaces', () => {
      assert.strictEqual(
        detectIndentUnit(['a {', '  b {', '    c', '  }', '}'], 4),
        2
      )
      assert.strictEqual(
        detectIndentUnit(['a {', '    b {', '        c', '    }', '}'], 2),
        4
      )
    })

    it('uses the tab size for files indented with tabs', () => {
      assert.strictEqual(detectIndentUnit(['a {', '\tb', '}'], 4), 4)
    })

    it('ignores blank lines and odd alignment', () => {
      assert.strictEqual(
        detectIndentUnit(
          ['a(', '    b,', '', '     c', '    d)', 'e {', '    f'],
          8
        ),
        4
      )
    })

    it('falls back to the tab size when nothing is indented', () => {
      assert.strictEqual(detectIndentUnit(['a', 'b'], 3), 3)
      assert.strictEqual(detectIndentUnit([], 4), 4)
    })
  })

  describe('getLineIndentation', () => {
    it('is the indentation of each line', () => {
      assert.deepStrictEqual(
        getLineIndentation(['a', '  b', '    c'], 4),
        [0, 2, 4]
      )
    })

    it('lets a blank line inside a block take the indentation of the block', () => {
      assert.deepStrictEqual(
        getLineIndentation(['a {', '    b', '', '    c', '}'], 4),
        [0, 4, 4, 4, 0]
      )
    })

    it('stops the guides of a block at its end', () => {
      assert.deepStrictEqual(
        getLineIndentation(['    a', '', '', 'b'], 4),
        [4, 0, 0, 0]
      )
    })

    it('handles files without lines', () => {
      assert.deepStrictEqual(getLineIndentation([], 4), [])
    })
  })
})
