import { describe, it } from 'node:test'
import assert from 'node:assert'
import { existsSync } from 'fs'
import * as path from 'path'

import {
  getFileIconName,
  getFolderIconName,
} from '../../src/ui/changes/ide/ide-file-icons'
import {
  defaultFileIcon,
  defaultFolderIcons,
  fileExtensionIcons,
  fileNameIcons,
  folderNameIcons,
} from '../../src/ui/changes/ide/ide-icon-data'

describe('ide-file-icons', () => {
  describe('getFileIconName', () => {
    it('uses the extension', () => {
      assert.strictEqual(getFileIconName('src/Program.cs'), 'csharp')
      assert.strictEqual(getFileIconName('a/b/index.ts'), 'typescript')
    })

    it('ignores the case of the name', () => {
      assert.strictEqual(getFileIconName('Program.CS'), 'csharp')
    })

    it('prefers the file name over the extension', () => {
      assert.notStrictEqual(
        getFileIconName('package.json'),
        getFileIconName('other.json')
      )
    })

    it('uses the last extension of names with several dots', () => {
      assert.strictEqual(getFileIconName('a.test.ts'), 'typescript')
    })

    it('uses the file name of dot files', () => {
      assert.strictEqual(getFileIconName('.gitignore'), 'git')
    })

    it('falls back to the default icon', () => {
      assert.strictEqual(getFileIconName('notes.zzzunknown'), defaultFileIcon)
      assert.strictEqual(getFileIconName('NOEXTENSION'), defaultFileIcon)
    })

    it('does not mistake names of Object properties for icons', () => {
      assert.strictEqual(getFileIconName('constructor'), defaultFileIcon)
      assert.strictEqual(getFileIconName('a/__proto__'), defaultFileIcon)
      assert.strictEqual(getFileIconName('x.toString'), defaultFileIcon)
    })
  })

  describe('getFolderIconName', () => {
    it('uses the name of the last folder', () => {
      assert.strictEqual(getFolderIconName('app/src', false), 'folder-src')
      assert.strictEqual(getFolderIconName('app/src', true), 'folder-src-open')
    })

    it('falls back to the default folder icons', () => {
      assert.strictEqual(
        getFolderIconName('whatever', false),
        defaultFolderIcons[0]
      )
      assert.strictEqual(
        getFolderIconName('whatever', true),
        defaultFolderIcons[1]
      )
    })

    it('does not mistake names of Object properties for icons', () => {
      assert.strictEqual(
        getFolderIconName('constructor', false),
        defaultFolderIcons[0]
      )
    })
  })

  describe('the generated icons', () => {
    it('all exist as SVG files', () => {
      const names = new Set<string>([
        defaultFileIcon,
        ...defaultFolderIcons,
        ...Object.values(fileExtensionIcons),
        ...Object.values(fileNameIcons),
        ...Object.values(folderNameIcons).flat(),
      ])

      for (const name of names) {
        const file = path.join(
          __dirname,
          '../../static/common/ide-icons',
          `${name}.svg`
        )
        assert.ok(existsSync(file), `${name}.svg is missing`)
      }
    })
  })
})
