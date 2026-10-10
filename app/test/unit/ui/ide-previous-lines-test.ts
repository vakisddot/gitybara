import assert from 'node:assert'
import { afterEach, beforeEach, describe, it } from 'node:test'
import CodeMirror from 'codemirror'
import 'codemirror/mode/javascript/javascript'
import * as React from 'react'

import { DiffParser } from '../../../src/lib/diff-parser'
import { IdePreviousLines } from '../../../src/ui/changes/ide/ide-previous-lines'
import { IdeCodeEditor } from '../../../src/ui/changes/ide/ide-code-editor'
import {
  getLineChanges,
  NoLineChanges,
} from '../../../src/ui/changes/ide/ide-line-changes'
import { fireEvent, render } from '../../helpers/ui/render'

let container: HTMLDivElement
let editor: CodeMirror.Editor
let previews: IdePreviousLines
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

beforeEach(() => {
  // jsdom has no text layout; these tests exercise document and widget behavior.
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
  container = document.createElement('div')
  document.body.appendChild(container)
  editor = CodeMirror(container, {
    value: 'first\nchanged\nlast',
    lineNumbers: true,
    viewportMargin: Infinity,
  })
  previews = new IdePreviousLines(editor, container)
  previews.setBlocks([
    {
      line: 1,
      oldLineNumber: 2,
      lines: ['old first', 'old second'],
      inlineChanges: [],
    },
    { line: 3, oldLineNumber: 5, lines: ['deleted at EOF'], inlineChanges: [] },
  ])
})

