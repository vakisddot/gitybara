import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, it, mock } from 'node:test'
import * as React from 'react'
import CodeMirror from 'codemirror'
import { ipcRenderer } from 'electron'
import { readFile, writeFile } from 'fs/promises'
import { join } from 'path'

import { Repository } from '../../../src/models/repository'
import {
  AppFileStatusKind,
  WorkingDirectoryFileChange,
} from '../../../src/models/status'
import {
  DiffSelection,
  DiffSelectionType,
  DiffType,
  ImageDiffType,
} from '../../../src/models/diff'
import { Diff } from '../../../src/ui/diff'
import { IdeFileViewer } from '../../../src/ui/changes/ide/ide-file-viewer'
import { SandboxedMarkdown } from '../../../src/ui/lib/sandboxed-markdown'
import { createTempDirectory } from '../../helpers/temp'
import { fireEvent, render, waitFor } from '../../helpers/ui/render'

const originalBounds = window.Range.prototype.getBoundingClientRect
const originalRects = window.Range.prototype.getClientRects
const originalRequestFrame = window.requestAnimationFrame
const originalCancelFrame = window.cancelAnimationFrame
const originalScrollbarStyle = CodeMirror.defaults.scrollbarStyle

let previewProps: React.ComponentProps<typeof SandboxedMarkdown> | null = null

beforeEach(() => {
  localStorage.removeItem('file-content-zoom')
  window.Range.prototype.getBoundingClientRect = () => new window.DOMRect()
  window.Range.prototype.getClientRects = () => [] as unknown as DOMRectList
  window.requestAnimationFrame = callback =>
    window.setTimeout(() => callback(0), 0)
  window.cancelAnimationFrame = id => window.clearTimeout(id)
  CodeMirror.defaults.scrollbarStyle = 'null'
  Object.assign(ipcRenderer, { removeListener: mock.fn() })

  // jsdom doesn't load iframe documents. Capture the renderer's input while
  // exercising the actual file viewers and their mode switches.
  const capture = function (this: SandboxedMarkdown) {
    previewProps = this.props
    return Promise.resolve()
  }
  mock.method(SandboxedMarkdown.prototype, 'componentDidMount', capture)
  mock.method(SandboxedMarkdown.prototype, 'componentDidUpdate', capture)
  previewProps = null
})

afterEach(() => {
  localStorage.removeItem('file-content-zoom')
  window.Range.prototype.getBoundingClientRect = originalBounds
  window.Range.prototype.getClientRects = originalRects
  window.requestAnimationFrame = originalRequestFrame
  window.cancelAnimationFrame = originalCancelFrame
  CodeMirror.defaults.scrollbarStyle = originalScrollbarStyle
  mock.restoreAll()
})

function getEditor(container: HTMLElement): CodeMirror.Editor {
  const wrapper = container.querySelector('.CodeMirror') as
    | (HTMLElement & { CodeMirror: CodeMirror.Editor })
    | null
  assert.ok(wrapper)
  return wrapper.CodeMirror
}

