import { isAbsolute, relative, resolve, sep } from 'path'
import { fileURLToPath } from 'url'
import { ICSharpLocation, ICSharpPosition, ICSharpRange } from './types'

/** Roslyn may return either a Location or a LocationLink. */
export interface ICSharpProtocolLocation {
  readonly uri?: string
  readonly range?: ICSharpRange
  readonly targetUri?: string
  readonly targetSelectionRange?: ICSharpRange
}

/** Resolve only source locations inside the current repository. */
export function getCSharpLocations(
  repositoryPath: string,
  locations: ReadonlyArray<ICSharpProtocolLocation>
): ReadonlyArray<ICSharpLocation> {
  const result: ICSharpLocation[] = []
  const seen = new Set<string>()
  for (const location of locations) {
    const uri = location.targetUri ?? location.uri
    const position = (location.targetSelectionRange ?? location.range)?.start
    if (uri === undefined || position === undefined) {
      continue
    }
    try {
      const path = relative(repositoryPath, fileURLToPath(uri))
      if (
        path === '..' ||
        path.startsWith(`..${sep}`) ||
        isAbsolute(path) ||
        !isCSharpPosition(position)
      ) {
        continue
      }
      const normalized = path.split(sep).join('/')
      const key = `${normalized}\0${position.line}\0${position.character}`
      if (!seen.has(key)) {
        seen.add(key)
        result.push({ path: normalized, position })
      }
    } catch {
      // Metadata and generated-document URIs aren't files in this repository.
    }
  }
  return result
}

/** Reject document paths that escape the repository before starting Roslyn. */
export function getCSharpDocumentPath(
  repositoryPath: string,
  path: string
): string {
  const fullPath = resolve(repositoryPath, path)
  const inside = relative(repositoryPath, fullPath)
  if (
    inside === '..' ||
    inside.startsWith(`..${sep}`) ||
    isAbsolute(inside) ||
    !fullPath.toLowerCase().endsWith('.cs')
  ) {
    throw new Error('C# support only accepts .cs files inside the repository.')
  }
  return fullPath
}

/** LSP and CodeMirror both use zero-based UTF-16 positions. */
export function isCSharpPosition(position: ICSharpPosition): boolean {
  return (
    Number.isSafeInteger(position.line) &&
    Number.isSafeInteger(position.character) &&
    position.line >= 0 &&
    position.character >= 0
  )
}
