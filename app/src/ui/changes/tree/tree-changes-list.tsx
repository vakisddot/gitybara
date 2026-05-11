import * as React from 'react'

import { IFileListFilterState } from '../../../lib/app-state'
import { IMatches, match } from '../../../lib/fuzzy-find'
import { ClickSource } from '../../lib/list'
import { SectionList } from '../../lib/list/section-list'
import { RowIndexPath } from '../../lib/list/list-row-index-path'
import {
  buildChangesTreeRows,
  ChangesTreeRow,
  getAncestorDirectoryIds,
  getChangesTreeDirectoryIds,
  IChangesTreeFileItem,
} from './tree-changes-rows'
import {
  TreeChangesDirectoryRow,
  TreeGuideLines,
  TreeIndent,
} from './tree-changes-directory-row'
import type { IChangesListItem } from '../changes-list-types'
import { applyFilters } from '../filter-changes-logic'
import memoizeOne from 'memoize-one'

const NoMatches: IMatches = { title: [], subtitle: [] }

interface IChangesListItemWithMatches {
  readonly item: IChangesListItem
  readonly matches: IMatches
}

interface IChangesTreeFileItemWithMatches extends IChangesTreeFileItem {
  readonly changeListItem: IChangesListItem
  readonly matches: IMatches
}

type ChangesTreeListRow = ChangesTreeRow<IChangesTreeFileItemWithMatches>
type ChangesTreeDirectoryRow = Extract<
  ChangesTreeListRow,
  { kind: 'directory' }
>
type ChangesTreeFileRow = Extract<ChangesTreeListRow, { kind: 'file' }>

interface ITreeChangesListViewProps {
  /**
   * Changed files that remain after filtering, with fuzzy match metadata.
   * Directory rows are derived from these paths.
   */
  readonly items: ReadonlyArray<IChangesListItemWithMatches>
  readonly filterText: string
  readonly selectedItems: ReadonlyArray<IChangesListItem>
  readonly focusedFileId: string | null
  readonly collapsedDirectoryIds: ReadonlySet<string>
  readonly rowHeight: number
  readonly availableWidth: number
  readonly setScrollTop?: number
  readonly onDirectoryToggled: (directoryId: string) => void
  readonly onDirectoryContextMenu: (
    directoryPath: string,
    event: React.MouseEvent<HTMLButtonElement>
  ) => void
  readonly onFileSelectionChanged: (
    items: ReadonlyArray<IChangesListItem>
  ) => void
  readonly onFileClick: (item: IChangesListItem, source: ClickSource) => void
  readonly onFileDoubleClick: (
    item: IChangesListItem,
    source: ClickSource
  ) => void
  readonly onFileKeyboardFocus: (
    item: IChangesListItem,
    event: React.KeyboardEvent<any>
  ) => void
  readonly onFileBlur: (
    item: IChangesListItem,
    event: React.FocusEvent<HTMLDivElement>
  ) => void
  readonly onFileKeyDown: (
    item: IChangesListItem,
    event: React.KeyboardEvent<any>
  ) => void
  readonly onFileContextMenu: (
    item: IChangesListItem,
    event: React.MouseEvent<HTMLDivElement>
  ) => void
  readonly onScroll: (scrollTop: number, clientHeight: number) => void
  readonly renderFile: (
    item: IChangesListItem,
    matches: IMatches,
    indentation: number,
    displayPath: string
  ) => JSX.Element | null
  readonly renderNoItems: () => JSX.Element | null
}

function toTreeFileItems(
  items: ReadonlyArray<IChangesListItemWithMatches>
): ReadonlyArray<IChangesTreeFileItemWithMatches> {
  return items.map(({ item, matches }) => ({
    id: item.id,
    path: item.change.path,
    changeListItem: item,
    matches,
  }))
}

export function someItemHasSelectedId<T>(
  items: ReadonlyArray<T>,
  getId: (item: T) => string,
  selectedItems: ReadonlyArray<IChangesListItem>
): boolean {
  if (selectedItems.length === 0) {
    return false
  }

  if (selectedItems.length === 1) {
    const selectedId = selectedItems[0].id
    return items.some(item => getId(item) === selectedId)
  }

  const selectedItemIds = new Set(selectedItems.map(item => item.id))
  return items.some(item => selectedItemIds.has(getId(item)))
}

