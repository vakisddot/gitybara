import { git } from './core'
import { Repository } from '../../models/repository'

/**
 * Split the output of a `git ... -z` command that lists paths, one per
 * NUL-terminated entry, into a list of paths.
 */
export function parseNullSeparatedPaths(stdout: string): ReadonlyArray<string> {
  return stdout.split('\0').filter(path => path.length > 0)
}

/**
 * Get the path of every file in the repository that is tracked or untracked
 * but not ignored, relative to the repository root and using forward slashes.
 *
 * Files that are tracked but missing from the working directory are included,
 * it's up to the caller to decide how to present them.
 */
export async function getRepositoryFilePaths(
  repository: Repository
): Promise<ReadonlyArray<string>> {
  const result = await git(
    [
      'ls-files',
      '-z',
      '--cached',
      '--others',
      '--exclude-standard',
      '--deduplicate',
    ],
    repository.path,
    'getRepositoryFilePaths'
  )

  return parseNullSeparatedPaths(result.stdout)
}
