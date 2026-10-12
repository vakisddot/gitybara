import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { resolve } from 'path'
import { pathToFileURL } from 'url'
import {
  decodeCSharpTokens,
  getCSharpTokenClass,
} from '../../src/lib/csharp/semantic-tokens'
import {
  getCSharpDocumentPath,
  getCSharpLocations,
} from '../../src/lib/csharp/locations'

describe('C# semantic tokens', () => {
  it('decodes absolute UTF-16 positions, including unknown categories and line changes', () => {
    assert.deepEqual(
      decodeCSharpTokens(
        [104, 8, 3, 0, 0, 0, 4, 2, 9, 0, 0, 3, 5, 1, 0, 2, 4, 7, 2, 0],
        ['keyword', 'variable', 'method']
      ),
      [
        { line: 104, start: 8, length: 3, type: 'keyword' },
        { line: 104, start: 15, length: 5, type: 'variable' },
        { line: 106, start: 4, length: 7, type: 'method' },
      ]
    )
  })

  it('stops at invalid deltas and ignores incomplete trailing tokens', () => {
    assert.deepEqual(
      decodeCSharpTokens([0, 0, 2, 0, 0, -1, 1, 2, 0, 0], ['class']),
      [{ line: 0, start: 0, length: 2, type: 'class' }]
    )
    assert.deepEqual(decodeCSharpTokens([0, 1], ['class']), [])
  })

  it('maps Roslyn-specific categories and preserves lexical colors for other tokens', () => {
    assert.equal(getCSharpTokenClass('recordClass'), 'ide-csharp-type')
    assert.equal(getCSharpTokenClass('extensionMethod'), 'ide-csharp-method')
    assert.equal(getCSharpTokenClass('controlKeyword'), 'ide-csharp-control')
    assert.equal(getCSharpTokenClass('stringEscapeCharacter'), null)
  })
})

describe('C# source locations', () => {
  const root = resolve('csharp-test-repository')
  const position = { line: 86, character: 16 }
  const range = { start: position, end: { line: 86, character: 28 } }

  it('accepts Location and LocationLink responses and deduplicates them', () => {
    const uri = pathToFileURL(resolve(root, 'Source', 'Cloud Light.cs')).href
    assert.deepEqual(
      getCSharpLocations(root, [
        { uri, range },
        { targetUri: uri, targetSelectionRange: range },
      ]),
      [{ path: 'Source/Cloud Light.cs', position }]
    )
  })

  it('ignores metadata, malformed, and outside-repository destinations', () => {
    assert.deepEqual(
      getCSharpLocations(root, [
        { uri: 'roslyn-source-generated://document', range },
        { uri: pathToFileURL(resolve(root, '..', 'outside.cs')).href, range },
        {
          uri: pathToFileURL(resolve(root, 'invalid.cs')).href,
          range: { start: { line: -1, character: 0 }, end: position },
        },
        {},
      ]),
      []
    )
  })

  it('rejects paths outside the workspace and non-C# documents', () => {
    assert.equal(
      getCSharpDocumentPath(root, 'Source/Cloud.cs'),
      resolve(root, 'Source/Cloud.cs')
    )
    assert.throws(() => getCSharpDocumentPath(root, '../outside.cs'))
    assert.throws(() => getCSharpDocumentPath(root, 'Source/file.ts'))
  })
})