// Directory rows are derived, not matched directly. Highlight them by
// projecting match offsets from descendant file paths, recording only ids
// that survive compaction (others never render).
export function buildDirectoryNameMatchesByPath(
  items: ReadonlyArray<IChangesTreeFileItemWithMatches>
): ReadonlyMap<string, ReadonlyArray<number>> {
  const renderedDirectoryIds = getChangesTreeDirectoryIds(items)
  const matchesByPath = new Map<string, Set<number>>()

  for (const item of items) {
    const titleMatches = item.matches.title

    if (titleMatches.length === 0) {
      continue
    }

    for (const directoryId of getAncestorDirectoryIds(item.path)) {
      if (!renderedDirectoryIds.has(directoryId)) {
        continue
      }

      let directoryMatches: Set<number> | undefined = undefined

      for (const match of titleMatches) {
        if (match >= directoryId.length) {
          continue
        }

        if (directoryMatches === undefined) {
          directoryMatches = matchesByPath.get(directoryId)

          if (directoryMatches === undefined) {
            directoryMatches = new Set<number>()
            matchesByPath.set(directoryId, directoryMatches)
          }
        }

        directoryMatches.add(match)
      }
    }
  }

  return new Map<string, ReadonlyArray<number>>(
    Array.from(matchesByPath, ([path, matches]) => [
      path,
      Array.from(matches).sort((a, b) => a - b),
    ])
  )
}

export class TreeChangesListView extends React.Component<ITreeChangesListViewProps> {
  private readonly listRef = React.createRef<SectionList>()

  private getTreeFileItems = memoizeOne(
    (items: ReadonlyArray<IChangesListItemWithMatches>) =>
      toTreeFileItems(items)
  )

  private getRows = memoizeOne(
    (
      items: ReadonlyArray<IChangesListItemWithMatches>,
      collapsedDirectoryIds: ReadonlySet<string>
    ): ReadonlyArray<ChangesTreeListRow> =>
      buildChangesTreeRows(this.getTreeFileItems(items), collapsedDirectoryIds)
  )

  private hasDirectoryRows = memoizeOne(
    (visibleRows: ReadonlyArray<ChangesTreeListRow>) =>
      visibleRows.some(row => row.kind === 'directory')
  )

  private getDirectoryNameMatchesByPath = memoizeOne(
    (items: ReadonlyArray<IChangesTreeFileItemWithMatches>) =>
      buildDirectoryNameMatchesByPath(items)
  )

  private get treeFileItems() {
    return this.getTreeFileItems(this.props.items)
  }

  private get visibleRows(): ReadonlyArray<ChangesTreeListRow> {
    // Rows literally shown in the list: filter result files plus tree
    // directories, excluding descendants of collapsed directories.
    return this.getRows(this.props.items, this.props.collapsedDirectoryIds)
  }

  private getSelectedVisibleRows = memoizeOne(
    (
      visibleRows: ReadonlyArray<ChangesTreeListRow>,
      selectedItems: ReadonlyArray<IChangesListItem>
    ): ReadonlyArray<RowIndexPath> => {
      if (selectedItems.length === 0) {
        return []
      }

      // SectionList selection is row-index based, but app selection is still
      // file-item based. Directory rows are intentionally skipped.
      const selectedVisibleRows = new Array<RowIndexPath>()
      const selectedItemIds = new Set(selectedItems.map(item => item.id))

      visibleRows.forEach((row, index) => {
        if (row.kind === 'file' && selectedItemIds.has(row.item.id)) {
          selectedVisibleRows.push({ section: 0, row: index })
        }
      })

      return selectedVisibleRows
    }
  )

  private hasSelectedItemInFilterResults = memoizeOne(
    (
      items: ReadonlyArray<IChangesListItemWithMatches>,
      selectedItems: ReadonlyArray<IChangesListItem>
    ) => someItemHasSelectedId(items, ({ item }) => item.id, selectedItems)
  )

  private getDirectoryRowClassNameMap = memoizeOne(
    (visibleRows: ReadonlyArray<ChangesTreeListRow>) => {
      // SectionList owns the outer row wrapper. This map lets tree directory
      // rows receive list-level hover/focus styling on that wrapper.
      const directoryRows = new Array<RowIndexPath>()

      visibleRows.forEach((row, index) => {
        if (row.kind === 'directory') {
          directoryRows.push({ section: 0, row: index })
        }
      })

      return new Map<string, ReadonlyArray<RowIndexPath>>([
        ['changes-tree-directory-list-item', directoryRows],
      ])
    }
  )

