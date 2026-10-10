import { describe, it } from 'node:test'
import assert from 'node:assert'
import { mkdir, unlink, writeFile } from 'fs/promises'
import * as path from 'path'
import { exec } from 'dugite'

import {
  decodeFileContents,
  isBinaryBuffer,
  isHighlightable,
  MaxHighlightedFileLength,
  MaxViewableFileSize,
  readIdeFileContents,
  splitIntoLines,
} from '../../src/ui/changes/ide/ide-file-contents'
import { getLongestLineLength } from '../../src/ui/changes/ide/ide-file-viewer'
import { setupEmptyRepository } from '../helpers/repositories'

describe('ide-file-contents', () => {
  describe('splitIntoLines', () => {
    it('splits on LF, CRLF and CR', () => {
      assert.deepStrictEqual(splitIntoLines('a\nb\r\nc\rd'), [
        'a',
        'b',
        'c',
        'd',
      ])
    })

    it('does not add a line for a line ending at the end', () => {
      assert.deepStrictEqual(splitIntoLines('a\nb\n'), ['a', 'b'])
    })

    it('keeps blank lines, including the last one before the ending', () => {
      assert.deepStrictEqual(splitIntoLines('a\n\nb\n\n'), ['a', '', 'b', ''])
    })

    it('has no lines for empty text', () => {
      assert.deepStrictEqual(splitIntoLines(''), [])
    })
  })

  describe('isBinaryBuffer', () => {
    it('detects a NUL byte', () => {
      assert.strictEqual(isBinaryBuffer(Buffer.from([0x61, 0x00, 0x62])), true)
    })

    it('accepts text', () => {
      assert.strictEqual(isBinaryBuffer(Buffer.from('héllo\n')), false)
    })
  })

  describe('decodeFileContents', () => {
    it('decodes text and drops the byte order mark', () => {
      const result = decodeFileContents(Buffer.from('﻿a\nb\n'), false)

      assert.deepStrictEqual(result, {
        kind: 'text',
        lines: ['a', 'b'],
        isDeleted: false,
      })
    })

    it('reports binary files', () => {
      const result = decodeFileContents(Buffer.from([1, 0, 2]), false)

      assert.deepStrictEqual(result, { kind: 'binary' })
    })

    it('reports files that are too large', () => {
      const result = decodeFileContents(
        Buffer.alloc(MaxViewableFileSize + 1, 'a'),
        false
      )

      assert.deepStrictEqual(result, {
        kind: 'too-large',
        size: MaxViewableFileSize + 1,
      })
    })
  })

  describe('readIdeFileContents', () => {
    it('reads a file from the working directory', async t => {
      const repo = await setupEmptyRepository(t)
      await writeFile(path.join(repo.path, 'a.txt'), 'one\ntwo\n')

      const result = await readIdeFileContents(repo, 'a.txt')

      assert.deepStrictEqual(result, {
        kind: 'text',
        lines: ['one', 'two'],
        isDeleted: false,
      })
    })

    it('shows the committed version of a deleted file', async t => {
      const repo = await setupEmptyRepository(t)
      await writeFile(path.join(repo.path, 'gone.txt'), 'old\n')
      await exec(['add', '.'], repo.path)
      await exec(['commit', '-m', 'add gone.txt'], repo.path)
      await unlink(path.join(repo.path, 'gone.txt'))

      const result = await readIdeFileContents(repo, 'gone.txt')

      assert.deepStrictEqual(result, {
        kind: 'text',
        lines: ['old'],
        isDeleted: true,
      })
    })

    it('reports a file that never existed as missing', async t => {
      const repo = await setupEmptyRepository(t)

      const result = await readIdeFileContents(repo, 'nope.txt')

      assert.deepStrictEqual(result, { kind: 'missing' })
    })

    it('reports a directory as not a file', async t => {
      const repo = await setupEmptyRepository(t)
      await mkdir(path.join(repo.path, 'dir'))

      const result = await readIdeFileContents(repo, 'dir')

      assert.deepStrictEqual(result, { kind: 'not-a-file' })
    })
  })

  describe('isHighlightable', () => {
    it('accepts ordinary files', () => {
      assert.strictEqual(isHighlightable(['const a = 1', 'a++']), true)
      assert.strictEqual(isHighlightable([]), true)
    })

    it('rejects files longer than the limit, counting line endings', () => {
      assert.strictEqual(
        isHighlightable(['a'.repeat(MaxHighlightedFileLength - 1)]),
        true
      )
      assert.strictEqual(
        isHighlightable(['a'.repeat(MaxHighlightedFileLength)]),
        false
      )
    })
  })

  describe('getLongestLineLength', () => {
    it('finds the longest line', () => {
      assert.strictEqual(getLongestLineLength(['ab', 'abcd', 'abc'], 4), 4)
    })

    it('counts tabs as the tab size', () => {
      assert.strictEqual(getLongestLineLength(['\t\tab'], 4), 10)
    })

    it('is zero without lines', () => {
      assert.strictEqual(getLongestLineLength([], 4), 0)
    })
  })
})
