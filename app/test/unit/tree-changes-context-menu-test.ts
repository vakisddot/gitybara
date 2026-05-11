import assert from 'node:assert'
import { afterEach, describe, it } from 'node:test'

import { DiffSelection, DiffSelectionType } from '../../src/models/diff'
import { Repository } from '../../src/models/repository'
import {
  AppFileStatusKind,
  WorkingDirectoryFileChange,
} from '../../src/models/status'
import { getTreeDirectoryContextMenu } from '../../src/ui/changes/tree/tree-changes-context-menu'
import { captureClipboardWrites } from '../helpers/ui/electron'

const repository = new Repository('/tmp/repo', -1, null, false)

function modifiedFile(path: string) {
  return new WorkingDirectoryFileChange(
    path,
    { kind: AppFileStatusKind.Modified },
    DiffSelection.fromInitialSelection(DiffSelectionType.All)
  )
}

function untrackedFile(path: string) {
  return new WorkingDirectoryFileChange(
    path,
    { kind: AppFileStatusKind.Untracked },
    DiffSelection.fromInitialSelection(DiffSelectionType.All)
  )
}

function deletedFile(path: string) {
  return new WorkingDirectoryFileChange(
    path,
    { kind: AppFileStatusKind.Deleted },
    DiffSelection.fromInitialSelection(DiffSelectionType.All)
  )
}

function getLabels(menu: ReturnType<typeof getTreeDirectoryContextMenu>) {
  return menu.map(item =>
    item.type === 'separator' ? '---' : item.label ?? ''
  )
}

function findItem(
  menu: ReturnType<typeof getTreeDirectoryContextMenu>,
  predicate: (label: string) => boolean
) {
  return menu.find(
    item => item.type !== 'separator' && predicate(item.label ?? '')
  )
}

function defaultOptions() {
  return {
    repository,
    directoryPath: 'src/ui',
    directoryChanges: [
      modifiedFile('src/ui/a.ts'),
      modifiedFile('src/ui/b.ts'),
    ],
    isRebasing: false,
    askForConfirmationOnDiscardChanges: false,
    isIncludeSelectionDisabled: () => false,
    onExpandRecursively: () => {},
    onCollapseRecursively: () => {},
    onIncludeChanged: () => {},
    onDiscardChanges: () => {},
    onIgnoreFile: () => {},
  }
}

