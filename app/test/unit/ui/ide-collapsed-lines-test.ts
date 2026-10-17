import assert from 'node:assert'
import { afterEach, beforeEach, describe, it } from 'node:test'
import CodeMirror from 'codemirror'
import * as React from 'react'

import { IdeCodeEditor } from '../../../src/ui/changes/ide/ide-code-editor'
import {
  ILineRange,
  NoLineChanges,
} from '../../../src/ui/changes/ide/ide-line-changes'
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

const text = Array.from({ length: 20 }, (_, i) => `line ${i}`).join('\n')
const ranges: ReadonlyArray<ILineRange> = [
  { start: 0, end: 5 },
  { start: 12, end: 19 },
]

let ref: React.RefObject<IdeCodeEditor>
let view: ReturnType<typeof render>
let container: HTMLElement

const props: React.ComponentProps<typeof IdeCodeEditor> = {
  path: 'file.txt',
  text,
  revision: 0,
  draft: null,
  tabSize: 2,
  highlight: false,
  readOnly: true,
  lineChanges: NoLineChanges,
  unchangedTextOpacity: 100,
  showPreviousLines: false,
  collapsedRanges: ranges,
  onDirtyChange: () => {},
  onSave: () => {},
}

const widgets = () =>
  Array.from(
    container.querySelectorAll('.ide-collapsed-lines'),
    e => e.textContent
  )

const shownLines = () =>
  Array.from(
    container.querySelectorAll('pre.CodeMirror-line'),
    e => e.textContent
  ).filter(line => line?.startsWith('line '))

const rerender = (collapsedRanges: ReadonlyArray<ILineRange>) =>
  view.rerender(
    React.createElement(IdeCodeEditor, { ...props, ref, collapsedRanges })
  )

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
      get: () => (key === 'offsetHeight' ? 20 : 800),
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

describe('IdeCodeEditor collapsed lines', () => {
  it('hides the lines of the ranges behind a line that counts them', () => {
    assert.deepStrictEqual(widgets(), [
      '⋯ 6 unchanged lines',
      '⋯ 8 unchanged lines',
    ])
    assert.deepStrictEqual(shownLines(), [
      'line 6',
      'line 7',
      'line 8',
      'line 9',
      'line 10',
      'line 11',
    ])
  })

  it('shows the lines when the line that counts them is clicked', () => {
    container.querySelector<HTMLElement>('.ide-collapsed-lines')!.click()

    assert.deepStrictEqual(widgets(), ['⋯ 8 unchanged lines'])
    assert.strictEqual(shownLines()[0], 'line 0')
  })

  it('keeps lines that were shown while the ranges stay the same', () => {
    container.querySelector<HTMLElement>('.ide-collapsed-lines')!.click()
    rerender(ranges.map(range => ({ ...range })))
    assert.deepStrictEqual(widgets(), ['⋯ 8 unchanged lines'])

    rerender([{ start: 0, end: 3 }])
    assert.deepStrictEqual(widgets(), ['⋯ 4 unchanged lines'])
  })

  it('shows the whole file without ranges', () => {
    rerender([])
    assert.deepStrictEqual(widgets(), [])
    assert.strictEqual(shownLines().length, 20)
  })

  it('shows the collapsed lines that a match of a search is in', () => {
    ref.current!.search('line 14', 'next')
    assert.deepStrictEqual(widgets(), ['⋯ 6 unchanged lines'])
  })
})

describe('IdeCodeEditor changed lines', () => {
  it('always gives the changed lines a color in the background', () => {
    view.rerender(
      React.createElement(IdeCodeEditor, {
        ...props,
        ref,
        collapsedRanges: [],
        lineChanges: {
          ...NoLineChanges,
          added: new Set([7]),
          modified: new Set([8]),
        },
      })
    )

    assert.strictEqual(
      container.querySelectorAll('.change-added-line').length,
      1
    )
    assert.strictEqual(
      container.querySelectorAll('.change-modified-line').length,
      1
    )
  })
})
