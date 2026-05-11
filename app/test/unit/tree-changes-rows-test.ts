import { describe, it } from 'node:test'
import assert from 'node:assert'

import {
  buildChangesTreeRows,
  getChangesTreeDirectoryIds,
  getDescendantDirectoryIds,
  getAncestorDirectoryIds,
  IChangesTreeFileItem,
  isPathInDirectory,
} from '../../src/ui/changes/tree/tree-changes-rows'

function file(path: string): IChangesTreeFileItem {
  return { id: path, path }
}

// Project each row down to the fields the tests assert on. Returning plain
// objects (rather than a packed string) keeps the expected values readable
// and gives assert.deepStrictEqual a field-level diff on failure.
function describeRow(row: ReturnType<typeof buildChangesTreeRows>[number]) {
  return row.kind === 'directory'
    ? {
        kind: row.kind,
        path: row.path,
        name: row.name,
        depth: row.depth,
        fileCount: row.fileCount,
        expanded: row.expanded,
      }
    : {
        kind: row.kind,
        path: row.item.path,
        displayPath: row.displayPath,
        depth: row.depth,
      }
}

describe('tree-changes-rows', () => {
  describe('buildChangesTreeRows', () => {
    it('builds directory and file rows from changed files', () => {
      const rows = buildChangesTreeRows(
        [
          file('src/ui/app.tsx'),
          file('src/ui/changes/filter-changes-list.tsx'),
          file('README.md'),
        ],
        new Set<string>()
      )

      assert.deepStrictEqual(rows.map(describeRow), [
        {
          kind: 'directory',
          path: 'src/ui',
          name: 'src/ui',
          depth: 0,
          fileCount: 2,
          expanded: true,
        },
        {
          kind: 'directory',
          path: 'src/ui/changes',
          name: 'changes',
          depth: 1,
          fileCount: 1,
          expanded: true,
        },
        {
          kind: 'file',
          path: 'src/ui/changes/filter-changes-list.tsx',
          displayPath: 'filter-changes-list.tsx',
          depth: 2,
        },
        {
          kind: 'file',
          path: 'src/ui/app.tsx',
          displayPath: 'app.tsx',
          depth: 1,
        },
        {
          kind: 'file',
          path: 'README.md',
          displayPath: 'README.md',
          depth: 0,
        },
      ])
    })

    it('renders a single changed file under a compact directory row', () => {
      const rows = buildChangesTreeRows([file('a/b/c.ts')], new Set<string>())

      assert.deepStrictEqual(rows.map(describeRow), [
        {
          kind: 'directory',
          path: 'a/b',
          name: 'a/b',
          depth: 0,
          fileCount: 1,
          expanded: true,
        },
        { kind: 'file', path: 'a/b/c.ts', displayPath: 'c.ts', depth: 1 },
      ])
    })

    it('compacts shared directory paths into one directory row', () => {
      const rows = buildChangesTreeRows(
        [file('a/b/c.ts'), file('a/b/d.ts')],
        new Set<string>()
      )

      assert.deepStrictEqual(rows.map(describeRow), [
        {
          kind: 'directory',
          path: 'a/b',
          name: 'a/b',
          depth: 0,
          fileCount: 2,
          expanded: true,
        },
        { kind: 'file', path: 'a/b/c.ts', displayPath: 'c.ts', depth: 1 },
        { kind: 'file', path: 'a/b/d.ts', displayPath: 'd.ts', depth: 1 },
      ])
    })

    it('sorts siblings case-insensitively', () => {
      const rows = buildChangesTreeRows(
        [
          file('src/Z.ts'),
          file('src/a.ts'),
          file('src/B.ts'),
          file('src/sub/x.ts'),
        ],
        new Set<string>()
      )

      // Directories come before files, and within each group siblings are
      // ordered case-insensitively (a < B < Z, not a < B < Z by code point).
      assert.deepStrictEqual(rows.map(describeRow), [
        {
          kind: 'directory',
          path: 'src',
          name: 'src',
          depth: 0,
          fileCount: 4,
          expanded: true,
        },
        {
          kind: 'directory',
          path: 'src/sub',
          name: 'sub',
          depth: 1,
          fileCount: 1,
          expanded: true,
        },
        {
          kind: 'file',
          path: 'src/sub/x.ts',
          displayPath: 'x.ts',
          depth: 2,
        },
        { kind: 'file', path: 'src/a.ts', displayPath: 'a.ts', depth: 1 },
        { kind: 'file', path: 'src/B.ts', displayPath: 'B.ts', depth: 1 },
        { kind: 'file', path: 'src/Z.ts', displayPath: 'Z.ts', depth: 1 },
      ])
    })

    it('marks directories as closed and hides descendants when collapsed', () => {
      const rows = buildChangesTreeRows(
        [file('src/ui/app.tsx'), file('src/lib/app-state.ts')],
        new Set<string>(['src'])
      )

      assert.deepStrictEqual(rows.map(describeRow), [
        {
          kind: 'directory',
          path: 'src',
          name: 'src',
          depth: 0,
          fileCount: 2,
          expanded: false,
        },
      ])
    })

    it('keeps a compacted row closed when a folded ancestor is collapsed', () => {
      // The user collapsed "src" while two files lived under it, then a
      // filter narrows the result to a single child. The remaining row gets
      // compacted to "src/ui", but the user's collapse on "src" must still
      // apply or the directory would silently re-open.
      const rows = buildChangesTreeRows(
        [file('src/ui/app.tsx')],
        new Set<string>(['src'])
      )

      assert.deepStrictEqual(rows.map(describeRow), [
        {
          kind: 'directory',
          path: 'src/ui',
          name: 'src/ui',
          depth: 0,
          fileCount: 1,
          expanded: false,
        },
      ])
    })

    it('keeps a compacted row closed when any intermediate folded ancestor is collapsed', () => {
      // Folding can skip multiple levels at once (a -> a/b -> a/b/c). A
      // collapse on any one of them should bind to the rendered row.
      const rows = buildChangesTreeRows(
        [file('a/b/c/d.ts')],
        new Set<string>(['a/b'])
      )

      assert.deepStrictEqual(rows.map(describeRow), [
        {
          kind: 'directory',
          path: 'a/b/c',
          name: 'a/b/c',
          depth: 0,
          fileCount: 1,
          expanded: false,
        },
      ])
    })

    it('keeps siblings of a collapsed directory visible', () => {
      const rows = buildChangesTreeRows(
        [file('src/ui/app.tsx'), file('docs/readme.md')],
        new Set<string>(['src/ui'])
      )

      assert.deepStrictEqual(rows.map(describeRow), [
        {
          kind: 'directory',
          path: 'docs',
          name: 'docs',
          depth: 0,
          fileCount: 1,
          expanded: true,
        },
        {
          kind: 'file',
          path: 'docs/readme.md',
          displayPath: 'readme.md',
          depth: 1,
        },
        {
          kind: 'directory',
          path: 'src/ui',
          name: 'src/ui',
          depth: 0,
          fileCount: 1,
          expanded: false,
        },
      ])
    })

    it('places root files after directory rows', () => {
      const rows = buildChangesTreeRows(
        [file('src/app.tsx'), file('README.md')],
        new Set<string>()
      )

      assert.deepStrictEqual(rows.map(describeRow), [
        {
          kind: 'directory',
          path: 'src',
          name: 'src',
          depth: 0,
          fileCount: 1,
          expanded: true,
        },
        {
          kind: 'file',
          path: 'src/app.tsx',
          displayPath: 'app.tsx',
          depth: 1,
        },
        {
          kind: 'file',
          path: 'README.md',
          displayPath: 'README.md',
          depth: 0,
        },
      ])
    })
  })

  describe('getChangesTreeDirectoryIds', () => {
    it('returns the compacted directory ids only', () => {
      const ids = getChangesTreeDirectoryIds([file('a/b/c.ts')])

      assert.deepStrictEqual(Array.from(ids), ['a/b'])
    })

    it('returns both branches when a directory has siblings', () => {
      const ids = getChangesTreeDirectoryIds([
        file('src/ui/app.tsx'),
        file('src/lib/git.ts'),
      ])

      assert.deepStrictEqual(Array.from(ids).sort(), [
        'src',
        'src/lib',
        'src/ui',
      ])
    })
  })

  describe('getAncestorDirectoryIds', () => {
    it('returns each ancestor directory path of a file', () => {
      assert.deepStrictEqual(getAncestorDirectoryIds('src/ui/app.tsx'), [
        'src',
        'src/ui',
      ])
    })

    it('returns an empty array for a root file', () => {
      assert.deepStrictEqual(getAncestorDirectoryIds('README.md'), [])
    })
  })

  describe('getDescendantDirectoryIds', () => {
    it('returns the directory itself and every nested directory', () => {
      const ids = getDescendantDirectoryIds(
        ['src/ui/app.tsx', 'src/ui/changes/filter.tsx', 'src/lib/git.ts'],
        'src/ui'
      )

      assert.deepStrictEqual(Array.from(ids).sort(), [
        'src/ui',
        'src/ui/changes',
      ])
    })

    it('excludes siblings of the directory', () => {
      const ids = getDescendantDirectoryIds(
        ['src/ui/app.tsx', 'docs/readme.md'],
        'src/ui'
      )

      assert.deepStrictEqual(Array.from(ids), ['src/ui'])
    })
  })

  describe('isPathInDirectory', () => {
    it('is true for direct and nested descendants', () => {
      assert.equal(isPathInDirectory('src/ui/app.tsx', 'src'), true)
      assert.equal(isPathInDirectory('src/ui/app.tsx', 'src/ui'), true)
    })

    it('is false for the directory itself or a sibling that shares a prefix', () => {
      assert.equal(isPathInDirectory('src', 'src'), false)
      assert.equal(isPathInDirectory('src-other/x.ts', 'src'), false)
    })
  })
})
