import { describe, it } from 'node:test'
import assert from 'node:assert'

import { getChangeRulerMarks } from '../../src/ui/diff/diff-change-ruler'
import { DiffRow, DiffRowType } from '../../src/ui/diff/diff-helpers'

// Only the type of a row matters to the marks
const rows = (...types: DiffRowType[]) =>
  types.map(type => ({ type } as DiffRow))

describe('getChangeRulerMarks', () => {
  const { Hunk, Context, Added, Deleted, Modified } = DiffRowType

  it('has a mark for each run of rows of the same kind', () => {
    const marks = getChangeRulerMarks(
      rows(Hunk, Context, Deleted, Deleted, Added, Context, Modified, Context),
      () => 10
    )

    assert.deepStrictEqual(marks, [
      { kind: 'deleted', top: 0.25, height: 0.25 },
      { kind: 'added', top: 0.5, height: 0.125 },
      { kind: 'modified', top: 0.75, height: 0.125 },
    ])
  })

  it('goes by the height of each row', () => {
    const heights = [30, 10, 60]
    const marks = getChangeRulerMarks(
      rows(Context, Added, Context),
      index => heights[index]
    )

    assert.deepStrictEqual(marks, [{ kind: 'added', top: 0.3, height: 0.1 }])
  })

  it('has no marks without changed rows or rows', () => {
    assert.deepStrictEqual(
      getChangeRulerMarks(rows(Hunk, Context), () => 10),
      []
    )
    assert.deepStrictEqual(
      getChangeRulerMarks([], () => 10),
      []
    )
  })
})
