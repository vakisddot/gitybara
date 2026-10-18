import assert from 'node:assert'
import { afterEach, beforeEach, describe, it, TestContext } from 'node:test'
import { ipcRenderer } from 'electron'
import CodeMirror from 'codemirror'
import 'codemirror/mode/javascript/javascript'
import * as React from 'react'

import { DiffParser } from '../../../src/lib/diff-parser'
import { IMenuItem, ISerializableMenuItem } from '../../../src/lib/menu-item'
import { IdePreviousLines } from '../../../src/ui/changes/ide/ide-previous-lines'
import { IdeCodeEditor } from '../../../src/ui/changes/ide/ide-code-editor'
import {
  getLineChanges,
  NoLineChanges,
} from '../../../src/ui/changes/ide/ide-line-changes'
import { MockIPC } from '../../helpers/mock-ipc'
import { render, waitFor } from '../../helpers/ui/render'

let container: HTMLDivElement
let editor: CodeMirror.Editor
let previews: IdePreviousLines
const originalBounds = window.Range.prototype.getBoundingClientRect
const originalRects = window.Range.prototype.getClientRects
const originalRequestFrame = window.requestAnimationFrame
const originalCancelFrame = window.cancelAnimationFrame
const originalScrollbarStyle = CodeMirror.defaults.scrollbarStyle
const originalFocus = window.focus
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

function codePosition(element: Element, offset: number) {
  const walker = document.createTreeWalker(element, window.NodeFilter.SHOW_TEXT)
  let node = walker.nextNode()
  while (node && offset > (node.textContent?.length ?? 0)) {
    offset -= node.textContent?.length ?? 0
    node = walker.nextNode()
  }
  assert.ok(node)
  return { node, offset }
}

/** A native mouse selection, which jsdom cannot create by dragging. */
function selectCode(
  anchor: Element,
  anchorOffset: number,
  head: Element,
  headOffset: number,
  release = true
) {
  const down = new window.MouseEvent('mousedown', {
    bubbles: true,
    cancelable: true,
    button: 0,
  })
  anchor.dispatchEvent(down)
  assert.strictEqual(down.defaultPrevented, false)
  const selectStart = new window.Event('selectstart', {
    bubbles: true,
    cancelable: true,
  })
  anchor.dispatchEvent(selectStart)
  assert.strictEqual(selectStart.defaultPrevented, false)
  const from = codePosition(anchor, anchorOffset)
  const to = codePosition(head, headOffset)
  document
    .getSelection()
    ?.setBaseAndExtent(from.node, from.offset, to.node, to.offset)
  if (release) {
    document.dispatchEvent(new window.MouseEvent('mouseup', { bubbles: true }))
  }
}

function copySelection(type = 'copy') {
  const event = new window.Event(type, { bubbles: true, cancelable: true })
  const data = new Map<string, string>()
  Object.defineProperty(event, 'clipboardData', {
    value: {
      setData: (format: string, text: string) => data.set(format, text),
    },
  })
  document.dispatchEvent(event)
  return { prevented: event.defaultPrevented, text: data.get('text/plain') }
}

function renderSelectionEditor(
  showPreviousLines: boolean,
  additionalContextMenuItems: ReadonlyArray<IMenuItem> = []
) {
  const ref = React.createRef<IdeCodeEditor>()
  const dirtyChanges: boolean[] = []
  const view = render(
    React.createElement(IdeCodeEditor, {
      ref,
      path: 'file.txt',
      text: 'first\nchanged\nlast',
      revision: 0,
      draft: null,
      tabSize: 2,
      highlight: false,
      readOnly: false,
      lineChanges: {
        ...NoLineChanges,
        modified: new Set([1]),
        previousLines: [
          {
            line: 1,
            oldLineNumber: 2,
            lines: ['old first', 'old second'],
            inlineChanges: [],
          },
          {
            line: 3,
            oldLineNumber: 5,
            lines: ['deleted at EOF'],
            inlineChanges: [],
          },
        ],
      },
      unchangedTextOpacity: 55,
      showPreviousLines,
      collapsedRanges: [],
      additionalContextMenuItems,
      onDirtyChange: dirty => dirtyChanges.push(dirty),
      onSave: () => {},
    })
  )
  return { ...view, ref, dirtyChanges }
}