  private getDirectoryNameMatches(
    row: ChangesTreeDirectoryRow
  ): ReadonlyArray<number> {
    // Match positions are stored against the full directory path. A compacted
    // row may display only the suffix, e.g. path "a/b" with name "b", so shift
    // offsets into the displayed name before highlighting.
    const matches = this.getDirectoryNameMatchesByPath(this.treeFileItems).get(
      row.path
    )

    if (matches === undefined) {
      return []
    }

    const displayNameOffset = row.path.length - row.name.length
    const displayNameMatches = new Array<number>()

    for (const match of matches) {
      if (match >= displayNameOffset && match < row.path.length) {
        displayNameMatches.push(match - displayNameOffset)
      }
    }

    return displayNameMatches
  }

  private getFileRow(index: RowIndexPath): ChangesTreeFileRow | null {
    const row = this.visibleRows[index.row]
    return row?.kind === 'file' ? row : null
  }

  private getFirstFileRowIndexPath(
    visibleRows: ReadonlyArray<ChangesTreeListRow>
  ): RowIndexPath | null {
    const row = visibleRows.findIndex(row => row.kind === 'file')
    return row === -1 ? null : { section: 0, row }
  }

  private getLastFileRowIndexPath(
    visibleRows: ReadonlyArray<ChangesTreeListRow>
  ): RowIndexPath | null {
    const row = visibleRows.findLastIndex(row => row.kind === 'file')
    return row === -1 ? null : { section: 0, row }
  }

  private moveSelectionToFileRow(index: RowIndexPath) {
    const row = this.getFileRow(index)

    if (row === null) {
      return
    }

    const isOnlySelected =
      this.props.selectedItems.length === 1 &&
      this.props.selectedItems[0].id === row.item.id

    if (!isOnlySelected) {
      this.props.onFileSelectionChanged([row.item.changeListItem])
    }

    this.listRef.current?.focusRow(index)
  }

  private canSelectRow = (index: RowIndexPath) => {
    return this.getFileRow(index) !== null
  }

  private renderDirectoryRow = (row: ChangesTreeDirectoryRow) => {
    return (
      <TreeChangesDirectoryRow
        row={row}
        matches={this.getDirectoryNameMatches(row)}
        availableWidth={this.props.availableWidth}
        onClick={this.onDirectoryRowClick}
        onKeyDown={this.onDirectoryRowKeyDown}
        onContextMenu={this.onDirectoryRowContextMenu}
      />
    )
  }

  private getMatchesForDisplayPath = (
    path: string,
    displayPath: string,
    matches: IMatches
  ): IMatches => {
    // File rows render only the basename in tree view. Shift title match
    // offsets from the full path into that displayed basename.
    if (path === displayPath || matches.title.length === 0) {
      return matches
    }

    const offset = path.length - displayPath.length
    const title = new Array<number>()

    for (const match of matches.title) {
      const displayPathMatch = match - offset

      if (displayPathMatch >= 0 && displayPathMatch < displayPath.length) {
        title.push(displayPathMatch)
      }
    }

    return { ...matches, title }
  }

  private getDirectoryIdFromEvent(
    event:
      | React.MouseEvent<HTMLButtonElement>
      | React.KeyboardEvent<HTMLButtonElement>
  ): string | null {
    return event.currentTarget.getAttribute('data-directory-id')
  }

  private onDirectoryRowClick = (
    event: React.MouseEvent<HTMLButtonElement>
  ) => {
    event.stopPropagation()

    const directoryId = this.getDirectoryIdFromEvent(event)
    if (directoryId !== null) {
      this.props.onDirectoryToggled(directoryId)
    }
  }

  private onDirectoryRowKeyDown = (
    event: React.KeyboardEvent<HTMLButtonElement>
  ) => {
    const expanded =
      event.currentTarget.getAttribute('aria-expanded') === 'true'
    const shouldToggle =
      event.key === 'Enter' ||
      event.key === ' ' ||
      (event.key === 'ArrowRight' && !expanded) ||
      (event.key === 'ArrowLeft' && expanded)

    if (!shouldToggle) {
      return
    }

    event.preventDefault()
    event.stopPropagation()

    const directoryId = this.getDirectoryIdFromEvent(event)
    if (directoryId !== null) {
      this.props.onDirectoryToggled(directoryId)
    }
  }