describe('Markdown file previews', () => {
  it('renders file line breaks and GFM while stripping executable HTML', async () => {
    const ref = React.createRef<SandboxedMarkdown>()
    const view = render(
      <SandboxedMarkdown
        ref={ref}
        markdown={[
          '# Heading',
          '',
          'First line\nsecond line',
          '',
          '| Column |\n| --- |\n| Value |',
          '',
          '- [x] Done',
          '',
          '```js\nconst value = 1\n```',
          '',
          '<script>alert(1)</script><img src="x" onerror="alert(1)">',
        ].join('\n')}
        emoji={new Map()}
        breaks={false}
        underlineLinks={true}
        title="Markdown file preview"
      />
    )
    assert.ok(ref.current)
    // Isolate parsing from stylesheet IO and iframe loading in jsdom.
    Object.assign(ref.current, { getInlineStyleSheet: async () => '' })
    const originalFrame = globalThis.requestAnimationFrame
    globalThis.requestAnimationFrame = () => 0
    try {
      await ref.current.renderMarkdown()
    } finally {
      globalThis.requestAnimationFrame = originalFrame
    }
    const frame = view.container.querySelector('iframe')
    assert.ok(frame)
    const html = Buffer.from(frame.src.split(',')[1], 'base64').toString('utf8')
    const doc = new DOMParser().parseFromString(html, 'text/html')
    assert.equal(doc.querySelector('h1')?.textContent, 'Heading')
    assert.equal(doc.querySelector('p')?.textContent, 'First line\nsecond line')
    assert.equal(doc.querySelector('p br'), null)
    assert.equal(doc.querySelector('td')?.textContent, 'Value')
    assert.ok(doc.querySelector('input[type="checkbox"][checked][disabled]'))
    assert.equal(
      doc.querySelector('pre code')?.textContent,
      'const value = 1\n'
    )
    assert.equal(doc.querySelector('script, [onerror]'), null)
  })

  it('previews unsaved text and keeps the editor, cursor, undo history, and saving available', async t => {
    const directory = await createTempDirectory(t)
    await writeFile(join(directory, 'README.md'), '# Original\n')
    const repository = new Repository(directory, 1, null, false)
    const view = render(
      <IdeFileViewer
        repository={repository}
        path="README.md"
        changedFiles={[]}
        tabSize={2}
      />
    )
    await waitFor(() => assert.ok(view.container.querySelector('.CodeMirror')))
    const editor = getEditor(view.container)
    editor.replaceRange(' edited', { line: 0, ch: 10 })
    editor.setCursor({ line: 0, ch: 4 })
    const history = editor.historySize()

    fireEvent.click(view.getByRole('button', { name: 'Zoom in file content' }))
    assert.deepEqual(editor.getCursor(), { line: 0, ch: 4 })
    assert.deepEqual(editor.historySize(), history)

    fireEvent.click(view.getByRole('tab', { name: 'Preview' }))
    assert.equal(previewProps?.markdown, '# Original edited')
    assert.equal(previewProps?.breaks, false)
    assert.equal(previewProps?.zoomFactor, 1.1)
    assert.equal(getEditor(view.container), editor)
    assert.ok(view.container.querySelector('.ide-file-viewer-lines[hidden]'))
    assert.equal(
      await readFile(join(directory, 'README.md'), 'utf8'),
      '# Original\n'
    )

    fireEvent.click(view.getByRole('tab', { name: 'Code' }))
    assert.deepEqual(editor.getCursor(), { line: 0, ch: 4 })
    assert.deepEqual(editor.historySize(), history)
    assert.equal(editor.getValue(), '# Original edited')
    assert.equal(view.container.querySelector('.markdown-file-preview'), null)

    fireEvent.click(view.getByRole('tab', { name: 'Preview' }))
    fireEvent.click(view.getByRole('button', { name: 'Save' }))
    await waitFor(async () =>
      assert.equal(
        await readFile(join(directory, 'README.md'), 'utf8'),
        '# Original edited\n'
      )
    )
    view.unmount()
  })

  it('refreshes a preview when the file changes and resets the mode when selecting another file', async t => {
    const directory = await createTempDirectory(t)
    await writeFile(join(directory, 'README.MD'), '# First\n')
    await writeFile(join(directory, 'other.txt'), 'Other file\n')
    const props = {
      repository: new Repository(directory, 1, null, false),
      path: 'README.MD',
      changedFiles: [],
      tabSize: 2,
    }
    const view = render(<IdeFileViewer {...props} />)
    await waitFor(() => assert.ok(view.container.querySelector('.CodeMirror')))
    fireEvent.click(view.getByRole('tab', { name: 'Preview' }))
    assert.equal(previewProps?.markdown, '# First')

    await writeFile(join(directory, 'README.MD'), '# Updated\n')
    view.rerender(<IdeFileViewer {...props} changedFiles={[]} />)
    await waitFor(() => assert.equal(previewProps?.markdown, '# Updated'))

    view.rerender(<IdeFileViewer {...props} path="other.txt" />)
    await waitFor(() =>
      assert.equal(getEditor(view.container).getValue(), 'Other file')
    )
    assert.equal(view.queryByRole('tab', { name: 'Preview' }), null)
    assert.equal(view.container.querySelector('.markdown-file-preview'), null)
    view.unmount()
  })

  for (const kind of [
    AppFileStatusKind.Modified,
    AppFileStatusKind.New,
    AppFileStatusKind.Deleted,
  ] as const) {
    it(`previews the full ${
      kind === AppFileStatusKind.Deleted ? 'previous' : 'current'
    } document for a ${kind} file`, async () => {
      const file = new WorkingDirectoryFileChange(
        'guide.markdown',
        { kind },
        DiffSelection.fromInitialSelection(DiffSelectionType.All)
      )
      const props: React.ComponentProps<typeof Diff> = {
        repository: new Repository('unused', 1, null, false),
        file,
        readOnly: true,
        diff: {
          kind: DiffType.Text,
          text: '',
          hunks: [],
          maxLineNumber: 0,
          hasHiddenBidiChars: false,
        },
        fileContents: {
          file,
          oldContents: ['# Previous', '', 'Unchanged context'],
          newContents: ['# Current', '', 'Unchanged context'],
          canBeExpanded: true,
          isTruncated: false,
        },
        imageDiffType: ImageDiffType.TwoUp,
        hideWhitespaceInDiff: false,
        showSideBySideDiff: false,
        showDiffCheckMarks: false,
        onOpenBinaryFile: () => {},
        onChangeImageDiffType: () => {},
        onHideWhitespaceInDiffChanged: () => {},
      }
      const view = render(<Diff {...props} />)
      fireEvent.click(view.getByRole('tab', { name: 'Preview' }))
      assert.equal(
        previewProps?.markdown,
        kind === AppFileStatusKind.Deleted
          ? '# Previous\n\nUnchanged context'
          : '# Current\n\nUnchanged context'
      )
      assert.equal(
        view.container.querySelector('iframe')?.getAttribute('sandbox'),
        'allow-same-origin'
      )

      // Never display silently truncated Markdown as a complete document.
      assert.ok(props.fileContents)
      view.rerender(
        <Diff
          {...props}
          fileContents={{ ...props.fileContents, isTruncated: true }}
        />
      )
      assert.ok(
        view.getByText('The Markdown file is too large to be previewed.')
      )
      assert.equal(view.container.querySelector('.markdown-file-preview'), null)
      fireEvent.click(view.getByRole('tab', { name: 'Code' }))
      assert.equal(
        view.queryByText('The Markdown file is too large to be previewed.'),
        null
      )
    })
  }
})
