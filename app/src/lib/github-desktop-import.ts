import { matchExistingRepository } from './repository-matching'

/** A repository from GitHub Desktop's repository list. */
export interface IGitHubDesktopRepository {
  readonly path: string
  readonly alias: string | null
}

/** What importing GitHub Desktop's repositories would change. */
export interface IImportPlan<T extends { readonly alias: string | null }> {
  /** Repositories that aren't in the app yet. */
  readonly toAdd: ReadonlyArray<IGitHubDesktopRepository>

  /** How many of the repositories are already in the app. */
  readonly alreadyAdded: number

  /** Existing repositories with no alias of their own, and the one to adopt. */
  readonly aliasUpdates: ReadonlyArray<{
    readonly repository: T
    readonly alias: string
  }>
}

/**
 * Work out how to merge GitHub Desktop's repositories into the app's.
 *
 * The import only ever adds. Repositories already in the app are left alone,
 * and an alias that is already set is never overwritten.
 */
export function planImport<
  T extends { readonly path: string; readonly alias: string | null }
>(
  existing: ReadonlyArray<T>,
  incoming: ReadonlyArray<IGitHubDesktopRepository>
): IImportPlan<T> {
  const seen = new Array<IGitHubDesktopRepository>()
  const toAdd = new Array<IGitHubDesktopRepository>()
  const aliasUpdates = new Array<{ repository: T; alias: string }>()
  let alreadyAdded = 0

  for (const repository of incoming) {
    if (matchExistingRepository(seen, repository.path) !== undefined) {
      continue
    }
    seen.push(repository)

    const match = matchExistingRepository(existing, repository.path)
    if (match === undefined) {
      toAdd.push(repository)
      continue
    }

    alreadyAdded++
    if (match.alias === null && repository.alias !== null) {
      aliasUpdates.push({ repository: match, alias: repository.alias })
    }
  }

  return { toAdd, alreadyAdded, aliasUpdates }
}