  private onDirectoryRowContextMenu = (
    event: React.MouseEvent<HTMLButtonElement>
  ) => {
    event.stopPropagation()

    const directoryId = this.getDirectoryIdFromEvent(event)
    if (directoryId !== null) {
      this.props.onDirectoryContextMenu(directoryId, event)
    }
  }

  private renderRow = (index: RowIndexPath) => {
    const visibleRows = this.visibleRows
    const row = visibleRows[index.row]
    const hasDirectoryRows = this.hasDirectoryRows(visibleRows)

    if (row === undefined) {
      return null
    }

    if (row.kind === 'directory') {
      return this.renderDirectoryRow(row)
    }

    // If every visible item is at the root, keep file rows aligned with the
    // flat list instead of adding tree-only indentation.
    const indentation = hasDirectoryRows ? row.depth * TreeIndent : 0
    const matches = this.getMatchesForDisplayPath(
      row.item.path,
      row.displayPath,
      row.item.matches
    )

    return (
      <div className="changes-tree-file-row">
        <TreeGuideLines depth={row.depth} />
        {this.props.renderFile(
          row.item.changeListItem,
          matches,
          indentation,
          row.displayPath
        )}
      </div>
    )
  }

  private onSelectionChanged = (
    selectedVisibleRows: ReadonlyArray<RowIndexPath>
  ) => {
    const visibleRows = this.visibleRows
    const selectedItems = new Array<IChangesListItem>()

    selectedVisibleRows.forEach(index => {
      const row = visibleRows[index.row]

      if (row?.kind === 'file') {
        selectedItems.push(row.item.changeListItem)
      }
    })

    this.props.onFileSelectionChanged(selectedItems)
  }

  private onRowClick = (index: RowIndexPath, source: ClickSource) => {
    const row = this.getFileRow(index)

    if (row !== null) {
      this.props.onFileClick(row.item.changeListItem, source)
    }
  }

  private onRowDoubleClick = (index: RowIndexPath, source: ClickSource) => {
    const row = this.getFileRow(index)

    if (row !== null) {
      this.props.onFileDoubleClick(row.item.changeListItem, source)
    }
  }

  private onRowKeyboardFocus = (
    index: RowIndexPath,
    event: React.KeyboardEvent<any>
  ) => {
    const row = this.getFileRow(index)

    if (row !== null) {
      this.props.onFileKeyboardFocus(row.item.changeListItem, event)
    }
  }

  private onRowBlur = (
    index: RowIndexPath,
    event: React.FocusEvent<HTMLDivElement>
  ) => {
    const row = this.getFileRow(index)

    if (row !== null) {
      this.props.onFileBlur(row.item.changeListItem, event)
    }
  }

  private onRowKeyDown = (
    index: RowIndexPath,
    event: React.KeyboardEvent<any>
  ) => {
    const row = this.getFileRow(index)

    if (row !== null) {
      this.props.onFileKeyDown(row.item.changeListItem, event)
    }
  }

  private onRowContextMenu = (
    index: RowIndexPath,
    event: React.MouseEvent<HTMLDivElement>
  ) => {
    const row = this.getFileRow(index)

    if (row !== null) {
      this.props.onFileContextMenu(row.item.changeListItem, event)
    }
  }

  private getRowAriaLabel = (index: RowIndexPath) => {
    const row = this.getFileRow(index)

    if (row === null) {
      return undefined
    }

    const { path, status } = row.item.changeListItem.change
    return `${path} ${status.kind}`
  }

  public onFilterKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    const visibleRows = this.visibleRows

    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      const index =
        event.key === 'ArrowDown'
          ? this.getFirstFileRowIndexPath(visibleRows)
          : this.getLastFileRowIndexPath(visibleRows)

      if (index !== null) {
        this.moveSelectionToFileRow(index)
      }

