import { describe, it } from 'node:test'
import assert from 'node:assert'
import { mkdir, unlink, writeFile } from 'fs/promises'
import * as path from 'path'

import { getRepositoryFilePaths } from '../../../src/lib/git/ls-files'
import { setupEmptyRepository } from '../../helpers/repositories'
import { exec } from 'dugite'

describe('git/ls-files', () => {
  describe('getRepositoryFilePaths', () => {
    it('lists tracked and untracked files but not ignored ones', async t => {
      const repo = await setupEmptyRepository(t)
      await mkdir(path.join(repo.path, 'src'))
      await mkdir(path.join(repo.path, 'bin'))
      await writeFile(path.join(repo.path, '.gitignore'), 'bin/\n')
      await writeFile(path.join(repo.path, 'README.md'), 'readme')
      await writeFile(path.join(repo.path, 'src', 'tracked.ts'), 'tracked')
      await exec(['add', '.'], repo.path)
      await writeFile(path.join(repo.path, 'src', 'untracked.ts'), 'new')
      await writeFile(path.join(repo.path, 'bin', 'ignored.dll'), 'ignored')

      const paths = await getRepositoryFilePaths(repo)

      assert.deepStrictEqual([...paths].sort(), [
        '.gitignore',
        'README.md',
        'src/tracked.ts',
        'src/untracked.ts',
      ])
    })

    it('includes tracked files that were deleted from the working directory', async t => {
      const repo = await setupEmptyRepository(t)
      await writeFile(path.join(repo.path, 'gone.ts'), 'gone')
      await exec(['add', '.'], repo.path)
      await unlink(path.join(repo.path, 'gone.ts'))

      const paths = await getRepositoryFilePaths(repo)

      assert.deepStrictEqual(paths, ['gone.ts'])
    })
  })
})