function captureContextMenus(
  t: TestContext,
  result: ReadonlyArray<number> | null = null
) {
  const menus: ReadonlyArray<ISerializableMenuItem>[] = []
  const ipc = new MockIPC()
  ipc.onInvoke('show-contextual-menu', async items => {
    menus.push(items)
    return result
  })
  t.mock.method(ipcRenderer, 'invoke', ipc.invoke.bind(ipc))
  return menus
}

function openContextMenu(code: Element) {
  code.dispatchEvent(
    new window.MouseEvent('mousedown', {
      button: 2,
      bubbles: true,
      cancelable: true,
    })
  )
  const event = new window.MouseEvent('contextmenu', {
    button: 2,
    bubbles: true,
    cancelable: true,
  })
  code.dispatchEvent(event)
  assert.ok(event.defaultPrevented)
}

beforeEach(() => {
  // jsdom has no text layout; these tests exercise document and widget behavior.
  window.Range.prototype.getBoundingClientRect = () => new window.DOMRect()
  window.Range.prototype.getClientRects = () => [] as unknown as DOMRectList
  window.requestAnimationFrame = callback =>
    window.setTimeout(() => callback(0), 0)
  window.cancelAnimationFrame = id => window.clearTimeout(id)
  CodeMirror.defaults.scrollbarStyle = 'null'
  window.focus = () => {}
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
  window.focus = originalFocus
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
  it('preserves mixed selection on right-click and offers the native text menu and viewer actions', async t => {
    const menus = captureContextMenus(t, [3])
    const expanded = t.mock.fn()
    const view = renderSelectionEditor(true, [
      { type: 'separator' },
      { label: 'Expand whole file', action: expanded },
    ])
    const current = view.container.querySelector(
      '.CodeMirror-code pre.CodeMirror-line'
    )!
    const old = view.container.querySelector(
      '.CodeMirror-code .ide-previous-line code'
    )!
    selectCode(current, 2, old, 5)
    openContextMenu(current)
    assert.strictEqual(copySelection().text, 'rst\nold f')
    assert.strictEqual(menus[0][0].label, 'Copy')
    assert.strictEqual(menus[0][0].role, 'copy')
    assert.strictEqual(menus[0][0].enabled, true)
    assert.strictEqual(
      menus[0][1].label,
      __DARWIN__ ? 'Select All' : 'Select all'
    )
    await waitFor(() => assert.strictEqual(expanded.mock.callCount(), 1))
  })

  it('selects and copies both versions through the context menu without editing the file', async t => {
    const menus = captureContextMenus(t, [1])
    const view = renderSelectionEditor(true)
    openContextMenu(
      view.container.querySelector('.CodeMirror-code pre.CodeMirror-line')!
    )
    assert.strictEqual(menus[0][0].enabled, false)
    assert.strictEqual(menus[0][0].role, undefined)
    await waitFor(() =>
      assert.strictEqual(
        copySelection().text,
        'first\nold first\nold second\nchanged\nlast\ndeleted at EOF'
      )
    )
    assert.strictEqual(
      view.ref.current?.getLines().join('\n'),
      'first\nchanged\nlast'
    )
    assert.deepStrictEqual(view.dirtyChanges, [])
  })

  it('supports keyboard and app-menu select all with previous code shown or hidden', () => {
    const view = renderSelectionEditor(true)
    const wrapper = view.container.querySelector('.CodeMirror')!
    wrapper.dispatchEvent(
      new window.KeyboardEvent('keydown', {
        key: 'a',
        ctrlKey: !__DARWIN__,
        metaKey: __DARWIN__,
        bubbles: true,
        cancelable: true,
      })
    )
    assert.strictEqual(
      copySelection().text,
      'first\nold first\nold second\nchanged\nlast\ndeleted at EOF'
    )
    view.unmount()
    const currentOnly = renderSelectionEditor(false)
    const selectAll = new window.Event('select-all', {
      bubbles: true,
      cancelable: true,
    })
    currentOnly.container.querySelector('.CodeMirror')!.dispatchEvent(selectAll)
    assert.ok(selectAll.defaultPrevented)
    assert.strictEqual(
      currentOnly.container.querySelector('textarea')?.value,
      'first\nchanged\nlast'
    )
    assert.ok(currentOnly.container.querySelector('.CodeMirror-selectedtext'))
    assert.strictEqual(
      currentOnly.container.querySelector('.ide-selecting-diff'),
      null
    )
  })

  it('focuses the editor input for native Copy on a current-only selection', t => {
    const menus = captureContextMenus(t)
    const view = renderSelectionEditor(false)
    const wrapper = view.container.querySelector<HTMLElement>('.CodeMirror')!
    wrapper.dispatchEvent(
      new window.Event('select-all', { bubbles: true, cancelable: true })
    )
    // Right-clicking rendered code can move focus off the hidden text input.
    wrapper.focus()
    assert.strictEqual(document.activeElement, wrapper)
    openContextMenu(
      view.container.querySelector('.CodeMirror-code pre.CodeMirror-line')!
    )
    const input = view.container.querySelector('textarea')!
    assert.strictEqual(document.activeElement, input)
    assert.strictEqual(input.value, 'first\nchanged\nlast')
    assert.strictEqual(menus[0][0].enabled, true)
    assert.strictEqual(menus[0][0].role, 'copy')
  })

  it('selects previous blocks before the first and after the last document line', () => {
    previews.setBlocks([
      { line: 0, oldLineNumber: 1, lines: ['old start'], inlineChanges: [] },
      { line: 3, oldLineNumber: 5, lines: ['old end', ''], inlineChanges: [] },
    ])
    previews.setShown(true)
    assert.ok(previews.selectAll())
    assert.strictEqual(
      copySelection().text,
      'old start\nfirst\nchanged\nlast\nold end\n'
    )
  })

  for (const reverse of [false, true]) {
    it(`selects and copies current and previous code ${
      reverse ? 'upwards' : 'downwards'
    }`, () => {
      previews.setShown(true)
      const current = container.querySelectorAll('pre.CodeMirror-line')
      const old = container.querySelectorAll('.ide-previous-line code')
      const generation = editor.getDoc().changeGeneration()

      if (reverse) {
        selectCode(old[0], 5, current[0], 2)
      } else {
        selectCode(current[0], 2, old[0], 5)
      }
      assert.deepStrictEqual(copySelection(), {
        prevented: true,
        text: 'rst\nold f',
      })

      if (reverse) {
        selectCode(current[1], 4, old[0], 4)
      } else {
        selectCode(old[0], 4, current[1], 4)
      }
      assert.deepStrictEqual(copySelection(), {
        prevented: true,
        text: 'first\nold second\nchan',
      })
      assert.strictEqual(editor.getValue(), 'first\nchanged\nlast')
      assert.ok(editor.getDoc().isClean(generation))
      assert.deepStrictEqual(editor.historySize(), { undo: 0, redo: 0 })
    })
  }

  it('copies old blocks between current endpoints and at the end of the file', () => {
    previews.setShown(true)
    const current = container.querySelectorAll('pre.CodeMirror-line')
    const old = container.querySelectorAll('.ide-previous-line code')
    selectCode(current[0], 3, current[2], 2)
    assert.strictEqual(
      copySelection().text,
      'st\nold first\nold second\nchanged\nla'
    )
    selectCode(current[2], 2, old[2], 7)
    assert.strictEqual(copySelection().text, 'st\ndeleted')
    selectCode(old[2], 7, current[2], 2)
    assert.strictEqual(copySelection().text, 'st\ndeleted')
  })

  it('copies previous code alone without gutter numbers or deleting current code on cut', () => {
    previews.setShown(true)
    const old = container.querySelectorAll('.ide-previous-line code')
    selectCode(old[0], 4, old[1], 6)
    assert.strictEqual(copySelection('cut').text, 'first\nold se')
    assert.strictEqual(editor.getValue(), 'first\nchanged\nlast')
  })

  it('returns current-only selections and clicks to the editor for editing', () => {
    previews.setShown(true)
    const current = container.querySelectorAll(
      '.CodeMirror-code pre.CodeMirror-line'
    )
    selectCode(current[1], 1, current[2], 2)
    assert.strictEqual(editor.getSelection(), 'hanged\nla')
    assert.strictEqual(copySelection().prevented, false)
    assert.strictEqual(container.querySelector('.ide-selecting-diff'), null)
    editor.replaceSelection('replacement')
    assert.strictEqual(editor.getValue(), 'first\ncreplacementst')
    selectCode(current[0], 2, current[0], 2)
    assert.deepStrictEqual(editor.getCursor(), { line: 0, ch: 2 })
  })

  it('copies the complete mixed range when scrolling removes its native anchor', () => {
    previews.setShown(true)
    const old = container.querySelector(
      '.CodeMirror-code .ide-previous-line code'
    )!
    const last = container.querySelectorAll(
      '.CodeMirror-code pre.CodeMirror-line'
    )[2]
    let caret = document.createRange()
    const oldPoint = codePosition(old, 4)
    caret.setStart(oldPoint.node, oldPoint.offset)
    caret.collapse(true)
    Object.defineProperty(document, 'caretRangeFromPoint', {
      configurable: true,
      value: () => caret,
    })
    try {
      selectCode(old, 4, last, 2, false)
      // CodeMirror removes offscreen rows while keeping the document handles.
      old.replaceWith(old.cloneNode(true))
      caret = document.createRange()
      const lastPoint = codePosition(last, 2)
      caret.setStart(lastPoint.node, lastPoint.offset)
      caret.collapse(true)
      document.dispatchEvent(
        new window.MouseEvent('mousemove', { bubbles: true })
      )
      document.dispatchEvent(
        new window.MouseEvent('mouseup', { bubbles: true })
      )
      assert.strictEqual(copySelection().text, 'first\nold second\nchanged\nla')
      assert.strictEqual(editor.getValue(), 'first\nchanged\nlast')
    } finally {
      Reflect.deleteProperty(document, 'caretRangeFromPoint')
    }
  })

  it('preserves tabs, blank lines and Unicode when copying both versions', () => {
    editor.setValue('first\n\tnew 😀<tag>\nlast')
    previews.setBlocks([
      {
        line: 1,
        oldLineNumber: 2,
        lines: ['\told 😀<tag>', ''],
        inlineChanges: [],
      },
    ])
    previews.setShown(true)
    const current = container.querySelectorAll('pre.CodeMirror-line')
    const old = container.querySelectorAll('.ide-previous-line code')
    selectCode(old[0], 0, current[1], current[1].textContent?.length ?? 0)
    assert.strictEqual(copySelection().text, '\told 😀<tag>\n\n\tnew 😀<tag>')
  })

  it('clears mixed selection and stops intercepting copy when old code is hidden', () => {
    previews.setShown(true)
    selectCode(
      container.querySelector('pre.CodeMirror-line')!,
      2,
      container.querySelector('.ide-previous-line code')!,
      5
    )
    previews.setShown(false)
    assert.ok(document.getSelection()?.isCollapsed)
    assert.strictEqual(copySelection().prevented, false)
    assert.strictEqual(container.querySelector('.ide-selecting-diff'), null)
    assert.strictEqual(
      container.querySelector('.ide-diff-selection-enabled'),
      null
    )
  })

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
