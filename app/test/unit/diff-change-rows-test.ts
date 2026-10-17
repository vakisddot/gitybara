import { describe, it } from 'node:test'
import assert from 'node:assert'

import {
  DiffRow,
  DiffRowType,
  getChangeStartRows,
} from '../../src/ui/diff/diff-helpers'

// Only the type of a row matters to where the changes start
const rows = (...types: DiffRowType[]) =>
  types.map(type => ({ type } as DiffRow))

describe('getChangeStartRows', () => {
  it('has the first row of each group of changed rows', () => {
    const { Hunk, Context, Added, Deleted, Modified } = DiffRowType
    assert.deepStrictEqual(
      getChangeStartRows(
        rows(Hunk, Context, Deleted, Added, Context, Modified, Hunk, Added)
      ),
      [2, 5, 7]
    )
  })

  it('starts at the first row when it is changed', () => {
    assert.deepStrictEqual(
      getChangeStartRows(rows(DiffRowType.Added, DiffRowType.Context)),
      [0]
    )
  })

  it('has none without changed rows', () => {
    assert.deepStrictEqual(
      getChangeStartRows(rows(DiffRowType.Hunk, DiffRowType.Context)),
      []
    )
  })
})
