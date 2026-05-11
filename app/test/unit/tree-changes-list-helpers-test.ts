import assert from 'node:assert'
import { describe, it } from 'node:test'

import { IMatches } from '../../src/lib/fuzzy-find'
import {
  buildDirectoryNameMatchesByPath,
  someItemHasSelectedId,
} from '../../src/ui/changes/tree/tree-changes-list'

const noMatches: IMatches = { title: [], subtitle: [] }

function fileItem(path: string, titleMatches: ReadonlyArray<number> = []) {
  // Cast through `as any` so the test file doesn't depend on the
  // module's internal IChangesTreeFileItemWithMatches type. Only the
  // structural properties referenced by the helpers matter here.
  return {
    id: path,
    path,
    changeListItem: { id: path, text: [path], change: undefined as any },
    matches:
      titleMatches.length === 0
        ? noMatches
        : { title: [...titleMatches], subtitle: [] },
  } as any
}

describe('buildDirectoryNameMatchesByPath', () => {
  it('returns an empty map when no file has title matches', () => {
    const matches = buildDirectoryNameMatchesByPath([
      fileItem('src/ui/app.tsx'),
    ])

    assert.equal(matches.size, 0)
  })

  it('keeps only the match offsets that land inside each rendered directory', () => {
    // Two files keep both "src" and "src/ui" as rendered (non-compacted) rows.
    // path: src/ui/app.tsx, src/lib/git.ts
    // matches "srcui" → positions [0, 1, 2, 4, 5] for app.tsx
    //                  positions [0, 1, 2] for git.ts (only "src" is in range).
    const matches = buildDirectoryNameMatchesByPath([
      fileItem('src/ui/app.tsx', [0, 1, 2, 4, 5]),
      fileItem('src/lib/git.ts', [0, 1, 2]),
    ])

    assert.deepStrictEqual(matches.get('src'), [0, 1, 2])
    assert.deepStrictEqual(matches.get('src/ui'), [0, 1, 2, 4, 5])
  })

  it('skips ancestor ids that are folded away by directory compaction', () => {
    // A single file under "src/ui/app.tsx" compacts to one directory row
    // "src/ui". The "src" ancestor never renders, so it should not appear
    // in the map even though it is technically an ancestor of the file.
    const matches = buildDirectoryNameMatchesByPath([
      fileItem('src/ui/app.tsx', [0, 1, 2, 4, 5]),
    ])

    assert.equal(matches.has('src'), false)
    assert.deepStrictEqual(matches.get('src/ui'), [0, 1, 2, 4, 5])
  })

  it('merges match offsets contributed by multiple descendant files', () => {
    const matches = buildDirectoryNameMatchesByPath([
      fileItem('src/ui/app.tsx', [0]),
      fileItem('src/ui/list.tsx', [4]),
    ])

    assert.deepStrictEqual(matches.get('src/ui'), [0, 4])
  })

  it('does not record entries for ancestor directories without any matches', () => {
    const matches = buildDirectoryNameMatchesByPath([
      // Matches at indices 7 and 8 are after "src/ui/" so they only land
      // inside the descendant file, never inside the directory ids.
      fileItem('src/ui/app.tsx', [7, 8]),
    ])

    assert.equal(matches.has('src'), false)
    assert.equal(matches.has('src/ui'), false)
  })
})

describe('someItemHasSelectedId', () => {
  type Item = { readonly id: string }
  const selected = (id: string) => ({
    id,
    text: [id],
    change: undefined as any,
  })

  it('returns false when there are no selected items', () => {
    const items: Item[] = [{ id: 'a' }]

    assert.equal(
      someItemHasSelectedId(items, item => item.id, []),
      false
    )
  })

  it('finds a single selected id', () => {
    const items: Item[] = [{ id: 'a' }, { id: 'b' }]

    assert.equal(
      someItemHasSelectedId(items, item => item.id, [selected('b')]),
      true
    )
    assert.equal(
      someItemHasSelectedId(items, item => item.id, [selected('c')]),
      false
    )
  })

  it('finds any of several selected ids', () => {
    const items: Item[] = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]

    assert.equal(
      someItemHasSelectedId(items, item => item.id, [
        selected('x'),
        selected('y'),
        selected('c'),
      ]),
      true
    )
    assert.equal(
      someItemHasSelectedId(items, item => item.id, [
        selected('x'),
        selected('y'),
      ]),
      false
    )
  })

  it('supports custom id projections', () => {
    type Wrapped = { readonly inner: { readonly id: string } }
    const items: Wrapped[] = [{ inner: { id: 'a' } }, { inner: { id: 'b' } }]

    assert.equal(
      someItemHasSelectedId(items, item => item.inner.id, [selected('b')]),
      true
    )
  })
})
