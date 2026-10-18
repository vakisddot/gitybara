import { describe, it } from 'node:test'
import assert from 'node:assert'

import {
  collapseIdeDirectory,
  expandIdeDirectory,
  filterIdePaths,
  getChangedFileCountByDirectory,
  getCollapsedIdeDirectoryIds,
  getDirectoriesContainingPaths,
  mergeFilePaths,
  toggleIdeDirectory,
} from '../../src/ui/changes/ide/ide-file-tree-state'
import { parseNullSeparatedPaths } from '../../src/lib/git/ls-files'

const sorted = (ids: ReadonlySet<string>) => Array.from(ids).sort()

describe('ide-file-tree-state', () => {
  describe('expandIdeDirectory', () => {
    it('expands the directory and its ancestors', () => {
      const next = expandIdeDirectory(new Set(), 'a/b/c')

      assert.deepStrictEqual(sorted(next), ['a', 'a/b', 'a/b/c'])
    })

    it('keeps the directories that are already expanded', () => {
      const next = expandIdeDirectory(new Set(['docs']), 'src')

      assert.deepStrictEqual(sorted(next), ['docs', 'src'])
    })
  })

  describe('collapseIdeDirectory', () => {
    it('collapses only the given directory', () => {
      const next = collapseIdeDirectory(new Set(['a', 'a/b']), 'a')

      assert.deepStrictEqual(sorted(next), ['a/b'])
    })
  })

  describe('toggleIdeDirectory', () => {
    it('expands a collapsed directory and collapses an expanded one', () => {
      const expanded = toggleIdeDirectory(new Set(), 'src')
      assert.deepStrictEqual(sorted(expanded), ['src'])

      const collapsed = toggleIdeDirectory(expanded, 'src')
      assert.deepStrictEqual(sorted(collapsed), [])
    })
  })

  describe('getCollapsedIdeDirectoryIds', () => {
    it('collapses every directory that is not expanded', () => {
      const collapsed = getCollapsedIdeDirectoryIds(
        new Set(['a', 'a/b', 'docs']),
        new Set(['a'])
      )

      assert.deepStrictEqual(sorted(collapsed), ['a/b', 'docs'])
    })
  })

  describe('getDirectoriesContainingPaths', () => {
    it('returns every ancestor directory of the paths', () => {
      const ids = getDirectoriesContainingPaths([
        'README.md',
        'src/ui/a.ts',
        'docs/b.md',
      ])

      assert.deepStrictEqual(sorted(ids), ['docs', 'src', 'src/ui'])
    })
  })

  describe('getChangedFileCountByDirectory', () => {
    it('counts changed files in each directory including nested ones', () => {
      const counts = getChangedFileCountByDirectory([
        'src/a.ts',
        'src/ui/b.ts',
        'src/ui/c.ts',
        'README.md',
      ])

      assert.strictEqual(counts.get('src'), 3)
      assert.strictEqual(counts.get('src/ui'), 2)
      assert.strictEqual(counts.has('docs'), false)
    })
  })

  describe('mergeFilePaths', () => {
    it('adds changed paths git no longer lists without duplicates', () => {
      const paths = mergeFilePaths(['a.ts', 'b.ts'], ['b.ts', 'gone.ts'])

      assert.deepStrictEqual(paths, ['a.ts', 'b.ts', 'gone.ts'])
    })
  })

  describe('filterIdePaths', () => {
    const paths = ['README.md', 'src/index.ts', 'src/ui/App.tsx', 'docs/a.md']
    const changed = ['src/ui/App.tsx']

    it('keeps every path when nothing is filtered', () => {
      const filter = { text: '  ', changedOnly: false }

      assert.strictEqual(filterIdePaths(paths, changed, filter), paths)
    })

    it('finds paths with every word in any order, ignoring case', () => {
      assert.deepStrictEqual(
        filterIdePaths(paths, changed, { text: 'TS src', changedOnly: false }),
        ['src/index.ts', 'src/ui/App.tsx']
      )
    })

    it('matches the directories in a path too', () => {
      assert.deepStrictEqual(
        filterIdePaths(paths, changed, { text: 'docs', changedOnly: false }),
        ['docs/a.md']
      )
    })

    it('matches backslashes with forward slashes', () => {
      assert.deepStrictEqual(
        filterIdePaths(paths, changed, {
          text: 'src\\ui\\App.tsx',
          changedOnly: false,
        }),
        ['src/ui/App.tsx']
      )
    })

    it('only keeps changed paths when asked to', () => {
      assert.deepStrictEqual(
        filterIdePaths(paths, changed, { text: '', changedOnly: true }),
        ['src/ui/App.tsx']
      )
    })

    it('combines the words with only the changed paths', () => {
      assert.deepStrictEqual(
        filterIdePaths(paths, changed, { text: 'index', changedOnly: true }),
        []
      )
    })
  })

  describe('parseNullSeparatedPaths', () => {
    it('splits on NUL and ignores the trailing separator', () => {
      assert.deepStrictEqual(parseNullSeparatedPaths('a.ts\0dir/b ts\0'), [
        'a.ts',
        'dir/b ts',
      ])
    })

    it('returns no paths for empty output', () => {
      assert.deepStrictEqual(parseNullSeparatedPaths(''), [])
    })
  })
})
