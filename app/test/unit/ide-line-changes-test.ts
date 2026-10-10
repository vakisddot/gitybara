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
    })

    it('marks lines that replace others as modified', () => {
      const changes = getLineChanges([hunk(1, ' a', '-b', '+B', ' c')])

      assert.deepStrictEqual(sorted(changes.modified), [1])
      assert.deepStrictEqual(sorted(changes.added), [])
      assert.deepStrictEqual(sorted(changes.removedBefore), [])
    })

    it('marks the extra lines of a replacement as added', () => {
      const changes = getLineChanges([hunk(1, '-a', '+A', '+B', '+C', ' d')])

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
        hunk(10, ' x', '-y', '+Y', ' z', '-w', ' v'),
      ])

      assert.deepStrictEqual(sorted(changes.added), [0])
      assert.deepStrictEqual(sorted(changes.modified), [10])
      assert.deepStrictEqual(sorted(changes.removedBefore), [12])
    })

    it('has no changes without hunks', () => {
      assert.ok(isSameLineChanges(getLineChanges([]), NoLineChanges))
    })
  })

  describe('isSameLineChanges', () => {
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
  })
})
