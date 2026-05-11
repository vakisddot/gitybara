import { describe, it } from 'node:test'
import assert from 'node:assert'

import {
  collapseTreeDirectoryRecursively,
  expandTreeDirectoryRecursively,
  getTreeDirectoryIds,
  pruneCollapsedTreeDirectoryIds,
  toggleCollapsedTreeDirectoryId,
} from '../../src/ui/changes/tree/tree-changes-state'

describe('tree-changes-state', () => {
  describe('toggleCollapsedTreeDirectoryId', () => {
    it('adds an id that is not collapsed', () => {
      const next = toggleCollapsedTreeDirectoryId(new Set(['src']), 'docs')

      assert.deepStrictEqual(Array.from(next).sort(), ['docs', 'src'])
    })

    it('removes an id that is already collapsed', () => {
      const next = toggleCollapsedTreeDirectoryId(
        new Set(['src', 'docs']),
        'src'
      )

      assert.deepStrictEqual(Array.from(next), ['docs'])
    })

    it('returns a new set without mutating the input', () => {
      const input = new Set(['src'])
      const next = toggleCollapsedTreeDirectoryId(input, 'docs')

      assert.notEqual(next, input)
      assert.deepStrictEqual(Array.from(input), ['src'])
    })
  })

  describe('getTreeDirectoryIds', () => {
    it('returns the compacted directory ids implied by the changed files', () => {
      const ids = getTreeDirectoryIds([
        'src/ui/app.tsx',
        'src/ui/changes/filter.tsx',
        'src/lib/git.ts',
      ])

      assert.deepStrictEqual(Array.from(ids).sort(), [
        'src',
        'src/lib',
        'src/ui',
        'src/ui/changes',
      ])
    })

    it('skips intermediate directories implied by single-file chains', () => {
      const ids = getTreeDirectoryIds(['a/b/c.ts'])

      assert.deepStrictEqual(Array.from(ids), ['a/b'])
    })
  })

  describe('pruneCollapsedTreeDirectoryIds', () => {
    it('removes collapsed directory ids that no longer exist in changed files', () => {
      const pruned = pruneCollapsedTreeDirectoryIds(
        new Set<string>(['src', 'src/ui', 'deleted/path', 'vendor/pkg']),
        ['src/app.tsx', 'vendor/pkg/index.ts']
      )

      assert.deepStrictEqual(Array.from(pruned), ['src', 'vendor/pkg'])
    })

    it('keeps collapsed ancestor ids even when compaction folds them away', () => {
      // Both "a" and "a/b" are real ancestors of "a/b/c.ts" even though
      // compaction renders them as a single "a/b" row. Either id may govern
      // the row's collapse state, so neither should be pruned.
      const pruned = pruneCollapsedTreeDirectoryIds(
        new Set<string>(['a', 'a/b']),
        ['a/b/c.ts']
      )

      assert.deepStrictEqual(Array.from(pruned).sort(), ['a', 'a/b'])
    })

    it('returns the same set reference when nothing is stale', () => {
      const input = new Set<string>(['src', 'src/ui'])
      const pruned = pruneCollapsedTreeDirectoryIds(input, [
        'src/app.ts',
        'src/ui/list.ts',
      ])

      assert.equal(pruned, input)
    })

    it('returns the same set reference for an empty input', () => {
      const input = new Set<string>()
      const pruned = pruneCollapsedTreeDirectoryIds(input, ['src/app.ts'])

      assert.equal(pruned, input)
    })

    it('keeps a collapsed ancestor that has been folded away by compaction', () => {
      // "src" is folded into "src/ui" by compaction when only one nested file
      // remains, but the user's collapse on "src" must still apply to that
      // compacted row. Pruning would otherwise drop the entry and silently
      // re-open the directory.
      const pruned = pruneCollapsedTreeDirectoryIds(new Set<string>(['src']), [
        'src/ui/app.tsx',
      ])

      assert.deepStrictEqual(Array.from(pruned), ['src'])
    })
  })

  describe('expandTreeDirectoryRecursively', () => {
    it('removes the target directory and all of its descendants', () => {
      const next = expandTreeDirectoryRecursively(
        new Set<string>(['src', 'src/ui', 'src/ui/changes', 'src/lib', 'docs']),
        ['src/ui/changes/filter.tsx', 'src/lib/git.ts', 'docs/readme.md'],
        'src/ui'
      )

      assert.deepStrictEqual(Array.from(next).sort(), [
        'docs',
        'src',
        'src/lib',
      ])
    })

    it('is a noop when no descendant ids are collapsed', () => {
      const input = new Set<string>(['docs'])
      const next = expandTreeDirectoryRecursively(
        input,
        ['src/ui/app.ts', 'docs/readme.md'],
        'src/ui'
      )

      assert.deepStrictEqual(Array.from(next), ['docs'])
    })
  })

  describe('collapseTreeDirectoryRecursively', () => {
    it('adds the target directory and every descendant implied by changed files', () => {
      const next = collapseTreeDirectoryRecursively(
        new Set<string>(),
        ['src/ui/changes/filter.tsx', 'src/lib/git.ts'],
        'src'
      )

      assert.deepStrictEqual(Array.from(next).sort(), [
        'src',
        'src/lib',
        'src/ui',
        'src/ui/changes',
      ])
    })

    it('preserves unrelated collapsed ids', () => {
      const next = collapseTreeDirectoryRecursively(
        new Set<string>(['docs']),
        ['src/ui/app.tsx', 'docs/readme.md'],
        'src'
      )

      assert.ok(next.has('docs'))
      assert.ok(next.has('src'))
    })
  })
})
