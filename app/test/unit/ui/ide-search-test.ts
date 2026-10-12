import assert from 'node:assert'
import { afterEach, beforeEach, describe, it } from 'node:test'
import CodeMirror from 'codemirror'
import * as React from 'react'

import { IdeCodeEditor } from '../../../src/ui/changes/ide/ide-code-editor'
import { NoLineChanges } from '../../../src/ui/changes/ide/ide-line-changes'
import { render } from '../../helpers/ui/render'

const originalBounds = window.Range.prototype.getBoundingClientRect
const originalRects = window.Range.prototype.getClientRects
const originalRequestFrame = window.requestAnimationFrame
const originalCancelFrame = window.cancelAnimationFrame
const originalScrollbarStyle = CodeMirror.defaults.scrollbarStyle
const sizeProperties = [
  'offsetHeight',
  'offsetWidth',
  'clientHeight',
  'clientWidth',
] as const
const originalSizes = sizeProperties.map(key =>
  Object.getOwnPropertyDescriptor(window.HTMLElement.prototype, key)
)

const text = [
  'function Alpha() {',
  '  return alpha + beta',
  '}',
  '',
  'const gamma = ALPHA',
].join('\n')

let ref: React.RefObject<IdeCodeEditor>
let view: ReturnType<typeof render>
let container: HTMLElement

const props: React.ComponentProps<typeof IdeCodeEditor> = {
  path: 'file.ts',
  text,
  revision: 0,
  draft: null,
  tabSize: 2,
  highlight: false,
  readOnly: true,
  lineChanges: NoLineChanges,
  highlightChanges: false,
  unchangedTextOpacity: 100,
  showPreviousLines: false,
  onDirtyChange: () => {},
  onSave: () => {},
}

const textOf = (selector: string) =>
  Array.from(container.querySelectorAll(selector), e => e.textContent)

beforeEach(() => {
  // jsdom has no text layout, which the editor draws and scrolls by
  window.Range.prototype.getBoundingClientRect = () => new window.DOMRect()
  window.Range.prototype.getClientRects = () => [] as unknown as DOMRectList
  window.requestAnimationFrame = callback =>
    window.setTimeout(() => callback(0), 0)
  window.cancelAnimationFrame = id => window.clearTimeout(id)
  CodeMirror.defaults.scrollbarStyle = 'null'
  sizeProperties.forEach(key =>
    Object.defineProperty(window.HTMLElement.prototype, key, {
      configurable: true,
      get: () =>
        key === 'offsetHeight' ? 20 : key === 'clientHeight' ? 200 : 800,
    })
  )

  ref = React.createRef<IdeCodeEditor>()
  view = render(React.createElement(IdeCodeEditor, { ...props, ref }))
  container = view.container
})

afterEach(() => {
  window.Range.prototype.getBoundingClientRect = originalBounds
  window.Range.prototype.getClientRects = originalRects
  window.requestAnimationFrame = originalRequestFrame
  window.cancelAnimationFrame = originalCancelFrame
  CodeMirror.defaults.scrollbarStyle = originalScrollbarStyle
  sizeProperties.forEach((key, i) => {
    const descriptor = originalSizes[i]
    if (descriptor) {
      Object.defineProperty(window.HTMLElement.prototype, key, descriptor)
    } else {
      delete window.HTMLElement.prototype[key]
    }
  })
})

describe('IdeCodeEditor search', () => {
  it('goes through the matches, whatever their case, and wraps around', () => {
    const editor = ref.current!

    assert.deepStrictEqual(editor.search('alpha', 'next'), {
      index: 0,
      total: 3,
    })
    assert.deepStrictEqual(textOf('.ide-search-current'), ['Alpha'])
    assert.deepStrictEqual(textOf('.ide-search-match'), ['alpha', 'ALPHA'])

    assert.strictEqual(editor.search('alpha', 'next')?.index, 1)
    assert.deepStrictEqual(textOf('.ide-search-current'), ['alpha'])
    assert.strictEqual(editor.search('alpha', 'next')?.index, 2)
    assert.strictEqual(editor.search('alpha', 'next')?.index, 0)
    assert.strictEqual(editor.search('alpha', 'previous')?.index, 2)
    assert.deepStrictEqual(textOf('.ide-search-current'), ['ALPHA'])
  })

  it('starts at the last match when it goes back with a new query', () => {
    assert.deepStrictEqual(ref.current!.search('a', 'previous'), {
      index: 8,
      total: 9,
    })
  })

  it('marks nothing when nothing matches or the query is empty', () => {
    const editor = ref.current!

    editor.search('alpha', 'next')

    assert.strictEqual(editor.search('delta', 'next'), null)
    assert.strictEqual(container.querySelector('[class*="ide-search"]'), null)

    editor.search('alpha', 'next')

    assert.strictEqual(editor.search('   ', 'next'), null)
    assert.strictEqual(container.querySelector('[class*="ide-search"]'), null)
  })

  it('shows what matches in full while it searches', () => {
    const editor = ref.current!
    const isSearching = () =>
      container
        .querySelector('.ide-code-editor')!
        .classList.contains('is-searching')

    editor.search('alpha', 'next')
    assert.strictEqual(isSearching(), true)

    editor.clearSearch()
    assert.strictEqual(isSearching(), false)
    assert.strictEqual(container.querySelector('[class*="ide-search"]'), null)

    editor.search('delta', 'next')
    assert.strictEqual(isSearching(), false)
  })

  it('forgets the matches when the text changes', () => {
    const editor = ref.current!

    editor.search('beta', 'next')
    assert.strictEqual(textOf('.ide-search-current').length, 1)

    // A new revision of the text of the file replaces the text of the editor
    view.rerender(
      React.createElement(IdeCodeEditor, {
        ...props,
        ref,
        revision: 1,
        text: 'beta\nbeta',
      })
    )

    assert.strictEqual(container.querySelector('[class*="ide-search"]'), null)
    assert.deepStrictEqual(ref.current!.search('beta', 'next'), {
      index: 0,
      total: 2,
    })
  })

  it('unfolds the block that hides a match', () => {
    const editor = ref.current!

    editor.foldAll()
    assert.ok(container.querySelector('.ide-fold-ellipsis'))

    editor.search('beta', 'next')
    assert.strictEqual(container.querySelector('.ide-fold-ellipsis'), null)
    assert.deepStrictEqual(textOf('.ide-search-current'), ['beta'])
  })
})
