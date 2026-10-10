import assert from 'node:assert'
import { afterEach, beforeEach, describe, it } from 'node:test'
import * as React from 'react'

import { FileList } from '../../../src/ui/history/file-list'
import {
  AppFileStatusKind,
  CommittedFileChange,
} from '../../../src/models/status'
import { fireEvent, render, screen, waitFor } from '../../helpers/ui/render'

type FileListProps = React.ComponentProps<typeof FileList>

class SizedListResizeObserver implements ResizeObserver {
  public constructor(private readonly callback: ResizeObserverCallback) {}

  public observe(target: Element) {
    Object.defineProperties(target, {
      offsetWidth: { configurable: true, value: 400 },
      offsetHeight: { configurable: true, value: 360 },
    })
    this.callback(
      [
        {
          target,
          contentRect: new window.DOMRect(0, 0, 400, 360),
          borderBoxSize: [],
          contentBoxSize: [],
          devicePixelContentBoxSize: [],
        },
      ],
      this
    )
  }

  public unobserve() {}
  public disconnect() {}
}

const originalObserver = globalThis.ResizeObserver
const originalWindowObserver = window.ResizeObserver

beforeEach(() => {
  Object.assign(globalThis, { ResizeObserver: SizedListResizeObserver })
  Object.assign(window, { ResizeObserver: SizedListResizeObserver })
})

afterEach(() => {
  Object.assign(globalThis, { ResizeObserver: originalObserver })
  Object.assign(window, { ResizeObserver: originalWindowObserver })
})

function createProps(overrides: Partial<FileListProps> = {}): FileListProps {
  const files = [
    new CommittedFileChange(
      'z/readme.md',
      { kind: AppFileStatusKind.Modified },
      'after',
      'before'
    ),
    new CommittedFileChange(
      'src/a.ts',
      { kind: AppFileStatusKind.Modified },
      'after',
      'before'
    ),
    new CommittedFileChange(
      'root.ts',
      { kind: AppFileStatusKind.Deleted },
      'after',
      'before'
    ),
    new CommittedFileChange(
      'src/b.ts',
      { kind: AppFileStatusKind.New },
      'after',
      'before'
    ),
  ]
  return {
    files,
    showTree: true,
    selectedFile: files[1],
    availableWidth: 400,
    onSelectedFileChanged: () => {},
    onRowDoubleClick: () => {},
    ...overrides,
  }
}

describe('History file list', () => {
  it('routes tree selection, double click, and context menus to the original file', async () => {
    const selected = new Array<CommittedFileChange>()
    const opened = new Array<number>()
    const contextFiles = new Array<CommittedFileChange>()
    const props = createProps({
      onSelectedFileChanged: file => selected.push(file),
      onRowDoubleClick: row => opened.push(row),
      onContextMenu: file => contextFiles.push(file),
    })
    render(<FileList {...props} />)
    const row = await screen.findByRole('option', {
      name: 'z/readme.md Modified',
    })
    fireEvent.mouseDown(row, { button: 0 })
    fireEvent.mouseUp(row, { button: 0 })
    fireEvent.doubleClick(row)
    fireEvent.contextMenu(row)

    assert.deepStrictEqual(selected, [props.files[0]])
    assert.deepStrictEqual(opened, [0])
    assert.deepStrictEqual(contextFiles, [props.files[0]])
    assert.ok(screen.getByRole('option', { name: 'root.ts Deleted' }))
  })

  it('collapses folders without changing selection and opens them for a new selection', async () => {
    const selected = new Array<CommittedFileChange>()
    const props = createProps({
      onSelectedFileChanged: file => selected.push(file),
    })
    const view = render(<FileList {...props} />)
    const srcFolder = await screen.findByRole('button', {
      name: 'src, 2 changed files',
    })
    fireEvent.click(srcFolder)
    assert.equal(
      screen.queryByRole('option', { name: 'src/a.ts Modified' }),
      null
    )
    assert.deepStrictEqual(selected, [])

    view.rerender(<FileList {...props} selectedFile={props.files[3]} />)
    assert.equal(
      screen
        .getByRole('button', { name: 'src, 2 changed files' })
        .getAttribute('aria-expanded'),
      'true'
    )
    assert.equal(
      screen
        .getByRole('option', { name: 'src/b.ts New' })
        .getAttribute('aria-selected'),
      'true'
    )

    const folder = screen.getByRole('button', { name: 'src, 2 changed files' })
    fireEvent.keyDown(folder, { key: 'ArrowLeft' })
    assert.equal(folder.getAttribute('aria-expanded'), 'false')
    fireEvent.keyDown(folder, { key: 'ArrowRight' })
    assert.equal(folder.getAttribute('aria-expanded'), 'true')
    assert.deepStrictEqual(selected, [])
  })

  it('keeps file selection and flat ordering when switching layouts', async () => {
    const props = createProps()
    const view = render(<FileList {...props} />)
    await screen.findByRole('option', { name: 'src/a.ts Modified' })
    view.rerender(<FileList {...props} showTree={false} />)
    await waitFor(() => assert.equal(screen.getAllByRole('option').length, 4))
    assert.deepStrictEqual(
      screen.getAllByRole('option').map(row => row.getAttribute('aria-label')),
      [
        'z/readme.md Modified',
        'src/a.ts Modified',
        'root.ts Deleted',
        'src/b.ts New',
      ]
    )
    assert.equal(
      screen
        .getByRole('option', { name: 'src/a.ts Modified' })
        .getAttribute('aria-selected'),
      'true'
    )

    view.rerender(<FileList {...props} />)
    await screen.findByRole('option', { name: 'src/a.ts Modified' })
    assert.equal(
      screen
        .getByRole('option', { name: 'src/a.ts Modified' })
        .getAttribute('aria-selected'),
      'true'
    )
  })
})
