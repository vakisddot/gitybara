import { caseInsensitiveCompare } from '../../../lib/compare'

export interface IChangesTreeFileItem {
  readonly id: string
  readonly path: string
}

// A directory row is derived from changed file paths. Empty directories are
// never represented because the tree is not read from the working tree.
export interface IChangesTreeDirectoryRow {
  readonly kind: 'directory'
  readonly id: string
  readonly name: string
  readonly path: string
  readonly depth: number
  readonly fileCount: number
  readonly expanded: boolean
}

export interface IChangesTreeFileRow<T extends IChangesTreeFileItem> {
  readonly kind: 'file'
  readonly id: string
  readonly item: T
  readonly depth: number
  readonly displayPath: string
}

export type ChangesTreeRow<T extends IChangesTreeFileItem> =
  | IChangesTreeDirectoryRow
  | IChangesTreeFileRow<T>

// Internal mutable builder node used only while deriving immutable tree rows.
// The public result of this module remains immutable row data.
interface IChangesTreeDirectoryBuilderNode<T extends IChangesTreeFileItem> {
  readonly name: string
  readonly path: string
  directories: Map<string, IChangesTreeDirectoryBuilderNode<T>>
  files: Array<T>
  fileCount: number
}

function createDirectoryNode<T extends IChangesTreeFileItem>(
  name: string,
  path: string
): IChangesTreeDirectoryBuilderNode<T> {
  return {
    name,
    path,
    directories: new Map<string, IChangesTreeDirectoryBuilderNode<T>>(),
    files: new Array<T>(),
    fileCount: 0,
  }
}

function getPathParts(path: string): ReadonlyArray<string> {
  return path.split('/').filter(part => part.length > 0)
}

// Example: "a/b/c.ts" -> ["a", "a/b"].
export function getAncestorDirectoryIds(path: string): ReadonlyArray<string> {
  const ancestors = new Array<string>()

  for (let i = 0; i < path.length; i++) {
    if (path[i] === '/') {
      ancestors.push(path.substring(0, i))
    }
  }

  return ancestors
}

export function isPathInDirectory(path: string, directoryPath: string) {
  return path.startsWith(`${directoryPath}/`)
}

export function getDescendantDirectoryIds(
  filePaths: ReadonlyArray<string>,
  directoryPath: string
): ReadonlySet<string> {
  // Given "a", include "a", "a/b", and deeper directories implied by changed files.
  const directoryIds = new Set<string>()

  for (const path of filePaths) {
    for (const id of getAncestorDirectoryIds(path)) {
      if (id === directoryPath || isPathInDirectory(id, directoryPath)) {
        directoryIds.add(id)
      }
    }
  }

  return directoryIds
}

function addFileToTree<T extends IChangesTreeFileItem>(
  root: IChangesTreeDirectoryBuilderNode<T>,
  file: T
) {
  const parts = getPathParts(file.path)
  let node = root
  let path = ''

  for (let i = 0; i < parts.length - 1; i++) {
    const name = parts[i]
    path = path.length === 0 ? name : `${path}/${name}`
    let child = node.directories.get(name)

    if (child === undefined) {
      child = createDirectoryNode(name, path)
      node.directories.set(name, child)
    }

    child.fileCount++
    node = child
  }

  node.files.push(file)
}

function sortDirectories<T extends IChangesTreeFileItem>(
  directories: Iterable<IChangesTreeDirectoryBuilderNode<T>>
): ReadonlyArray<IChangesTreeDirectoryBuilderNode<T>> {
  return Array.from(directories).sort((a, b) =>
    caseInsensitiveCompare(a.name, b.name)
  )
}

function sortFiles<T extends IChangesTreeFileItem>(
  files: ReadonlyArray<T>
): ReadonlyArray<T> {
  return [...files].sort((a, b) => caseInsensitiveCompare(a.path, b.path))
}

function getRelativePath(path: string, parentPath: string | undefined) {
  if (parentPath === undefined || parentPath.length === 0) {
    return path
  }

  const parentPrefix = `${parentPath}/`
  return path.startsWith(parentPrefix)
    ? path.substring(parentPrefix.length)
    : path
}