afterEach(() => {
  previews.destroy()
  container.remove()
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

describe('Previous lines display', () => {
  it('emphasizes both sides of the extended condition in ghost and hover without editing the file', () => {
    const before = '      isSameSet(a.removedBefore, b.removedBefore))'
    const lines = [
      '      isSameSet(a.removedBefore, b.removedBefore) &&',
      '      a.inlineChanges.length === b.inlineChanges.length &&',
      '      a.previousLines.length === b.previousLines.length)',
    ]
    const diff = new DiffParser().parse(
      [
        'diff --git a/file.ts b/file.ts',
        '--- a/file.ts',
        '+++ b/file.ts',
        '@@ -103,1 +1,3 @@',
        `-${before}`,
        ...lines.map(line => `+${line}`),
        '',
      ].join('\n')
    )
    const ref = React.createRef<IdeCodeEditor>()
    const dirtyChanges = new Array<boolean>()
    const props: React.ComponentProps<typeof IdeCodeEditor> = {
      path: 'file.ts',
      text: lines.join('\n'),
      revision: 0,
      draft: null,
      tabSize: 2,
      highlight: false,
      readOnly: false,
      lineChanges: getLineChanges(diff.hunks),
      highlightChanges: true,
      unchangedTextOpacity: 0,
      previousLinesMode: 'ghost',
      onDirtyChange: dirty => dirtyChanges.push(dirty),
      onSave: () => {},
    }
    const view = render(React.createElement(IdeCodeEditor, { ...props, ref }))
    fireEvent.click(view.container.querySelector('.ide-previous-lines-toggle')!)
    const assertEmphasis = () => {
      assert.strictEqual(
        view.container.querySelector('.ide-inline-deletion')?.textContent,
        ')'
      )
      assert.strictEqual(
        view.container.querySelector('.ide-inline-change')?.textContent,
        ' &&'
      )
      assert.strictEqual(
        view.container.querySelector('.ide-previous-line code')?.textContent,
        before
      )
      assert.strictEqual(
        view.container.querySelector('.ide-previous-line-number')?.textContent,
        '103'
      )
      assert.strictEqual(ref.current?.getLines().join('\n'), props.text)
      assert.deepStrictEqual(dirtyChanges, [])
    }
    assertEmphasis()
    view.rerender(
      React.createElement(IdeCodeEditor, {
        ...props,
        ref,
        previousLinesMode: 'hover',
      })
    )
    fireEvent.mouseEnter(
      view.container.querySelector('.ide-previous-lines-marker')!
    )
    assertEmphasis()
  })

  it('splits removal emphasis across syntax tokens while preserving tabs, Unicode and literal HTML', () => {
    editor.setOption('mode', 'javascript')
    const before = '\treturn oldValue + "😀<tag>"'
    const start = before.indexOf('oldValue')
    previews.setBlocks([
      {
        line: 1,
        oldLineNumber: 2,
        lines: [before, 'deleted()'],
        inlineChanges: [{ line: 0, start, end: before.length }],
      },
    ])
    const generation = editor.getDoc().changeGeneration()
    for (const mode of ['ghost', 'hover'] as const) {
      previews.setMode(mode)
      if (mode === 'ghost') {
        fireEvent.click(container.querySelector('.ide-previous-lines-toggle')!)
      } else {
        fireEvent.mouseEnter(
          container.querySelector('.ide-previous-lines-marker')!
        )
      }
      const code = container.querySelector('.ide-previous-line code')!
      const marked = code.querySelectorAll('.ide-inline-deletion')
      assert.ok(marked.length > 1)
      assert.strictEqual(
        Array.from(marked, span => span.textContent).join(''),
        before.slice(start)
      )
      assert.ok(code.querySelector('.cm-string.ide-inline-deletion'))
      assert.strictEqual(code.textContent, before)
      assert.strictEqual(code.querySelector('tag'), null)
      assert.strictEqual(
        container
          .querySelectorAll('.ide-previous-line')[1]
          .querySelector('.ide-inline-deletion'),
        null
      )
    }
    assert.strictEqual(editor.getValue(), 'first\nchanged\nlast')
    assert.ok(editor.getDoc().isClean(generation))
    assert.deepStrictEqual(editor.historySize(), { undo: 0, redo: 0 })
  })

  it('keeps insertion emphasis when switching preview modes without changing the file', () => {
    const ref = React.createRef<IdeCodeEditor>()
    const dirtyChanges = new Array<boolean>()
    const props: React.ComponentProps<typeof IdeCodeEditor> = {
      path: 'file.ts',
      text: 'call(a, b)',
      revision: 0,
      draft: null,
      tabSize: 2,
      highlight: false,
      readOnly: false,
      lineChanges: {
        ...NoLineChanges,
        modified: new Set([0]),
        inlineChanges: [{ line: 0, start: 6, end: 9 }],
      },
      highlightChanges: true,
      unchangedTextOpacity: 0,
      previousLinesMode: 'ghost',
      onDirtyChange: dirty => dirtyChanges.push(dirty),
      onSave: () => {},
    }
    const view = render(React.createElement(IdeCodeEditor, { ...props, ref }))
    assert.strictEqual(
      view.container.querySelector('.ide-inline-change')?.textContent,
      ', b'
    )
    assert.strictEqual(
      view.container.querySelector('.ide-previous-lines-toggle'),
      null
    )
    view.rerender(
      React.createElement(IdeCodeEditor, {
        ...props,
        ref,
        previousLinesMode: 'hover',
      })
    )
    assert.strictEqual(
      view.container.querySelector('.ide-inline-change')?.textContent,
      ', b'
    )
    assert.strictEqual(ref.current?.getLines().join('\n'), props.text)
    assert.deepStrictEqual(dirtyChanges, [])
    view.rerender(
      React.createElement(IdeCodeEditor, {
        ...props,
        ref,
        lineChanges: NoLineChanges,
      })
    )
    assert.strictEqual(view.container.querySelector('.ide-inline-change'), null)
  })
  it('expands and collapses old code without changing document text or undo history', () => {
    const generation = editor.getDoc().changeGeneration()
    const button = container.querySelector('button')!
    fireEvent.click(button)
    assert.match(container.textContent ?? '', /old first/)
    assert.strictEqual(button.getAttribute('aria-expanded'), 'true')
    fireEvent.click(button)
    assert.doesNotMatch(container.textContent ?? '', /old first/)
    assert.strictEqual(editor.getValue(), 'first\nchanged\nlast')
    assert.ok(editor.getDoc().isClean(generation))
    assert.deepStrictEqual(editor.historySize(), { undo: 0, redo: 0 })
  })

  it('switches modes repeatedly without retaining widgets or popups', () => {
    for (let i = 0; i < 3; i++) {
      previews.setMode('hover')
      assert.strictEqual(editor.lineInfo(1).widgets?.length ?? 0, 0)
      const marker = container.querySelector('.ide-previous-lines-marker')!
      fireEvent.mouseEnter(marker)
      assert.ok(container.querySelector('[role="dialog"]'))
      previews.setMode('ghost')
      assert.strictEqual(container.querySelector('[role="dialog"]'), null)
      assert.strictEqual(editor.lineInfo(1).widgets?.length, 1)
      assert.strictEqual(editor.lineInfo(2).widgets?.length, 1)
    }
    assert.strictEqual(editor.getValue(), 'first\nchanged\nlast')
  })

  it('keeps previews with their anchor when lines are inserted before them', () => {
    editor.replaceRange('inserted\n', CodeMirror.Pos(0, 0))
    previews.setMode('hover')
    assert.ok(editor.lineInfo(2).gutterMarkers?.['ide-previous-lines-gutter'])
    previews.setMode('ghost')
    assert.strictEqual(editor.lineInfo(2).widgets?.length, 1)
    assert.strictEqual(editor.getValue(), 'inserted\nfirst\nchanged\nlast')
  })

  it('retains separate hover previews for deletions before and after the last line', () => {
    previews.setBlocks([
      { line: 2, oldLineNumber: 3, lines: ['before last'], inlineChanges: [] },
      { line: 3, oldLineNumber: 5, lines: ['after last'], inlineChanges: [] },
    ])
    previews.setMode('hover')
    const markers =
      editor.lineInfo(2).gutterMarkers?.['ide-previous-lines-gutter']
    assert.ok(markers)
    assert.strictEqual(markers.querySelectorAll('button').length, 2)
  })

  it('allows keyboard preview, pinning, and closing with Escape', () => {
    previews.setMode('hover')
    const marker = container.querySelector<HTMLButtonElement>(
      '.ide-previous-lines-marker'
    )!
    marker.focus()
    assert.ok(container.querySelector('[role="dialog"]'))
    fireEvent.click(marker)
    assert.ok(
      container.querySelector<HTMLButtonElement>('[role="dialog"] button')
        ?.disabled
    )
    fireEvent.keyDown(document.body, { key: 'Escape' })
    assert.strictEqual(container.querySelector('[role="dialog"]'), null)
    assert.strictEqual(document.activeElement, marker)
  })
})
