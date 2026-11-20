import assert from 'node:assert'
import { afterEach, beforeEach, describe, it, TestContext } from 'node:test'
import { ipcRenderer } from 'electron'
import CodeMirror from 'codemirror'
import * as React from 'react'

import { ISerializableMenuItem } from '../../../src/lib/menu-item'
import { IdeCodeEditor } from '../../../src/ui/changes/ide/ide-code-editor'
import {
  ILineChanges,
  NoLineChanges,
} from '../../../src/ui/changes/ide/ide-line-changes'
import {
  IIdeEditorReview,
  IReviewTarget,
} from '../../../src/ui/changes/ide/ide-review-comments'
import { IReviewComment } from '../../../src/models/review-comment'
import { MockIPC } from '../../helpers/mock-ipc'
import { fireEvent, render } from '../../helpers/ui/render'

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

const text = 'first\nsecond\nthird'

const oldLines: ILineChanges = {
  ...NoLineChanges,
  modified: new Set([1]),
  previousLines: [
    {
      line: 1,
      oldLineNumber: 2,
      lines: ['old first', 'old second'],
      inlineChanges: [],
    },
  ],
}

const comment = (fields: Partial<IReviewComment>): IReviewComment => ({
  id: 'comment-1',
  path: 'file.txt',
  side: 'new',
  line: 3,
  lineText: 'third',
  body: 'Fix this',
  commitSha: null,
  ...fields,
})

interface IReviewCalls {
  readonly added: Array<{ target: IReviewTarget; body: string }>
  readonly removed: string[]
}

function makeReview(
  comments: ReadonlyArray<IReviewComment>,
  calls: IReviewCalls
): IIdeEditorReview {
  return {
    comments,
    onAdd: (target, body) => calls.added.push({ target, body }),
    onUpdate: () => {},
    onRemove: id => calls.removed.push(id),
  }
}

function editorProps(
  review: IIdeEditorReview | undefined,
  overrides: Partial<React.ComponentProps<typeof IdeCodeEditor>> = {}
): React.ComponentProps<typeof IdeCodeEditor> {
  return {
    path: 'file.txt',
    text,
    revision: 0,
    draft: null,
    tabSize: 2,
    highlight: false,
    readOnly: true,
    lineChanges: NoLineChanges,
    unchangedTextOpacity: 55,
    showPreviousLines: false,
    collapsedRanges: [],
    onDirtyChange: () => {},
    onSave: () => {},
    review,
    ...overrides,
  }
}

function getCodeMirror(container: HTMLElement): CodeMirror.Editor {
  const wrapper = container.querySelector('.CodeMirror')
  assert.ok(wrapper)
  return (wrapper as unknown as { CodeMirror: CodeMirror.Editor }).CodeMirror
}

const widgetClassesAt = (cm: CodeMirror.Editor, line: number) =>
  (cm.lineInfo(line).widgets ?? []).map(
    (widget: { node: HTMLElement }) => widget.node.className
  )

function captureContextMenus(t: TestContext) {
  const menus: ReadonlyArray<ISerializableMenuItem>[] = []
  const ipc = new MockIPC()
  ipc.onInvoke('show-contextual-menu', async items => {
    menus.push(items)
    return null
  })
  t.mock.method(ipcRenderer, 'invoke', ipc.invoke.bind(ipc))
  return menus
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
})

