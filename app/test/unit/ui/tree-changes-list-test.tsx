import assert from 'node:assert'
import { describe, it } from 'node:test'
import * as React from 'react'

// SectionList reads `window.ResizeObserver` while the shared setup polyfills
// only `globalThis.ResizeObserver` (jsdom's window is a separate object). A
// no-op observer is enough for these tests since they don't depend on resize
// events firing.
if (
  typeof window !== 'undefined' &&
  (window as unknown as { ResizeObserver?: unknown }).ResizeObserver ===
    undefined
) {
  ;(window as any).ResizeObserver = class {
    public observe() {}
    public unobserve() {}
    public disconnect() {}
  }
}

import { DiffSelection, DiffSelectionType } from '../../../src/models/diff'
import {
  AppFileStatusKind,
  PlainFileStatus,
  WorkingDirectoryFileChange,
} from '../../../src/models/status'
import type { IChangesListItem } from '../../../src/ui/changes/changes-list-types'
import { TreeChangesList } from '../../../src/ui/changes/tree/tree-changes-list'
import { IFileListFilterState } from '../../../src/lib/app-state'
import { render } from '../../helpers/ui/render'

type TreeChangesListProps = React.ComponentProps<typeof TreeChangesList>

const defaultFilter: IFileListFilterState = {
  filterText: '',
  isIncludedInCommit: false,
  isExcludedFromCommit: false,
  isNewFile: false,
  isModifiedFile: false,
  isDeletedFile: false,
}

function createChangesListItem(
  path: string,
  statusKind: PlainFileStatus['kind'] = AppFileStatusKind.Modified
): IChangesListItem {
  const change = new WorkingDirectoryFileChange(
    path,
    { kind: statusKind },
    DiffSelection.fromInitialSelection(DiffSelectionType.All)
  )

  return {
    id: change.id,
    text: [path],
    change,
  }
}

function createProps(
  overrides: Partial<TreeChangesListProps> = {}
): TreeChangesListProps {
  return {
    items: [
      createChangesListItem('src/ui/app.tsx'),
      createChangesListItem('src/ui/changes/filter-changes-list.tsx'),
    ],
    showChangesFilter: false,
    fileListFilter: defaultFilter,
    selectedItems: [],
    focusedFileId: null,
    collapsedDirectoryIds: new Set<string>(),
    rowHeight: 27,
    availableWidth: 320,
    onDirectoryToggled: () => {},
    onDirectoryContextMenu: () => {},
    onFileSelectionChanged: () => {},
    onFileClick: () => {},
    onFileDoubleClick: () => {},
    onFileKeyboardFocus: () => {},
    onFileBlur: () => {},
    onFileKeyDown: () => {},
    onFileContextMenu: () => {},
    onScroll: () => {},
    renderFile: () => null,
    renderNoItems: () => <div>No files</div>,
    ...overrides,
  }
}

// Lifecycle tests only need to mount and then re-render with new props.
function renderList(props: TreeChangesListProps) {
  const view = render(<TreeChangesList {...props} />)
  return {
    rerender: (next: TreeChangesListProps) =>
      view.rerender(<TreeChangesList {...next} />),
  }
}

// onFilterKeyDown is an imperative method the parent calls directly, so these
// tests need the mounted component instance rather than a DOM interaction.
function renderListInstance(props: TreeChangesListProps): TreeChangesList {
  const ref = React.createRef<TreeChangesList>()
  render(<TreeChangesList {...props} ref={ref} />)

  if (ref.current === null) {
    throw new Error('TreeChangesList ref is not attached')
  }

  return ref.current
}

