import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, it, mock } from 'node:test'
import * as React from 'react'
import { writeFile } from 'fs/promises'
import { join } from 'path'
import CodeMirror from 'codemirror'
import { ipcRenderer } from 'electron'
import {
  ICSharpHighlightResult,
  ICSharpLocation,
} from '../../../src/lib/csharp/types'
import { IdeCodeEditor } from '../../../src/ui/changes/ide/ide-code-editor'
import { IdeFileViewer } from '../../../src/ui/changes/ide/ide-file-viewer'
import { NoLineChanges } from '../../../src/ui/changes/ide/ide-line-changes'
import { Repository } from '../../../src/models/repository'
import { MockIPC } from '../../helpers/mock-ipc'
import { createTempDirectory } from '../../helpers/temp'
import { render, waitFor, fireEvent } from '../../helpers/ui/render'

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

const text = 'class Cloud {\n  void Draw() {}\n}'
const props: React.ComponentProps<typeof IdeCodeEditor> = {
  path: 'Cloud.cs',
  text,
  revision: 0,
  draft: null,
  tabSize: 2,
  highlight: true,
  readOnly: false,
  lineChanges: NoLineChanges,
  highlightChanges: false,
  unchangedTextOpacity: 100,
  showPreviousLines: false,
  collapsedRanges: [],
  repositoryPath: 'D:/source',
  onDirtyChange: () => {},
  onSave: () => {},
}
const highlighted: ICSharpHighlightResult = {
  error: null,
  tokens: [{ line: 0, start: 6, length: 5, type: 'class' }],
}

beforeEach(() => {
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
  Object.assign(ipcRenderer, { send: mock.fn(), removeListener: mock.fn() })
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
  mock.restoreAll()
})