afterEach(() => {
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

describe('Review comments in the IDE view', () => {
  it('writes a comment on a line from the gutter', () => {
    const calls: IReviewCalls = { added: [], removed: [] }
    const view = render(
      React.createElement(IdeCodeEditor, editorProps(makeReview([], calls)))
    )
    const cm = getCodeMirror(view.container)

    CodeMirror.signal(cm, 'gutterClick', cm, 1, 'ide-comment-gutter')
    const box = view.container.querySelector<HTMLTextAreaElement>(
      '.ide-review-widget textarea'
    )
    assert.ok(box)
    assert.deepStrictEqual(widgetClassesAt(cm, 1), ['ide-review-widget'])
    assert.equal(box.getAttribute('aria-label'), 'Comment on line 2 for Claude')

    // Typing in it isn't taken as selecting the code
    const selectAll = new window.KeyboardEvent('keydown', {
      key: 'a',
      ctrlKey: !__DARWIN__,
      metaKey: __DARWIN__,
      bubbles: true,
      cancelable: true,
    })
    box.dispatchEvent(selectAll)
    assert.equal(selectAll.defaultPrevented, false)

    fireEvent.change(box, { target: { value: '  Rename this  ' } })
    fireEvent.keyDown(box, {
      key: 'Enter',
      ctrlKey: !__DARWIN__,
      metaKey: __DARWIN__,
    })

    assert.deepStrictEqual(calls.added, [
      {
        target: { side: 'new', line: 2, lineText: 'second' },
        body: 'Rename this',
      },
    ])
    assert.equal(view.container.querySelector('.ide-review-widget'), null)
  })

  it('shows the comments under their lines and keeps them when the text is put back', () => {
    const calls: IReviewCalls = { added: [], removed: [] }
    const review = makeReview([comment({})], calls)
    const view = render(React.createElement(IdeCodeEditor, editorProps(review)))
    const cm = getCodeMirror(view.container)

    const body = () =>
      view.container.querySelector('.ide-review-comment-body')?.textContent
    assert.equal(body(), 'Fix this')
    assert.deepStrictEqual(widgetClassesAt(cm, 2), ['ide-review-widget'])

    view.rerender(
      React.createElement(IdeCodeEditor, editorProps(review, { revision: 1 }))
    )
    assert.equal(body(), 'Fix this')
    assert.deepStrictEqual(widgetClassesAt(cm, 2), ['ide-review-widget'])

    const remove = view.container.querySelector<HTMLButtonElement>(
      '.ide-review-comment-button[aria-label="Delete the comment"]'
    )
    assert.ok(remove)
    fireEvent.click(remove)
    assert.deepStrictEqual(calls.removed, ['comment-1'])

    view.rerender(
      React.createElement(
        IdeCodeEditor,
        editorProps(makeReview([], calls), { revision: 1 })
      )
    )
    assert.equal(body(), undefined)
    assert.deepStrictEqual(widgetClassesAt(cm, 2), [])
  })

  it('comments on an old line below the old lines', () => {
    const calls: IReviewCalls = { added: [], removed: [] }
    const view = render(
      React.createElement(
        IdeCodeEditor,
        editorProps(makeReview([], calls), {
          lineChanges: oldLines,
          showPreviousLines: true,
        })
      )
    )
    const cm = getCodeMirror(view.container)

    const buttons = view.container.querySelectorAll<HTMLButtonElement>(
      '.ide-previous-line-comment'
    )
    assert.equal(buttons.length, 2)
    fireEvent.click(buttons[1])

    assert.deepStrictEqual(widgetClassesAt(cm, 1), [
      'ide-previous-lines-block',
      'ide-review-widget',
    ])
    const box = view.container.querySelector('.ide-review-widget textarea')
    assert.equal(
      box?.getAttribute('aria-label'),
      'Comment on old line 3 for Claude'
    )

    fireEvent.change(box!, { target: { value: 'Keep this' } })
    fireEvent.click(
      Array.from(view.container.querySelectorAll('.ide-review-widget button'))
        .filter(button => button.textContent === 'Add comment')
        .at(0)!
    )
    assert.deepStrictEqual(calls.added, [
      {
        target: { side: 'old', line: 3, lineText: 'old second' },
        body: 'Keep this',
      },
    ])
  })

  it('offers to comment on the line that was right-clicked', t => {
    const menus = captureContextMenus(t)
    const view = render(
      React.createElement(
        IdeCodeEditor,
        editorProps(makeReview([], { added: [], removed: [] }))
      )
    )
    const line = view.container.querySelector(
      '.CodeMirror-code pre.CodeMirror-line'
    )
    assert.ok(line)
    line.dispatchEvent(
      new window.MouseEvent('contextmenu', {
        button: 2,
        bubbles: true,
        cancelable: true,
      })
    )

    // jsdom has no layout, so which line is under the pointer isn't known
    assert.equal(menus.length, 1)
    assert.ok(
      menus[0].some(
        item =>
          item.label !== undefined &&
          /^Comment on line \d+ for Claude…$/.test(item.label)
      ),
      JSON.stringify(menus[0].map(item => item.label))
    )
  })

  it('has no comments where lines can not be commented on', t => {
    const menus = captureContextMenus(t)
    const view = render(
      React.createElement(IdeCodeEditor, editorProps(undefined))
    )

    assert.equal(view.container.querySelector('.ide-comment-gutter'), null)
    view.container
      .querySelector('.CodeMirror-code pre.CodeMirror-line')
      ?.dispatchEvent(
        new window.MouseEvent('contextmenu', {
          button: 2,
          bubbles: true,
          cancelable: true,
        })
      )
    assert.ok(
      !menus[0].some(item => item.label?.includes('for Claude') === true)
    )
  })
})