      event.preventDefault()
      return
    }

    if (event.key === 'Enter') {
      if (!/\S/.test(this.props.filterText)) {
        event.preventDefault()
        return
      }

      const index = this.getFirstFileRowIndexPath(visibleRows)
      const row = index === null ? null : this.getFileRow(index)

      if (row !== null) {
        this.props.onFileClick(row.item.changeListItem, {
          kind: 'keyboard',
          event,
        })
      }

      event.preventDefault()
    }
  }

  public render() {
    const visibleRows = this.visibleRows
    const selectedVisibleRows = this.getSelectedVisibleRows(
      visibleRows,
      this.props.selectedItems
    )
    const hasSelectedItemInFilterResults = this.hasSelectedItemInFilterResults(
      this.props.items,
      this.props.selectedItems
    )
    const selectFirstRowOnFocus =
      !hasSelectedItemInFilterResults || selectedVisibleRows.length > 0

    if (visibleRows.length === 0) {
      return this.props.renderNoItems()
    }

    return (
      <div className="filter-list changes-tree-list">
        <SectionList
          ref={this.listRef}
          id="changes-list"
          rowCount={[visibleRows.length]}
          rowRenderer={this.renderRow}
          rowHeight={this.props.rowHeight}
          selectedRows={selectedVisibleRows}
          // A collapsed directory can hide the selected file while leaving it in
          // the filter results. In that case, don't let focus pick a new first row.
          selectFirstRowOnFocus={selectFirstRowOnFocus}
          rowCustomClassNameMap={this.getDirectoryRowClassNameMap(visibleRows)}
          selectionMode="multi"
          canSelectRow={this.canSelectRow}
          onSelectionChanged={this.onSelectionChanged}
          onRowClick={this.onRowClick}
          onRowDoubleClick={this.onRowDoubleClick}
          onRowKeyboardFocus={this.onRowKeyboardFocus}
          onRowBlur={this.onRowBlur}
          onRowKeyDown={this.onRowKeyDown}
          onRowContextMenu={this.onRowContextMenu}
          onScroll={this.props.onScroll}
          setScrollTop={this.props.setScrollTop}
          getRowAriaLabel={this.getRowAriaLabel}
          invalidationProps={{
            visibleRows,
            focusedFileId: this.props.focusedFileId,
            availableWidth: this.props.availableWidth,
          }}
        />
      </div>
    )
  }
}

interface ITreeChangesListProps {
  readonly items: ReadonlyArray<IChangesListItem>
  readonly showChangesFilter: boolean
  readonly fileListFilter: IFileListFilterState
  readonly selectedItems: ReadonlyArray<IChangesListItem>
  readonly focusedFileId: string | null
  readonly collapsedDirectoryIds: ReadonlySet<string>
  readonly rowHeight: number
  readonly availableWidth: number
  readonly setScrollTop?: number
  readonly onDirectoryToggled: (directoryId: string) => void
  readonly onDirectoryContextMenu: (
    directoryPath: string,
    event: React.MouseEvent<HTMLButtonElement>
  ) => void
  readonly onFileSelectionChanged: (
    items: ReadonlyArray<IChangesListItem>
  ) => void
  readonly onFileClick: (item: IChangesListItem, source: ClickSource) => void
  readonly onFileDoubleClick: (
    item: IChangesListItem,
    source: ClickSource
  ) => void
  readonly onFileKeyboardFocus: (
    item: IChangesListItem,
    event: React.KeyboardEvent<any>
  ) => void
  readonly onFileBlur: (
    item: IChangesListItem,
    event: React.FocusEvent<HTMLDivElement>
  ) => void
  readonly onFileKeyDown: (
    item: IChangesListItem,
    event: React.KeyboardEvent<any>
  ) => void
  readonly onFileContextMenu: (
    item: IChangesListItem,
    event: React.MouseEvent<HTMLDivElement>
  ) => void
  readonly onFilterListResultsChanged?: (
    filterResultItems: ReadonlyArray<IChangesListItem>
  ) => void
  readonly onScroll: (scrollTop: number, clientHeight: number) => void
  readonly renderFile: (
    item: IChangesListItem,
    matches: IMatches,
    indentation: number,
    displayPath: string
  ) => JSX.Element | null
  readonly renderNoItems: () => JSX.Element | null
}

export class TreeChangesList extends React.Component<ITreeChangesListProps> {
  private readonly listViewRef = React.createRef<TreeChangesListView>()