describe('C# editor integration', () => {
  it('restores source locations with native back/forward and clears forward history after a new jump', async t => {
    const ipc = new MockIPC()
    mock.method(window, 'focus', () => {})
    mock.method(
      ipcRenderer,
      'on',
      (...args: Parameters<Electron.IpcRenderer['on']>) => {
        const [channel, listener] = args
        ipc.on(channel, listener)
        return ipcRenderer
      }
    )
    const removeListener = mock.method(
      ipcRenderer,
      'removeListener',
      (...args: Parameters<Electron.IpcRenderer['removeListener']>) => {
        const [channel, listener] = args
        ipc.removeListener(channel, listener)
        return ipcRenderer
      }
    )
    let target: ICSharpLocation = {
      path: 'Base.cs',
      position: { line: 1, character: 7 },
    }
    mock.method(ipcRenderer, 'invoke', async (channel: string) =>
      channel === 'csharp-navigate'
        ? { error: null, locations: [target] }
        : highlighted
    )
    const directory = await createTempDirectory(t)
    await Promise.all(
      ['Cloud.cs', 'Base.cs', 'Other.cs'].map(path =>
        writeFile(join(directory, path), text)
      )
    )
    const repository = new Repository(directory, 1, null, false)
    const changedFiles: React.ComponentProps<
      typeof IdeFileViewer
    >['changedFiles'] = []
    function Viewer() {
      const [path, setPath] = React.useState('Cloud.cs')
      return (
        <div data-path={path}>
          <IdeFileViewer
            repository={repository}
            path={path}
            changedFiles={changedFiles}
            tabSize={2}
            onSelectedPathChanged={setPath}
          />
        </div>
      )
    }
    const view = render(<Viewer />)
    const editor = () => {
      const wrapper = view.container.querySelector('.CodeMirror') as
        | (HTMLElement & { CodeMirror: CodeMirror.Editor })
        | null
      assert.ok(wrapper)
      return wrapper.CodeMirror
    }
    const at = async (path: string, position: CodeMirror.Position) =>
      waitFor(() => {
        assert.equal(
          view.container
            .querySelector('[data-path]')
            ?.getAttribute('data-path'),
          path
        )
        assert.deepEqual(editor().getCursor(), position)
      })
    const press = (key: string, keyCode: number, altKey = false) => {
      const input = view.container.querySelector('textarea')
      assert.ok(input)
      fireEvent.keyDown(input, { key, keyCode, altKey })
    }
    await waitFor(() => assert.ok(view.container.querySelector('.CodeMirror')))
    editor().setCursor({ line: 0, ch: 6 })
    press('F12', 123)
    await at('Base.cs', CodeMirror.Pos(1, 7))
    // Forward returns to the caret as it was when Back was pressed.
    editor().setCursor({ line: 1, ch: 12 })
    ipc.emit('navigate-source', 'back')
    await at('Cloud.cs', CodeMirror.Pos(0, 6))
    ipc.emit('navigate-source', 'forward')
    await at('Base.cs', CodeMirror.Pos(1, 12))
    press('ArrowLeft', 37, true)
    await at('Cloud.cs', CodeMirror.Pos(0, 6))
    press('ArrowRight', 39, true)
    await at('Base.cs', CodeMirror.Pos(1, 12))
    ipc.emit('navigate-source', 'back')
    await at('Cloud.cs', CodeMirror.Pos(0, 6))
    target = { path: 'Other.cs', position: { line: 1, character: 4 } }
    press('F12', 123)
    await at('Other.cs', CodeMirror.Pos(1, 4))
    assert.equal(
      view
        .getByRole('button', { name: 'Go forward', exact: true })
        .getAttribute('aria-disabled'),
      'true'
    )
    ipc.emit('navigate-source', 'forward')
    await at('Other.cs', CodeMirror.Pos(1, 4))
    view.unmount()
    assert.ok(
      removeListener.mock.calls.some(
        call => call.arguments[0] === 'navigate-source'
      )
    )
  })

  it('applies semantic marks without changing text, dirty state, or undo history', async () => {
    const invoke = mock.method(ipcRenderer, 'invoke', async () => highlighted)
    const dirty = mock.fn()
    const ref = React.createRef<IdeCodeEditor>()
    const view = render(
      <IdeCodeEditor {...props} ref={ref} onDirtyChange={dirty} />
    )
    await waitFor(() =>
      assert.equal(
        view.container.querySelector('.ide-csharp-type')?.textContent,
        'Cloud'
      )
    )
    assert.equal(ref.current?.getLines().join('\n'), text)
    assert.equal(dirty.mock.callCount(), 0)
    const wrapper = view.container.querySelector(
      '.CodeMirror'
    ) as HTMLElement & { CodeMirror: CodeMirror.Editor }
    assert.deepEqual(wrapper.CodeMirror.historySize(), { undo: 0, redo: 0 })
    assert.equal(invoke.mock.calls[0].arguments[0], 'csharp-highlight')
    view.unmount()
  })

  it('ignores a response for older text and refreshes the new document', async () => {
    let complete: (value: ICSharpHighlightResult) => void = () => {}
    const oldResponse = new Promise<ICSharpHighlightResult>(resolve => {
      complete = resolve
    })
    const invoke = mock.method(ipcRenderer, 'invoke', async () =>
      invoke.mock.callCount() === 1
        ? oldResponse
        : {
            error: null,
            tokens: [{ line: 0, start: 6, length: 4, type: 'class' }],
          }
    )
    const view = render(<IdeCodeEditor {...props} />)
    await waitFor(() => assert.equal(invoke.mock.callCount(), 1))
    view.rerender(
      <IdeCodeEditor {...props} text="class Rain {}" revision={1} />
    )
    complete(highlighted)
    await waitFor(() =>
      assert.equal(
        view.container.querySelector('.ide-csharp-type')?.textContent,
        'Rain'
      )
    )
    assert.ok(invoke.mock.callCount() >= 2)
    view.unmount()
  })

  it('uses F12 for definitions and Shift+F12 for a references list', async () => {
    const target: ICSharpLocation = {
      path: 'Base.cs',
      position: { line: 8, character: 4 },
    }
    const onNavigate = mock.fn()
    const onResults = mock.fn()
    const invoke = mock.method(ipcRenderer, 'invoke', async (channel: string) =>
      channel === 'csharp-navigate'
        ? { error: null, locations: [target] }
        : highlighted
    )
    const view = render(
      <IdeCodeEditor
        {...props}
        onNavigate={onNavigate}
        onNavigationResults={onResults}
      />
    )
    const input = view.container.querySelector('textarea')
    assert.ok(input)
    fireEvent.keyDown(input, { key: 'F12', keyCode: 123 })
    await waitFor(() => assert.equal(onNavigate.mock.callCount(), 1))
    assert.deepEqual(onNavigate.mock.calls[0].arguments[0], target)
    fireEvent.keyDown(input, { key: 'F12', keyCode: 123, shiftKey: true })
    await waitFor(() => assert.equal(onResults.mock.callCount(), 1))
    assert.equal(onResults.mock.calls[0].arguments[2], true)
    const navigationCalls = invoke.mock.calls.filter(
      call => call.arguments[0] === 'csharp-navigate'
    )
    assert.equal(navigationCalls[0].arguments[3], false)
    assert.equal(navigationCalls[1].arguments[3], true)
    view.unmount()
  })

  it('shows the words as links only while Ctrl is held', async () => {
    mock.method(ipcRenderer, 'invoke', async () => highlighted)
    const view = render(<IdeCodeEditor {...props} />)
    const wrapper = view.container.querySelector('.CodeMirror')
    assert.ok(wrapper)
    const isNavigable = () => wrapper.classList.contains('ide-csharp-navigable')

    fireEvent.keyDown(window, { key: 'Control', ctrlKey: true })
    assert.ok(isNavigable())
    fireEvent.keyUp(window, { key: 'Control', ctrlKey: false })
    assert.ok(!isNavigable())

    // Ctrl pressed in another window is seen when the mouse moves
    fireEvent.mouseMove(wrapper, { ctrlKey: true })
    assert.ok(isNavigable())
    fireEvent.blur(window)
    assert.ok(!isNavigable())
    view.unmount()
  })

  it('does not apply a pending response after highlighting is disabled', async () => {
    let complete: (value: ICSharpHighlightResult) => void = () => {}
    const pending = new Promise<ICSharpHighlightResult>(resolve => {
      complete = resolve
    })
    const invoke = mock.method(ipcRenderer, 'invoke', async () => pending)
    const view = render(<IdeCodeEditor {...props} />)
    await waitFor(() => assert.equal(invoke.mock.callCount(), 1))
    view.rerender(<IdeCodeEditor {...props} highlight={false} />)
    complete(highlighted)
    await new Promise<void>(resolve => setImmediate(resolve))
    assert.equal(view.container.querySelector('.ide-csharp-type'), null)
    view.unmount()
  })

  it('retains basic colors after failure and retries only when requested', async () => {
    const invoke = mock.method(ipcRenderer, 'invoke', async () => ({
      tokens: [],
      error: 'Offline',
    }))
    const status = mock.fn()
    const ref = React.createRef<IdeCodeEditor>()
    const view = render(
      <IdeCodeEditor {...props} ref={ref} onCSharpStatus={status} />
    )
    await waitFor(() =>
      assert.ok(status.mock.calls.some(call => call.arguments[0] === 'Offline'))
    )
    view.rerender(
      <IdeCodeEditor
        {...props}
        ref={ref}
        text="class Rain {}"
        revision={1}
        onCSharpStatus={status}
      />
    )
    assert.equal(invoke.mock.callCount(), 1)
    ref.current?.retryCSharp()
    await waitFor(() => assert.equal(invoke.mock.callCount(), 2))
    assert.equal(view.container.querySelector('.ide-csharp-type'), null)
    view.unmount()
  })
})