describe('TreeChangesList', () => {
  it('reports filtered items via onFilterListResultsChanged on mount', () => {
    const filteredItems = new Array<IChangesListItem>()
    const props = createProps({
      showChangesFilter: true,
      fileListFilter: { ...defaultFilter, filterText: 'app' },
      onFilterListResultsChanged: items => filteredItems.push(...items),
    })

    renderList(props)

    assert.deepStrictEqual(
      filteredItems.map(item => item.change.path),
      ['src/ui/app.tsx']
    )
  })

  it('does not re-emit onFilterListResultsChanged when ids are unchanged', () => {
    let callCount = 0
    const props = createProps({
      showChangesFilter: true,
      fileListFilter: { ...defaultFilter, filterText: 'app' },
      onFilterListResultsChanged: () => {
        callCount += 1
      },
    })

    const { rerender } = renderList(props)
    assert.equal(callCount, 1)

    // A rerender with the same items must not re-emit because the resulting
    // ids didn't change. Memoization should keep the filter result list stable.
    rerender({ ...props })
    assert.equal(callCount, 1)
  })

  it('re-emits onFilterListResultsChanged when filter text changes the result', () => {
    const filteredPaths = new Array<ReadonlyArray<string>>()
    const props = createProps({
      showChangesFilter: true,
      fileListFilter: { ...defaultFilter, filterText: 'app' },
      onFilterListResultsChanged: items =>
        filteredPaths.push(items.map(item => item.change.path)),
    })

    const { rerender } = renderList(props)
    rerender({
      ...props,
      fileListFilter: { ...defaultFilter, filterText: 'filter' },
    })

    assert.deepStrictEqual(filteredPaths, [
      ['src/ui/app.tsx'],
      ['src/ui/changes/filter-changes-list.tsx'],
    ])
  })

  it('selects the first filter result when the selection is filtered out', () => {
    const selectedItem = createChangesListItem('src/ui/app.tsx')
    const matchingItem = createChangesListItem('readme.md')
    const selectedPaths = new Array<string>()
    const props = createProps({
      items: [selectedItem, matchingItem],
      selectedItems: [selectedItem],
      showChangesFilter: true,
      fileListFilter: defaultFilter,
      onFileSelectionChanged: items =>
        selectedPaths.push(...items.map(item => item.change.path)),
    })

    const { rerender } = renderList(props)
    rerender({
      ...props,
      fileListFilter: { ...defaultFilter, filterText: 'readme' },
    })

    assert.deepStrictEqual(selectedPaths, ['readme.md'])
  })

  it('keeps the current selection when it is only hidden by a collapsed directory', () => {
    const selectedItem = createChangesListItem('src/ui/app.tsx')
    const matchingItem = createChangesListItem('src/ui/readme.md')
    const selectedPaths = new Array<string>()
    const props = createProps({
      items: [selectedItem, matchingItem],
      selectedItems: [selectedItem],
      collapsedDirectoryIds: new Set<string>(['src/ui']),
      showChangesFilter: true,
      fileListFilter: { ...defaultFilter, filterText: 'src' },
      onFileSelectionChanged: items =>
        selectedPaths.push(...items.map(item => item.change.path)),
    })

    const { rerender } = renderList(props)
    rerender({
      ...props,
      fileListFilter: { ...defaultFilter, filterText: 'ui' },
    })

    assert.deepStrictEqual(selectedPaths, [])
  })

  it('renders the empty placeholder when filtering excludes every file', () => {
    let renderedNoItems = false
    renderList(
      createProps({
        showChangesFilter: true,
        fileListFilter: { ...defaultFilter, filterText: 'zzz' },
        renderNoItems: () => {
          renderedNoItems = true
          return <div>No files</div>
        },
      })
    )

    assert.equal(renderedNoItems, true)
  })

  it('applies non-text filter options to the reported results', () => {
    const filteredItems = new Array<IChangesListItem>()
    renderList(
      createProps({
        items: [
          createChangesListItem('modified.ts', AppFileStatusKind.Modified),
          createChangesListItem('added.ts', AppFileStatusKind.New),
        ],
        showChangesFilter: true,
        fileListFilter: { ...defaultFilter, isNewFile: true },
        onFilterListResultsChanged: items => filteredItems.push(...items),
      })
    )

    // The "new files" filter option keeps only the New file, even though no
    // filter text was typed.
    assert.deepStrictEqual(
      filteredItems.map(item => item.change.path),
      ['added.ts']
    )
  })

  it('ignores filter text when the changes filter is disabled', () => {
    const filteredItems = new Array<IChangesListItem>()
    renderList(
      createProps({
        showChangesFilter: false,
        fileListFilter: { ...defaultFilter, filterText: 'app' },
        onFilterListResultsChanged: items => filteredItems.push(...items),
      })
    )

    // showChangesFilter is false, so the 'app' filter text is not applied and
    // both default items come through unchanged.
    assert.deepStrictEqual(
      filteredItems.map(item => item.change.path),
      ['src/ui/app.tsx', 'src/ui/changes/filter-changes-list.tsx']
    )
  })

  describe('onFilterKeyDown', () => {
    function fakeKeyboardEvent(key: string): {
      readonly event: React.KeyboardEvent<HTMLInputElement>
      readonly preventDefaultCalled: () => boolean
    } {
      let preventedDefault = false
      const event = {
        key,
        preventDefault: () => {
          preventedDefault = true
        },
      } as unknown as React.KeyboardEvent<HTMLInputElement>

      return { event, preventDefaultCalled: () => preventedDefault }
    }

    it('selects the first tree file when ArrowDown is pressed from the filter field', () => {
      const firstItem = createChangesListItem('a.ts')
      const secondItem = createChangesListItem('b.ts')
      const selectedPaths = new Array<string>()
      const props = createProps({
        items: [secondItem, firstItem],
        selectedItems: [firstItem, secondItem],
        onFileSelectionChanged: items =>
          selectedPaths.push(...items.map(item => item.change.path)),
      })

      const list = renderListInstance(props)
      const { event, preventDefaultCalled } = fakeKeyboardEvent('ArrowDown')
      list.onFilterKeyDown(event)

      assert.equal(preventDefaultCalled(), true)
      assert.deepStrictEqual(selectedPaths, ['a.ts'])
    })

    it('selects the last tree file when ArrowUp is pressed from the filter field', () => {
      const selectedPaths = new Array<string>()
      const props = createProps({
        items: [
          createChangesListItem('a.ts'),
          createChangesListItem('b.ts'),
          createChangesListItem('c.ts'),
        ],
        onFileSelectionChanged: items =>
          selectedPaths.push(...items.map(item => item.change.path)),
      })

      const list = renderListInstance(props)
      const { event } = fakeKeyboardEvent('ArrowUp')
      list.onFilterKeyDown(event)

      assert.deepStrictEqual(selectedPaths, ['c.ts'])
    })

    it('clicks the first tree file when Enter is pressed with a non-empty filter', () => {
      const clickedPaths = new Array<string>()
      const props = createProps({
        items: [createChangesListItem('b.ts'), createChangesListItem('a.ts')],
        showChangesFilter: true,
        fileListFilter: { ...defaultFilter, filterText: 'a' },
        onFileClick: item => clickedPaths.push(item.change.path),
      })

      const list = renderListInstance(props)
      const { event, preventDefaultCalled } = fakeKeyboardEvent('Enter')
      list.onFilterKeyDown(event)

      assert.equal(preventDefaultCalled(), true)
      assert.deepStrictEqual(clickedPaths, ['a.ts'])
    })

    it('does not click a tree file when Enter is pressed with an empty filter', () => {
      const clickedPaths = new Array<string>()
      const props = createProps({
        items: [createChangesListItem('b.ts'), createChangesListItem('a.ts')],
        showChangesFilter: true,
        fileListFilter: { ...defaultFilter, filterText: '' },
        onFileClick: item => clickedPaths.push(item.change.path),
      })

      const list = renderListInstance(props)
      const { event, preventDefaultCalled } = fakeKeyboardEvent('Enter')
      list.onFilterKeyDown(event)

      assert.equal(preventDefaultCalled(), true)
      assert.deepStrictEqual(clickedPaths, [])
    })

    it('is a no-op for unrelated keys', () => {
      const clickedPaths = new Array<string>()
      const selectedPaths = new Array<string>()
      const props = createProps({
        onFileClick: item => clickedPaths.push(item.change.path),
        onFileSelectionChanged: items =>
          selectedPaths.push(...items.map(item => item.change.path)),
      })

      const list = renderListInstance(props)
      const { event, preventDefaultCalled } = fakeKeyboardEvent('Escape')
      list.onFilterKeyDown(event)

      assert.equal(preventDefaultCalled(), false)
      assert.deepStrictEqual(clickedPaths, [])
      assert.deepStrictEqual(selectedPaths, [])
    })

    it('does not move selection on ArrowDown when the filter hides every file', () => {
      const selectedPaths = new Array<string>()
      const props = createProps({
        showChangesFilter: true,
        fileListFilter: { ...defaultFilter, filterText: 'zzz' },
        onFileSelectionChanged: items =>
          selectedPaths.push(...items.map(item => item.change.path)),
      })

      const list = renderListInstance(props)
      const { event, preventDefaultCalled } = fakeKeyboardEvent('ArrowDown')
      list.onFilterKeyDown(event)

      // There are no file rows to move to, so selection is untouched, but the
      // key is still consumed so the filter field doesn't act on it.
      assert.equal(preventDefaultCalled(), true)
      assert.deepStrictEqual(selectedPaths, [])
    })

    it('does not re-emit selection when ArrowDown lands on the already-selected file', () => {
      const firstItem = createChangesListItem('a.ts')
      const selectedPaths = new Array<string>()
      const props = createProps({
        items: [firstItem, createChangesListItem('b.ts')],
        selectedItems: [firstItem],
        onFileSelectionChanged: items =>
          selectedPaths.push(...items.map(item => item.change.path)),
      })

      const list = renderListInstance(props)
      list.onFilterKeyDown(fakeKeyboardEvent('ArrowDown').event)

      // a.ts is the first file row and already the sole selection, so
      // moveSelectionToFileRow skips the redundant onFileSelectionChanged call.
      assert.deepStrictEqual(selectedPaths, [])
    })
  })
})
