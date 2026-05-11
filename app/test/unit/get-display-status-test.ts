import assert from 'node:assert'
import { describe, it } from 'node:test'

import { AppFileStatus, AppFileStatusKind } from '../../src/models/status'
import { getDisplayStatus } from '../../src/ui/changes/changed-file'

function renamed(oldPath: string): AppFileStatus {
  return {
    kind: AppFileStatusKind.Renamed,
    oldPath,
    renameIncludesModifications: false,
  }
}

function copied(oldPath: string): AppFileStatus {
  return { kind: AppFileStatusKind.Copied, oldPath }
}

describe('getDisplayStatus', () => {
  it('returns the original status when displayPath matches path (flat view)', () => {
    const status = renamed('src/ui/a.ts')
    const result = getDisplayStatus(status, 'src/ui/b.ts', 'src/ui/b.ts')

    assert.equal(result, status)
  })

  it('returns the original status for non rename/copy kinds in tree view', () => {
    const status: AppFileStatus = { kind: AppFileStatusKind.Modified }
    const result = getDisplayStatus(status, 'src/ui/b.ts', 'b.ts')

    assert.equal(result, status)
  })

  it('shortens oldPath to basename for a same-directory rename', () => {
    const status = renamed('src/ui/a.ts')
    const result = getDisplayStatus(status, 'src/ui/b.ts', 'b.ts')

    assert.equal(result.kind, AppFileStatusKind.Renamed)
    assert.notEqual(result, status)
    if (result.kind === AppFileStatusKind.Renamed) {
      assert.equal(result.oldPath, 'a.ts')
    }
  })

  it('shortens oldPath to basename for a same-directory copy', () => {
    const status = copied('src/ui/a.ts')
    const result = getDisplayStatus(status, 'src/ui/b.ts', 'b.ts')

    if (result.kind === AppFileStatusKind.Copied) {
      assert.equal(result.oldPath, 'a.ts')
    } else {
      assert.fail('Expected Copied status')
    }
  })

  it('keeps the full oldPath for a cross-directory rename', () => {
    const status = renamed('legacy/dir/a.ts')
    const result = getDisplayStatus(status, 'src/ui/b.ts', 'b.ts')

    if (result.kind === AppFileStatusKind.Renamed) {
      assert.equal(result.oldPath, 'legacy/dir/a.ts')
    } else {
      assert.fail('Expected Renamed status')
    }
  })

  it('keeps the full oldPath when moving from the repository root', () => {
    const status = renamed('a.ts')
    const result = getDisplayStatus(status, 'src/ui/a.ts', 'a.ts')

    if (result.kind === AppFileStatusKind.Renamed) {
      assert.equal(result.oldPath, 'a.ts')
    } else {
      assert.fail('Expected Renamed status')
    }
  })

  it('keeps the full oldPath when moving into the repository root', () => {
    const status = renamed('src/ui/a.ts')
    const result = getDisplayStatus(status, 'a.ts', 'a.ts')

    if (result.kind === AppFileStatusKind.Renamed) {
      assert.equal(result.oldPath, 'src/ui/a.ts')
    } else {
      assert.fail('Expected Renamed status')
    }
  })
})
