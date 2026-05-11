import {
  getAncestorDirectoryIds,
  getChangesTreeDirectoryIds,
  getDescendantDirectoryIds,
  IChangesTreeFileItem,
} from './tree-changes-rows'

export function toggleCollapsedTreeDirectoryId(
  collapsedDirectoryIds: ReadonlySet<string>,
  directoryId: string
): ReadonlySet<string> {
  const nextCollapsedDirectoryIds = new Set(collapsedDirectoryIds)

  if (nextCollapsedDirectoryIds.has(directoryId)) {
    nextCollapsedDirectoryIds.delete(directoryId)
  } else {
    nextCollapsedDirectoryIds.add(directoryId)
  }

  return nextCollapsedDirectoryIds
}

export function getTreeDirectoryIds(
  filePaths: ReadonlyArray<string>
): ReadonlySet<string> {
  const files = filePaths.map(
    (path): IChangesTreeFileItem => ({
      id: path,
      path,
    })
  )

  return getChangesTreeDirectoryIds(files)
}

export function pruneCollapsedTreeDirectoryIds(
  collapsedDirectoryIds: ReadonlySet<string>,
  filePaths: ReadonlyArray<string>
): ReadonlySet<string> {
  if (collapsedDirectoryIds.size === 0) {
    return collapsedDirectoryIds
  }

  // Compare against un-compacted ancestors: a collapsed id that is currently
  // folded away still governs the compacted row's state.
  const ancestorDirectoryIds = new Set<string>()
  for (const path of filePaths) {
    for (const id of getAncestorDirectoryIds(path)) {
      ancestorDirectoryIds.add(id)
    }
  }

  const nextCollapsedDirectoryIds = new Set<string>()
  let removedStaleId = false

  collapsedDirectoryIds.forEach(id => {
    if (ancestorDirectoryIds.has(id)) {
      nextCollapsedDirectoryIds.add(id)
    } else {
      removedStaleId = true
    }
  })

  return removedStaleId ? nextCollapsedDirectoryIds : collapsedDirectoryIds
}

export function expandTreeDirectoryRecursively(
  collapsedDirectoryIds: ReadonlySet<string>,
  allFilePaths: ReadonlyArray<string>,
  directoryPath: string
): ReadonlySet<string> {
  const directoryIds = getDescendantDirectoryIds(allFilePaths, directoryPath)
  const nextCollapsedDirectoryIds = new Set(collapsedDirectoryIds)

  directoryIds.forEach(id => {
    nextCollapsedDirectoryIds.delete(id)
  })

  return nextCollapsedDirectoryIds
}

export function collapseTreeDirectoryRecursively(
  collapsedDirectoryIds: ReadonlySet<string>,
  allFilePaths: ReadonlyArray<string>,
  directoryPath: string
): ReadonlySet<string> {
  const directoryIds = getDescendantDirectoryIds(allFilePaths, directoryPath)
  const nextCollapsedDirectoryIds = new Set(collapsedDirectoryIds)

  directoryIds.forEach(id => {
    nextCollapsedDirectoryIds.add(id)
  })

  return nextCollapsedDirectoryIds
}
