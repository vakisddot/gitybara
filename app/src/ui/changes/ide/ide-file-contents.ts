import { readFile, stat } from 'fs/promises'
import * as Path from 'path'

import { Repository } from '../../../models/repository'
import { getBlobContents } from '../../../lib/git/show'

/** Files larger than this are not shown, to keep the viewer responsive. */
export const MaxViewableFileSize = 5 * 1024 * 1024

/** Files with more characters than this are shown without syntax colors. */
export const MaxHighlightedFileLength = 1024 * 1024

/** How many bytes at the start of a file are checked for binary data. */
const BinarySniffLength = 8000

export type IdeFileContents =
  | {
      readonly kind: 'text'
      readonly lines: ReadonlyArray<string>

      /**
       * The file no longer exists in the working directory, and these are the
       * contents of the last committed version.
       */
      readonly isDeleted: boolean
    }
  | { readonly kind: 'binary' }
  | { readonly kind: 'too-large'; readonly size: number }
  | { readonly kind: 'not-a-file' }
  | { readonly kind: 'missing' }

/**
 * Like git does, treat a file as binary if there is a NUL byte near the start.
 * This also catches UTF-16 files, which can't be shown as UTF-8 text.
 */
export function isBinaryBuffer(buffer: Buffer): boolean {
  return buffer.subarray(0, BinarySniffLength).includes(0)
}

/**
 * Split text into lines, accepting any of \n, \r\n and \r as a line ending. A
 * line ending at the very end of the text doesn't start another line.
 */
export function splitIntoLines(text: string): ReadonlyArray<string> {
  if (text.length === 0) {
    return []
  }

  const lines = text.split(/\r\n|\r|\n/)

  if (lines[lines.length - 1] === '') {
    lines.pop()
  }

  return lines
}

/** Whether the lines are short enough to be worth syntax highlighting. */
export function isHighlightable(lines: ReadonlyArray<string>): boolean {
  let length = 0

  for (const line of lines) {
    length += line.length + 1

    if (length > MaxHighlightedFileLength) {
      return false
    }
  }

  return true
}

export function decodeFileContents(
  buffer: Buffer,
  isDeleted: boolean
): IdeFileContents {
  if (buffer.length > MaxViewableFileSize) {
    return { kind: 'too-large', size: buffer.length }
  }

  if (isBinaryBuffer(buffer)) {
    return { kind: 'binary' }
  }

  // Drop the byte order mark, it isn't part of the text
  const text = buffer.toString('utf8').replace(/^﻿/, '')

  return { kind: 'text', lines: splitIntoLines(text), isDeleted }
}

/**
 * Read a file of the repository to show it. If the file isn't in the working
 * directory anymore the last committed version is shown instead, when there is
 * one.
 */
export async function readIdeFileContents(
  repository: Repository,
  path: string
): Promise<IdeFileContents> {
  try {
    const fullPath = Path.join(repository.path, path)
    const stats = await stat(fullPath)

    if (!stats.isFile()) {
      return { kind: 'not-a-file' }
    }

    if (stats.size > MaxViewableFileSize) {
      return { kind: 'too-large', size: stats.size }
    }

    return decodeFileContents(await readFile(fullPath), false)
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw e
    }
  }

  try {
    const committed = await getBlobContents(repository, 'HEAD', path)
    return decodeFileContents(committed, true)
  } catch (e) {
    return { kind: 'missing' }
  }
}
