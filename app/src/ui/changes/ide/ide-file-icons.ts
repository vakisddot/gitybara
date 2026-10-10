import {
  defaultFileIcon,
  defaultFolderIcons,
  fileExtensionIcons,
  fileNameIcons,
  folderNameIcons,
} from './ide-icon-data'

function getBaseName(path: string) {
  return path.substring(path.lastIndexOf('/') + 1).toLowerCase()
}

// The icon tables are plain objects, so look names up as own properties only,
// otherwise a file called "constructor" would find Object's constructor.
function getOwn<T>(table: { readonly [key: string]: T }, key: string) {
  return Object.prototype.hasOwnProperty.call(table, key) ? table[key] : null
}

/**
 * The name of the icon for a file, which is the name of an SVG in
 * static/ide-icons. A file is matched by its name first, then by its
 * extension: "a.test.ts" is looked up as "test.ts" and then as "ts".
 */
export function getFileIconName(path: string): string {
  const name = getBaseName(path)

  const byName = getOwn(fileNameIcons, name)
  if (byName !== null) {
    return byName
  }

  for (let i = name.indexOf('.'); i !== -1; i = name.indexOf('.', i + 1)) {
    const byExtension = getOwn(fileExtensionIcons, name.substring(i + 1))

    if (byExtension !== null) {
      return byExtension
    }
  }

  return defaultFileIcon
}

/** The name of the icon for a folder, open or closed. */
export function getFolderIconName(path: string, expanded: boolean): string {
  const icons = getOwn(folderNameIcons, getBaseName(path)) ?? defaultFolderIcons

  return expanded ? icons[1] : icons[0]
}