  private getItemsWithMatches = memoizeOne(
    (
      items: ReadonlyArray<IChangesListItem>,
      showChangesFilter: boolean,
      fileListFilter: IFileListFilterState
    ): ReadonlyArray<IChangesListItemWithMatches> => {
      const itemsToMatch = items.filter(item =>
        applyFilters(item, showChangesFilter, fileListFilter)
      )

      const filter = showChangesFilter
        ? fileListFilter.filterText.toLowerCase()
        : ''

      if (filter.length === 0) {
        return itemsToMatch.map(item => ({
          item,
          matches: NoMatches,
        }))
      }

      return match(filter, itemsToMatch, item => item.text).map(
        ({ item, matches }) => ({ item, matches })
      )
    }
  )

  private getFilterResultItems = memoizeOne(
    (
      items: ReadonlyArray<IChangesListItemWithMatches>
    ): ReadonlyArray<IChangesListItem> => items.map(({ item }) => item)
  )

  private get itemsWithMatches() {
    return this.getItemsWithMatches(
      this.props.items,
      this.props.showChangesFilter,
      this.props.fileListFilter
    )
  }

  private get filterResultItems() {
    return this.getFilterResultItems(this.itemsWithMatches)
  }

  private hasSameIds(
    oldItems: ReadonlyArray<IChangesListItem>,
    newItems: ReadonlyArray<IChangesListItem>
  ) {
    if (oldItems.length !== newItems.length) {
      return false
    }

    return oldItems.every((item, index) => item.id === newItems[index].id)
  }

  private reportFilterListResultsChanged(
    previousItemsWithMatches?: ReadonlyArray<IChangesListItemWithMatches>
  ) {
    const { onFilterListResultsChanged } = this.props

    if (onFilterListResultsChanged === undefined) {
      return
    }

    const filterResultItems = this.filterResultItems

    if (previousItemsWithMatches !== undefined) {
      const previousFilterResultItems = this.getFilterResultItems(
        previousItemsWithMatches
      )

      if (this.hasSameIds(previousFilterResultItems, filterResultItems)) {
        return
      }
    }

    onFilterListResultsChanged(filterResultItems)
  }

  private selectFirstFilterResultIfSelectionIsFilteredOut() {
    if (
      !this.props.showChangesFilter ||
      this.props.fileListFilter.filterText.length === 0
    ) {
      return
    }

    const filterResultItems = this.filterResultItems

    if (filterResultItems.length === 0) {
      return
    }

    const hasSelectedItemInFilterResults = someItemHasSelectedId(
      filterResultItems,
      item => item.id,
      this.props.selectedItems
    )

    if (!hasSelectedItemInFilterResults) {
      this.props.onFileSelectionChanged([filterResultItems[0]])
    }
  }

  public componentDidMount() {
    this.reportFilterListResultsChanged()
  }

  public componentDidUpdate(prevProps: ITreeChangesListProps) {
    const previousItemsWithMatches = this.getItemsWithMatches(
      prevProps.items,
      prevProps.showChangesFilter,
      prevProps.fileListFilter
    )

    this.reportFilterListResultsChanged(previousItemsWithMatches)
    this.selectFirstFilterResultIfSelectionIsFilteredOut()
  }

  public onFilterKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    this.listViewRef.current?.onFilterKeyDown(event)
  }

  public render() {
    return (
      <TreeChangesListView
        ref={this.listViewRef}
        items={this.itemsWithMatches}
        filterText={
          this.props.showChangesFilter
            ? this.props.fileListFilter.filterText
            : ''
        }
        selectedItems={this.props.selectedItems}
        focusedFileId={this.props.focusedFileId}
        collapsedDirectoryIds={this.props.collapsedDirectoryIds}
        rowHeight={this.props.rowHeight}
        availableWidth={this.props.availableWidth}
        setScrollTop={this.props.setScrollTop}
        onDirectoryToggled={this.props.onDirectoryToggled}
        onDirectoryContextMenu={this.props.onDirectoryContextMenu}
        onFileSelectionChanged={this.props.onFileSelectionChanged}
        onFileClick={this.props.onFileClick}
        onFileDoubleClick={this.props.onFileDoubleClick}
        onFileKeyboardFocus={this.props.onFileKeyboardFocus}
        onFileBlur={this.props.onFileBlur}
        onFileKeyDown={this.props.onFileKeyDown}
        onFileContextMenu={this.props.onFileContextMenu}
        onScroll={this.props.onScroll}
        renderFile={this.props.renderFile}
        renderNoItems={this.props.renderNoItems}
      />
    )
  }
}