function getFileName(path: string) {
  const lastSeparatorIndex = path.lastIndexOf('/')
  return lastSeparatorIndex === -1
    ? path
    : path.substring(lastSeparatorIndex + 1)
}

function compactDirectory<T extends IChangesTreeFileItem>(
  directory: IChangesTreeDirectoryBuilderNode<T>
) {
  // Collapse single-child directory chains so one changed file at "a/b/c.ts"
  // renders as directory "a/b" with file "c.ts", not two directory rows.
  let compactedDirectory = directory

  while (
    compactedDirectory.files.length === 0 &&
    compactedDirectory.directories.size === 1
  ) {
    const child = compactedDirectory.directories.values().next().value

    if (child === undefined) {
      break
    }

    compactedDirectory = child
  }

  return compactedDirectory
}

// A compacted row represents its full path chain, so any link being
// collapsed must close the row — not just the leaf path.
function isAnyAncestorCollapsed(
  directoryPath: string,
  collapsedDirectoryIds: ReadonlySet<string>
): boolean {
  if (collapsedDirectoryIds.size === 0) {
    return false
  }

  for (const id of getAncestorDirectoryIds(directoryPath)) {
    if (collapsedDirectoryIds.has(id)) {
      return true
    }
  }

  return collapsedDirectoryIds.has(directoryPath)
}

function appendRows<T extends IChangesTreeFileItem>(
  node: IChangesTreeDirectoryBuilderNode<T>,
  rows: Array<ChangesTreeRow<T>>,
  collapsedDirectoryIds: ReadonlySet<string>,
  depth: number,
  renderedParentPath?: string
) {
  // Convert the mutable tree into the flat row model expected by SectionList.
  // Example:
  //   files: a/b/c.ts, a/b/d.ts
  //   rows:  directory a/b, file c.ts, file d.ts
  for (const childDirectory of sortDirectories(node.directories.values())) {
    const directory = compactDirectory(childDirectory)
    const expanded = !isAnyAncestorCollapsed(
      directory.path,
      collapsedDirectoryIds
    )

    rows.push({
      kind: 'directory',
      id: directory.path,
      name: getRelativePath(directory.path, renderedParentPath),
      path: directory.path,
      depth,
      fileCount: directory.fileCount,
      expanded,
    })

    if (expanded) {
      appendRows(
        directory,
        rows,
        collapsedDirectoryIds,
        depth + 1,
        directory.path
      )
    }
  }

  for (const file of sortFiles(node.files)) {
    rows.push({
      kind: 'file',
      id: file.id,
      item: file,
      depth,
      displayPath: getFileName(file.path),
    })
  }
}

function appendDirectoryIds<T extends IChangesTreeFileItem>(
  node: IChangesTreeDirectoryBuilderNode<T>,
  directoryIds: Set<string>
) {
  for (const childDirectory of node.directories.values()) {
    const directory = compactDirectory(childDirectory)

    directoryIds.add(directory.path)
    appendDirectoryIds(directory, directoryIds)
  }
}

export function buildChangesTreeRows<T extends IChangesTreeFileItem>(
  files: ReadonlyArray<T>,
  collapsedDirectoryIds: ReadonlySet<string>
): ReadonlyArray<ChangesTreeRow<T>> {
  // The builder tree is temporary. It lets us count files and compact
  // directories before returning the immutable list rows used by React.
  const root = createDirectoryNode<T>('', '')

  for (const file of files) {
    addFileToTree(root, file)
  }

  const rows = new Array<ChangesTreeRow<T>>()
  appendRows(root, rows, collapsedDirectoryIds, 0)

  return rows
}

export function getChangesTreeDirectoryIds<T extends IChangesTreeFileItem>(
  files: ReadonlyArray<T>
): ReadonlySet<string> {
  // Used by collapse-all and stale-id pruning when only the compacted
  // directory row ids are needed. Avoid sorting and creating file rows.
  const root = createDirectoryNode<T>('', '')

  for (const file of files) {
    addFileToTree(root, file)
  }

  const directoryIds = new Set<string>()
  appendDirectoryIds(root, directoryIds)

  return directoryIds
}
