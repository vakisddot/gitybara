import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, it, mock } from 'node:test'
import { writeFile } from 'fs/promises'
import { join } from 'path'
import * as React from 'react'
import CodeMirror from 'codemirror'
import { ipcRenderer } from 'electron'
import { List } from 'react-virtualized'

import { Repository } from '../../../src/models/repository'
import {
  CommittedFileChange,
  AppFileStatusKind,
} from '../../../src/models/status'
import { DiffType } from '../../../src/models/diff'
import { DiffParser } from '../../../src/lib/diff-parser'
import { SideBySideDiff } from '../../../src/ui/diff/side-by-side-diff'
import { IdeFileViewer } from '../../../src/ui/changes/ide/ide-file-viewer'
import { createTempDirectory } from '../../helpers/temp'
import { fireEvent, render, waitFor } from '../../helpers/ui/render'

const originalBounds = window.Range.prototype.getBoundingClientRect
const originalRects = window.Range.prototype.getClientRects
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
  // jsdom has no layout; both the editor and virtual diff need a viewport.
  window.Range.prototype.getBoundingClientRect = () => new window.DOMRect()
  window.Range.prototype.getClientRects = () => [] as unknown as DOMRectList
  CodeMirror.defaults.scrollbarStyle = 'null'
  sizeProperties.forEach(key =>
    Object.defineProperty(window.HTMLElement.prototype, key, {
      configurable: true,
      get: () =>
        key === 'offsetHeight' ? 20 : key === 'clientHeight' ? 200 : 800,
    })
  )
  Object.assign(ipcRenderer, { removeListener: mock.fn() })
})

afterEach(() => {
  window.Range.prototype.getBoundingClientRect = originalBounds
  window.Range.prototype.getClientRects = originalRects
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

function diffElement(split: boolean) {
  const raw = new DiffParser().parse(
    '--- a/file.txt\n+++ b/file.txt\n@@ -1,2 +1,2 @@\n-alpha old\n+alpha new\n alpha context\n'
  )
  assert.equal(raw.hunks.length, 1)
  return (
    <SideBySideDiff
      file={
        new CommittedFileChange(
          'file.txt',
          { kind: AppFileStatusKind.Modified },
          'HEAD',
          'HEAD^'
        )
      }
      diff={{ ...raw, text: raw.contents, kind: DiffType.Text }}
      fileContents={null}
      hideWhitespaceInDiff={false}
      showSideBySideDiff={split}
      showDiffCheckMarks={false}
      onHideWhitespaceInDiffChanged={() => {}}
    />
  )
}

function exerciseSearch(view: ReturnType<typeof render>, total: number) {
  fireEvent.keyDown(document.body, { key: 'f', ctrlKey: true })
  const input = view.getByRole('textbox', { name: 'Find in diff' })
  assert.equal(document.activeElement, input)
  fireEvent.change(input, { target: { value: 'ALPHA' } })
  const count = view.container.querySelector('.diff-search-count')
  const expectIndex = (index: number) =>
    assert.equal(count?.textContent, `${index} of ${total}`)
  expectIndex(1)

  fireEvent.keyDown(input, { key: 'Enter' })
  expectIndex(2)
  fireEvent.keyDown(input, { key: 'Enter', shiftKey: true })
  expectIndex(1)
  fireEvent.keyDown(input, { key: 'F3', shiftKey: true })
  expectIndex(total)
  fireEvent.keyDown(input, { key: 'F3' })
  expectIndex(1)

  const next = view.getByRole('button', { name: 'Next match' })
  next.focus()
  assert.ok(view.queryByRole('textbox', { name: 'Find in diff' }))
  fireEvent.click(next)
  expectIndex(2)
  fireEvent.keyDown(next, { key: 'F3', shiftKey: true })
  expectIndex(1)
  fireEvent.click(view.getByRole('button', { name: 'Previous match' }))
  expectIndex(total)

  fireEvent.keyDown(next, { key: 'f', ctrlKey: true })
  assert.equal(document.activeElement, input)
  expectIndex(total)
  fireEvent.change(input, { target: { value: 'missing' } })
  assert.equal(count?.textContent, 'No results')
  assert.equal(next.getAttribute('aria-disabled'), 'true')
  assert.ok(
    view
      .getByRole('button', { name: 'Previous match' })
      .getAttribute('aria-disabled') === 'true'
  )
  fireEvent.keyDown(input, { key: 'F3' })
  assert.equal(count?.textContent, 'No results')
  fireEvent.change(input, { target: { value: 'alpha' } })
  expectIndex(1)
  fireEvent.click(view.getByRole('button', { name: 'Clear' }))
  assert.equal(count?.textContent, '')
  assert.equal(next.getAttribute('aria-disabled'), 'true')

  fireEvent.keyDown(input, { key: 'Escape' })
  assert.equal(view.queryByRole('textbox', { name: 'Find in diff' }), null)
  fireEvent(document, new CustomEvent('find-text', { bubbles: true }))
  assert.equal(
    document.activeElement,
    view.getByRole('textbox', { name: 'Find in diff' })
  )
  fireEvent.click(view.getByRole('button', { name: 'Close search' }))
  assert.equal(view.queryByRole('textbox', { name: 'Find in diff' }), null)
}

for (const split of [false, true]) {
  describe(`${split ? 'Split' : 'Unified'} diff search`, () => {
    it('opens, counts matches, navigates, and closes with the shared controls', () => {
      // Context appears in both columns of a split diff and is counted twice.
      exerciseSearch(render(diffElement(split)), split ? 4 : 3)
    })

    it('scrolls to the first result when starting a new search', () => {
      const scroll = mock.method(List.prototype, 'scrollToRow')
      const view = render(diffElement(split))
      fireEvent.keyDown(document.body, { key: 'f', ctrlKey: true })
      const input = view.getByRole('textbox', { name: 'Find in diff' })
      fireEvent.change(input, { target: { value: 'context' } })
      assert.equal(scroll.mock.callCount(), 1)
      assert.equal(scroll.mock.calls[0].arguments[0], split ? 2 : 3)
    })

    it('recounts matches when changing the diff layout', () => {
      const view = render(diffElement(split))
      fireEvent.keyDown(document.body, { key: 'f', ctrlKey: true })
      const input = view.getByRole('textbox', { name: 'Find in diff' })
      fireEvent.change(input, { target: { value: 'alpha' } })
      const count = () =>
        view.container.querySelector('.diff-search-count')?.textContent
      assert.equal(count(), `1 of ${split ? 4 : 3}`)
      view.rerender(diffElement(!split))
      assert.equal(count(), `1 of ${split ? 3 : 4}`)
      fireEvent.keyDown(input, { key: 'F3', shiftKey: true })
      assert.equal(count(), `${split ? 3 : 4} of ${split ? 3 : 4}`)
    })
  })
}

describe('Gitybara file search', () => {
  it('uses the same controls and clears highlights on closing', async t => {
    const directory = await createTempDirectory(t)
    await writeFile(
      join(directory, 'file.txt'),
      'alpha first\nAlpha second\nALPHA third\n'
    )
    const view = render(
      <IdeFileViewer
        repository={new Repository(directory, 1, null, false)}
        path="file.txt"
        changedFiles={[]}
        tabSize={2}
        readOnly={true}
        collapseUnchangedLines={true}
      />
    )
    await waitFor(() => assert.ok(view.container.querySelector('.CodeMirror')))
    exerciseSearch(view, 3)
    assert.equal(
      view.container.querySelector('.ide-search-current, .ide-search-match'),
      null
    )
    view.unmount()
  })
})