describe('getTreeDirectoryContextMenu', () => {
  it('exposes recursive expand/collapse, include, discard and ignore actions outside rebase', () => {
    const menu = getTreeDirectoryContextMenu(defaultOptions())
    const labels = getLabels(menu).filter(label => label !== '---')

    assert.deepStrictEqual(labels, [
      'Expand Recursively',
      'Collapse Recursively',
      __DARWIN__ ? 'Include Files in Folder' : 'Include files in folder',
      __DARWIN__ ? 'Exclude Files in Folder' : 'Exclude files in folder',
      __DARWIN__
        ? 'Discard All Changes in Folder'
        : 'Discard all changes in folder',
      __DARWIN__
        ? 'Ignore Folder (Add to .gitignore)'
        : 'Ignore folder (add to .gitignore)',
      __DARWIN__ ? 'Copy Folder Path' : 'Copy folder path',
      __DARWIN__ ? 'Copy Relative Folder Path' : 'Copy relative folder path',
      __DARWIN__
        ? 'Reveal in Finder'
        : __WIN32__
        ? 'Show in Explorer'
        : 'Show in your File Manager',
    ])
  })

  it('appends an ellipsis to discard when confirmation is required', () => {
    const menu = getTreeDirectoryContextMenu({
      ...defaultOptions(),
      askForConfirmationOnDiscardChanges: true,
    })

    const discardItem = findItem(menu, label => label.startsWith('Discard'))
    assert.ok(discardItem !== undefined)
    assert.match(discardItem.label ?? '', /…$/)
  })

  it('hides include/exclude and ignore actions during rebase', () => {
    const menu = getTreeDirectoryContextMenu({
      ...defaultOptions(),
      directoryChanges: [untrackedFile('src/ui/a.ts')],
      isRebasing: true,
    })
    const labels = getLabels(menu).filter(label => label !== '---')

    assert.ok(
      !labels.some(label => label.toLowerCase().startsWith('include files'))
    )
    assert.ok(
      !labels.some(label => label.toLowerCase().startsWith('exclude files'))
    )
    assert.ok(
      !labels.some(label => label.toLowerCase().includes('ignore folder'))
    )
  })

  it('only allows discarding untracked files during rebase', () => {
    let discardedPaths: ReadonlyArray<string> | null = null
    const menu = getTreeDirectoryContextMenu({
      ...defaultOptions(),
      directoryChanges: [
        untrackedFile('src/ui/new.ts'),
        modifiedFile('src/ui/edited.ts'),
      ],
      isRebasing: true,
      onDiscardChanges: paths => {
        discardedPaths = paths
      },
    })

    const discardItem = findItem(menu, label => label.startsWith('Discard'))
    assert.ok(discardItem !== undefined)
    discardItem.action?.()

    assert.deepStrictEqual(discardedPaths, ['src/ui/new.ts'])
  })

  it('omits the discard entry entirely when rebase leaves nothing to discard', () => {
    const menu = getTreeDirectoryContextMenu({
      ...defaultOptions(),
      directoryChanges: [modifiedFile('src/ui/edited.ts')],
      isRebasing: true,
    })

    const labels = getLabels(menu).filter(label => label !== '---')
    assert.ok(!labels.some(label => label.toLowerCase().includes('discard')))
  })

  it('disables include/exclude when all changes are include-disabled', () => {
    const menu = getTreeDirectoryContextMenu({
      ...defaultOptions(),
      isIncludeSelectionDisabled: () => true,
    })

    const include = findItem(menu, label => label.startsWith('Include'))
    const exclude = findItem(menu, label => label.startsWith('Exclude'))

    assert.equal(include?.enabled, false)
    assert.equal(exclude?.enabled, false)
  })

  it('forwards an absolute-from-root pattern to onIgnoreFile', () => {
    let ignoredPattern: string | ReadonlyArray<string> | null = null
    const menu = getTreeDirectoryContextMenu({
      ...defaultOptions(),
      directoryPath: 'src/ui',
      onIgnoreFile: pattern => {
        ignoredPattern = pattern
      },
    })

    const ignoreItem = findItem(menu, label =>
      label.toLowerCase().startsWith('ignore folder')
    )
    assert.ok(ignoreItem !== undefined)
    ignoreItem.action?.()

    assert.equal(ignoredPattern, '/src/ui')
  })

  it('disables Reveal when every file in the folder is deleted', () => {
    const menu = getTreeDirectoryContextMenu({
      ...defaultOptions(),
      directoryChanges: [deletedFile('src/ui/gone.ts')],
    })

    const reveal = findItem(menu, label =>
      [
        'Reveal in Finder',
        'Show in Explorer',
        'Show in your File Manager',
      ].includes(label)
    )

    assert.equal(reveal?.enabled, false)
  })

  describe('clipboard actions', () => {
    let capture: ReturnType<typeof captureClipboardWrites> | null = null

    afterEach(() => {
      capture?.restore()
      capture = null
    })

    it('copies the absolute folder path', () => {
      capture = captureClipboardWrites()
      const menu = getTreeDirectoryContextMenu(defaultOptions())
      const copyItem = findItem(menu, label =>
        label.toLowerCase().startsWith('copy folder path')
      )
      copyItem?.action?.()

      assert.deepStrictEqual(capture.writes, ['/tmp/repo/src/ui'])
    })

    it('copies the repository-relative folder path', () => {
      capture = captureClipboardWrites()
      const menu = getTreeDirectoryContextMenu(defaultOptions())
      const copyItem = findItem(menu, label =>
        label.toLowerCase().startsWith('copy relative folder path')
      )
      copyItem?.action?.()

      assert.deepStrictEqual(capture.writes, ['src/ui'])
    })
  })
})
