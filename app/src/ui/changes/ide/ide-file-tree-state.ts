import { getAncestorDirectoryIds } from '../tree/tree-changes-rows'

/**
 * The IDE view lists every file in the repository, so unlike the changes tree
 * its directories start out collapsed. This module tracks which directories
 * the user has expanded instead of which ones are collapsed.
 */

/**
 * Expand a directory. Its ancestors are expanded too because a compacted row
 * such as "a/b" is only open when each directory in its chain is.
 */
export function expandIdeDirectory(
  expandedDirectoryIds: ReadonlySet<string>,
  directoryId: string
): ReadonlySet<string> {
  const next = new Set(expandedDirectoryIds)

  next.add(directoryId)
  getAncestorDirectoryIds(directoryId).forEach(id => next.add(id))

  return next
}

/**
 * Collapse a directory. Expanded descendants are left alone so they are still
 * expanded when the directory is opened again.
 */
export function collapseIdeDirectory(
  expandedDirectoryIds: ReadonlySet<string>,
  directoryId: string
): ReadonlySet<string> {
  const next = new Set(expandedDirectoryIds)
  next.delete(directoryId)
  return next
}

export function toggleIdeDirectory(
  expandedDirectoryIds: ReadonlySet<string>,
  directoryId: string
): ReadonlySet<string> {
  return expandedDirectoryIds.has(directoryId)
    ? collapseIdeDirectory(expandedDirectoryIds, directoryId)
    : expandIdeDirectory(expandedDirectoryIds, directoryId)
}

/**
 * The directories that need to be collapsed for the tree to show only the
 * expanded ones, in the form expected by buildChangesTreeRows.
 */
export function getCollapsedIdeDirectoryIds(
  allDirectoryIds: ReadonlySet<string>,
  expandedDirectoryIds: ReadonlySet<string>
): ReadonlySet<string> {
  const collapsed = new Set<string>()

  allDirectoryIds.forEach(id => {
    if (!expandedDirectoryIds.has(id)) {
      collapsed.add(id)
    }
  })

  return collapsed
}

/** The directories that contain at least one of the given file paths. */
export function getDirectoriesContainingPaths(
  paths: ReadonlyArray<string>
): ReadonlySet<string> {
  const directoryIds = new Set<string>()

  for (const path of paths) {
    getAncestorDirectoryIds(path).forEach(id => directoryIds.add(id))
  }

  return directoryIds
}

/**
 * How many of the given changed files are inside each directory, counting the
 * files in nested directories. Directories without changes are not included.
 */
export function getChangedFileCountByDirectory(
  changedPaths: ReadonlyArray<string>
): ReadonlyMap<string, number> {
  const counts = new Map<string, number>()

  for (const path of changedPaths) {
    for (const id of getAncestorDirectoryIds(path)) {
      counts.set(id, (counts.get(id) ?? 0) + 1)
    }
  }

  return counts
}

/** Every path in the repository plus any changed path git no longer lists. */
export function mergeFilePaths(
  repositoryPaths: ReadonlyArray<string>,
  changedPaths: ReadonlyArray<string>
): ReadonlyArray<string> {
  // A file deleted with `git rm` is gone from the index but still shows up as
  // a change, so make sure it has a row.
  return Array.from(new Set([...repositoryPaths, ...changedPaths]))
}

/** What narrows down the files shown in the IDE view. */
export interface IIdeFileFilter {
  /** Words that every shown path has to contain, in any order */
  readonly text: string

  /** Only show the files that have changes */
  readonly changedOnly: boolean
}

export function isIdeFileFilterActive(filter: IIdeFileFilter): boolean {
  return filter.changedOnly || filter.text.trim() !== ''
}

/**
 * The paths that pass the filter. Every word that was typed has to be somewhere
 * in the path, ignoring case, so "src ts" finds "src/index.ts". Backslashes
 * match forward slashes, so a path copied on Windows finds its file.
 */
export function filterIdePaths(
  paths: ReadonlyArray<string>,
  changedPaths: ReadonlyArray<string>,
  filter: IIdeFileFilter
): ReadonlyArray<string> {
  if (!isIdeFileFilterActive(filter)) {
    return paths
  }

  const words = filter.text
    .toLowerCase()
    .replace(/\\/g, '/')
    .split(/\s+/)
    .filter(Boolean)
  const changed = new Set(changedPaths)

  return paths.filter(path => {
    if (filter.changedOnly && !changed.has(path)) {
      return false
    }

    const lowerCasePath = path.toLowerCase()
    return words.every(word => lowerCasePath.includes(word))
  })
}
