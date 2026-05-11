import * as Path from 'path'
import { clipboard } from 'electron'

import { revealInFileManager } from '../../../lib/app-shell'
import { IMenuItem } from '../../../lib/menu-item'
import { Repository } from '../../../models/repository'
import {
  AppFileStatusKind,
  WorkingDirectoryFileChange,
} from '../../../models/status'
import {
  CopyFolderPathLabel,
  CopyRelativeFolderPathLabel,
  RevealInFileManagerLabel,
} from '../../lib/context-menu'

interface ITreeDirectoryContextMenuOptions {
  readonly repository: Repository
  readonly directoryPath: string
  readonly directoryChanges: ReadonlyArray<WorkingDirectoryFileChange>
  readonly isRebasing: boolean
  readonly askForConfirmationOnDiscardChanges: boolean
  readonly isIncludeSelectionDisabled: (
    file: WorkingDirectoryFileChange
  ) => boolean
  readonly onExpandRecursively: (directoryPath: string) => void
  readonly onCollapseRecursively: (directoryPath: string) => void
  readonly onIncludeChanged: (
    file:
      | WorkingDirectoryFileChange
      | ReadonlyArray<WorkingDirectoryFileChange>,
    include: boolean
  ) => void
  readonly onDiscardChanges: (paths: ReadonlyArray<string>) => void
  readonly onIgnoreFile: (pattern: string | string[]) => void
}

function getDiscardDirectoryChangesMenuItem(
  paths: ReadonlyArray<string>,
  askForConfirmationOnDiscardChanges: boolean,
  onDiscardChanges: (paths: ReadonlyArray<string>) => void
): IMenuItem {
  const label = __DARWIN__
    ? 'Discard All Changes in Folder'
    : 'Discard all changes in folder'

  return {
    label: askForConfirmationOnDiscardChanges ? `${label}…` : label,
    action: () => onDiscardChanges(paths),
    enabled: paths.length > 0,
  }
}

function getCopyFolderPathMenuItem(
  repository: Repository,
  directoryPath: string
): IMenuItem {
  return {
    label: CopyFolderPathLabel,
    action: () => {
      const fullPath = Path.join(repository.path, directoryPath)
      clipboard.writeText(fullPath)
    },
  }
}

function getCopyRelativeFolderPathMenuItem(directoryPath: string): IMenuItem {
  return {
    label: CopyRelativeFolderPathLabel,
    action: () => clipboard.writeText(Path.normalize(directoryPath)),
  }
}

export function getTreeDirectoryContextMenu(
  options: ITreeDirectoryContextMenuOptions
): ReadonlyArray<IMenuItem> {
  const {
    repository,
    directoryPath,
    directoryChanges,
    isRebasing,
    askForConfirmationOnDiscardChanges,
    isIncludeSelectionDisabled,
    onExpandRecursively,
    onCollapseRecursively,
    onIncludeChanged,
    onDiscardChanges,
    onIgnoreFile,
  } = options
  const discardableDirectoryChanges = isRebasing
    ? directoryChanges.filter(
        file => file.status.kind === AppFileStatusKind.Untracked
      )
    : directoryChanges
  const actionableDirectoryChanges = directoryChanges.filter(
    file => !isIncludeSelectionDisabled(file)
  )
  const hasRevealableFile = directoryChanges.some(
    file => file.status.kind !== AppFileStatusKind.Deleted
  )

  return [
    {
      label: 'Expand Recursively',
      action: () => onExpandRecursively(directoryPath),
    },
    {
      label: 'Collapse Recursively',
      action: () => onCollapseRecursively(directoryPath),
    },
    ...(isRebasing
      ? []
      : [
          { type: 'separator' } as IMenuItem,
          {
            label: __DARWIN__
              ? 'Include Files in Folder'
              : 'Include files in folder',
            action: () => onIncludeChanged(actionableDirectoryChanges, true),
            enabled: actionableDirectoryChanges.length > 0,
          },
          {
            label: __DARWIN__
              ? 'Exclude Files in Folder'
              : 'Exclude files in folder',
            action: () => onIncludeChanged(actionableDirectoryChanges, false),
            enabled: actionableDirectoryChanges.length > 0,
          },
        ]),
    ...(isRebasing && discardableDirectoryChanges.length === 0
      ? []
      : [
          { type: 'separator' } as IMenuItem,
          getDiscardDirectoryChangesMenuItem(
            discardableDirectoryChanges.map(file => file.path),
            askForConfirmationOnDiscardChanges,
            onDiscardChanges
          ),
        ]),
    ...(isRebasing
      ? []
      : [
          { type: 'separator' } as IMenuItem,
          {
            label: __DARWIN__
              ? 'Ignore Folder (Add to .gitignore)'
              : 'Ignore folder (add to .gitignore)',
            action: () => onIgnoreFile(`/${directoryPath}`),
          },
        ]),
    { type: 'separator' },
    getCopyFolderPathMenuItem(repository, directoryPath),
    getCopyRelativeFolderPathMenuItem(directoryPath),
    { type: 'separator' },
    {
      label: RevealInFileManagerLabel,
      action: () => revealInFileManager(repository, directoryPath),
      enabled: hasRevealableFile,
    },
  ]
}
