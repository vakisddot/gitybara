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
import { render } from '../../helpers/ui/render'

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

/** The count in the gutter of the line, if it has one. */
const countAt = (line: number) =>
  editor.lineInfo(line).gutterMarkers?.['ide-previous-lines-gutter']
    ?.textContent ?? null

const widgetsAt = (line: number) => editor.lineInfo(line).widgets?.length ?? 0

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
  previews = new IdePreviousLines(editor)
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
  previews.clear()
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
  it('emphasizes both sides of the extended condition without editing the file', () => {
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
      showPreviousLines: true,
      collapsedRanges: [],
      onDirtyChange: dirty => dirtyChanges.push(dirty),
      onSave: () => {},
    }
    const view = render(React.createElement(IdeCodeEditor, { ...props, ref }))
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
    previews.setShown(true)

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
    assert.strictEqual(editor.getValue(), 'first\nchanged\nlast')
    assert.ok(editor.getDoc().isClean(generation))
    assert.deepStrictEqual(editor.historySize(), { undo: 0, redo: 0 })
  })

  it('keeps insertion emphasis when previous lines are shown or hidden without changing the file', () => {
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
      showPreviousLines: false,
      collapsedRanges: [],
      onDirtyChange: dirty => dirtyChanges.push(dirty),
      onSave: () => {},
    }
    const view = render(React.createElement(IdeCodeEditor, { ...props, ref }))
    assert.strictEqual(
      view.container.querySelector('.ide-inline-change')?.textContent,
      ', b'
    )
    assert.strictEqual(
      view.container.querySelector('.ide-previous-lines-count'),
      null
    )
    view.rerender(
      React.createElement(IdeCodeEditor, {
        ...props,
        ref,
        showPreviousLines: true,
      })
    )
    assert.strictEqual(
      view.container.querySelector('.ide-inline-change')?.textContent,
      ', b'
    )
    assert.strictEqual(
      view.container.querySelector('.ide-previous-lines-block'),
      null
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

  it('counts the hidden lines in the gutter where they were', () => {
    assert.strictEqual(countAt(0), null)
    assert.strictEqual(countAt(1), '−2')
    assert.strictEqual(countAt(2), '−1')
    assert.strictEqual(widgetsAt(1), 0)
    assert.strictEqual(widgetsAt(2), 0)
  })

  it('shows and hides old code without changing document text or undo history', () => {
    const generation = editor.getDoc().changeGeneration()
    previews.setShown(true)
    assert.match(container.textContent ?? '', /old first/)
    assert.match(container.textContent ?? '', /deleted at EOF/)
    previews.setShown(false)
    assert.doesNotMatch(container.textContent ?? '', /old first/)
    assert.strictEqual(editor.getValue(), 'first\nchanged\nlast')
    assert.ok(editor.getDoc().isClean(generation))
    assert.deepStrictEqual(editor.historySize(), { undo: 0, redo: 0 })
  })

  it('switches repeatedly without retaining widgets or counts', () => {
    for (let i = 0; i < 3; i++) {
      previews.setShown(true)
      assert.strictEqual(widgetsAt(1), 1)
      assert.strictEqual(widgetsAt(2), 1)
      assert.strictEqual(countAt(1), null)
      assert.strictEqual(countAt(2), null)
      previews.setShown(false)
      assert.strictEqual(widgetsAt(1), 0)
      assert.strictEqual(widgetsAt(2), 0)
      assert.strictEqual(countAt(1), '−2')
    }
    assert.strictEqual(editor.getValue(), 'first\nchanged\nlast')
  })

  it('keeps the gutter while the lines are shown, so the text stays put', () => {
    const gutters = () => editor.getOption('gutters') ?? []
    assert.ok(gutters().includes('ide-previous-lines-gutter'))
    previews.setShown(true)
    assert.ok(gutters().includes('ide-previous-lines-gutter'))
    previews.setBlocks([])
    assert.ok(!gutters().includes('ide-previous-lines-gutter'))
  })

  it('keeps previews with their anchor when lines are inserted before them', () => {
    editor.replaceRange('inserted\n', CodeMirror.Pos(0, 0))
    assert.strictEqual(countAt(2), '−2')
    previews.setShown(true)
    assert.strictEqual(widgetsAt(2), 1)
    assert.strictEqual(editor.getValue(), 'inserted\nfirst\nchanged\nlast')
  })

  describe('with motion', () => {
    const blockAt = (line: number) =>
      editor.lineInfo(line).widgets?.[0]?.node as HTMLElement | undefined
    const wait = (ms: number) => new Promise(r => setTimeout(r, ms))
    let reduceMotion = false

    beforeEach(() => {
      reduceMotion = false
      window.matchMedia = () => ({ matches: reduceMotion } as MediaQueryList)
    })

    afterEach(() => {
      delete (window as Partial<Window>).matchMedia
    })

    it('grows the old lines open from nothing', async () => {
      previews.setShown(true)
      assert.strictEqual(blockAt(1)?.style.height, '0px')

      await wait(450)
      assert.strictEqual(widgetsAt(1), 1)
      assert.strictEqual(blockAt(1)?.style.height, '')
      assert.strictEqual(blockAt(1)?.style.overflow, '')
    })

    it('shrinks the old lines closed before they go', async () => {
      previews.setShown(true)
      await wait(450)

      previews.setShown(false)
      assert.strictEqual(widgetsAt(1), 1)
      assert.strictEqual(blockAt(1)?.style.height, '20px')
      assert.strictEqual(countAt(1), null)

      await wait(450)
      assert.strictEqual(widgetsAt(1), 0)
      assert.strictEqual(countAt(1), '−2')
    })

    it('turns around when they are shown again while they close', async () => {
      previews.setShown(true)
      await wait(450)
      previews.setShown(false)
      await wait(50)
      previews.setShown(true)

      await wait(450)
      assert.strictEqual(widgetsAt(1), 1)
      assert.strictEqual(blockAt(1)?.style.height, '')
      assert.strictEqual(countAt(1), null)
    })

    it('stops when the file changes while they open', async () => {
      previews.setShown(true)
      previews.setBlocks([])
      await wait(450)
      assert.strictEqual(widgetsAt(1), 0)
      assert.strictEqual(editor.getValue(), 'first\nchanged\nlast')
    })

    it('hides them at once when the system asks for less motion', () => {
      reduceMotion = true
      previews.setShown(true)
      previews.setShown(false)
      assert.strictEqual(widgetsAt(1), 0)
      assert.strictEqual(countAt(1), '−2')
    })
  })

  it('counts deletions before and after the last line together', () => {
    previews.setBlocks([
      { line: 2, oldLineNumber: 3, lines: ['before last'], inlineChanges: [] },
      { line: 3, oldLineNumber: 5, lines: ['after last'], inlineChanges: [] },
    ])
    assert.strictEqual(countAt(2), '−2')
    previews.setShown(true)
    assert.strictEqual(widgetsAt(2), 2)
  })
})
