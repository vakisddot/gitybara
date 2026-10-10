import * as React from 'react'
import memoizeOne from 'memoize-one'
import { mapStatus } from '../../lib/status'

import { CommittedFileChange } from '../../models/status'
import { ClickSource, List } from '../lib/list'
import { SectionList } from '../lib/list/section-list'
import { RowIndexPath } from '../lib/list/list-row-index-path'
import { CommittedFileItem } from './committed-file-item'
import {
  buildChangesTreeRows,
  ChangesTreeRow,
  getAncestorDirectoryIds,
} from '../changes/tree/tree-changes-rows'
import {
  TreeChangesDirectoryRow,
  TreeGuideLines,
  TreeIndent,
} from '../changes/tree/tree-changes-directory-row'
import {
  pruneCollapsedTreeDirectoryIds,
  toggleCollapsedTreeDirectoryId,
} from '../changes/tree/tree-changes-state'

interface IFileListProps {
  readonly files: ReadonlyArray<CommittedFileChange>
  readonly showTree?: boolean
  readonly selectedFile: CommittedFileChange | null
  readonly onSelectedFileChanged: (file: CommittedFileChange) => void
  readonly onRowDoubleClick: (row: number, source: ClickSource) => void
  readonly availableWidth: number
  readonly onContextMenu?: (
    file: CommittedFileChange,
    event: React.MouseEvent<HTMLDivElement>
  ) => void
}

interface IFileListState {
  readonly focusedRow: number | null
  readonly collapsedDirectoryIds: ReadonlySet<string>
}

/**
 * Display a list of changed files as part of a commit or stash
 */
export class FileList extends React.Component<IFileListProps, IFileListState> {
  private getRows = memoizeOne(
    (
      files: ReadonlyArray<CommittedFileChange>,
      showTree: boolean,
      collapsedDirectoryIds: ReadonlySet<string>
    ): ReadonlyArray<ChangesTreeRow<CommittedFileChange>> =>
      showTree
        ? buildChangesTreeRows(files, collapsedDirectoryIds)
        : files.map(file => ({
            kind: 'file',
            id: file.id,
            item: file,
            depth: 0,
            displayPath: file.path,
          }))
  )

  public constructor(props: IFileListProps) {
    super(props)

    this.state = {
      focusedRow: null,
      collapsedDirectoryIds: new Set<string>(),
    }
  }

  public componentDidUpdate(prevProps: IFileListProps) {
    if (
      prevProps.files === this.props.files &&
      prevProps.selectedFile?.id === this.props.selectedFile?.id &&
      prevProps.showTree === this.props.showTree
    ) {
      return
    }

    const { files, selectedFile, showTree } = this.props
    let collapsedDirectoryIds = pruneCollapsedTreeDirectoryIds(
      this.state.collapsedDirectoryIds,
      files.map(file => file.path)
    )

    // Reveal selections made outside this list, such as switching commits.
    if (showTree && selectedFile !== null) {
      const ancestors = getAncestorDirectoryIds(selectedFile.path)
      if (ancestors.some(id => collapsedDirectoryIds.has(id))) {
        const expanded = new Set(collapsedDirectoryIds)
        ancestors.forEach(id => expanded.delete(id))
        collapsedDirectoryIds = expanded
      }
    }

    if (
      collapsedDirectoryIds !== this.state.collapsedDirectoryIds ||
      this.state.focusedRow !== null
    ) {
      this.setState({ collapsedDirectoryIds, focusedRow: null })
    }
  }

  private get visibleRows() {
    return this.getRows(
      this.props.files,
      this.props.showTree === true,
      this.state.collapsedDirectoryIds
    )
  }

  private onSelectedRowChanged = (row: number) => {
    const item = this.visibleRows[row]
    if (item?.kind === 'file') {
      this.props.onSelectedFileChanged(item.item)
    }
  }

  private renderFile = (row: number) => {
    const item = this.visibleRows[row]
    if (item.kind === 'directory') {
      return (
        <TreeChangesDirectoryRow
          row={item}
          matches={[]}
          availableWidth={this.props.availableWidth}
          onClick={this.onDirectoryClick}
          onKeyDown={this.onDirectoryKeyDown}
          onContextMenu={this.onDirectoryContextMenu}
        />
      )
    }

    const file = (
      <CommittedFileItem
        file={item.item}
        displayPath={item.displayPath}
        indentation={item.depth * TreeIndent}
        availableWidth={this.props.availableWidth}
        focused={this.state.focusedRow === row}
      />
    )

    if (!this.props.showTree) {
      return file
    }

    return (
      <div className="changes-tree-file-row">
        <TreeGuideLines depth={item.depth} />
        {file}
      </div>
    )
  }

  private selectedRowsForFile(): ReadonlyArray<number> {
    const { selectedFile: file } = this.props
    const fileIndex = file
      ? this.visibleRows.findIndex(
          row => row.kind === 'file' && row.item.path === file.path
        )
      : -1
    return fileIndex >= 0 ? [fileIndex] : []
  }

  private onRowContextMenu = (
    row: number,
    event: React.MouseEvent<HTMLDivElement>
  ) => {
    const item = this.visibleRows[row]
    if (item?.kind === 'file') {
      this.props.onContextMenu?.(item.item, event)
    }
  }

  private getFileAriaLabel = (row: number) => {
    const item = this.visibleRows[row]
    if (item.kind === 'directory') {
      // Keep the folder button exposed with its expanded state and label.
      return undefined
    }

    const file = item.item
    const { path, status } = file
    const fileStatus = mapStatus(status)
    return `${path} ${fileStatus}`
  }

  private onRowDoubleClick = (row: number, source: ClickSource) => {
    const item = this.visibleRows[row]
    if (item?.kind === 'file') {
      this.props.onRowDoubleClick(this.props.files.indexOf(item.item), source)
    }
  }

  private canSelectRow = (row: number) => this.visibleRows[row]?.kind === 'file'

  private toggleDirectory(directoryId: string) {
    this.setState(prev => ({
      collapsedDirectoryIds: toggleCollapsedTreeDirectoryId(
        prev.collapsedDirectoryIds,
        directoryId
      ),
      focusedRow: null,
    }))
  }

  private onDirectoryClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation()
    const id = event.currentTarget.getAttribute('data-directory-id')
    if (id !== null) {
      this.toggleDirectory(id)
    }
  }

  private onDirectoryKeyDown = (
    event: React.KeyboardEvent<HTMLButtonElement>
  ) => {
    const expanded =
      event.currentTarget.getAttribute('aria-expanded') === 'true'
    if (
      event.key === 'Enter' ||
      event.key === ' ' ||
      (event.key === 'ArrowRight' && !expanded) ||
      (event.key === 'ArrowLeft' && expanded)
    ) {
      event.preventDefault()
      event.stopPropagation()
      const id = event.currentTarget.getAttribute('data-directory-id')
      if (id !== null) {
        this.toggleDirectory(id)
      }
    }
  }

  private onDirectoryContextMenu = (
    event: React.MouseEvent<HTMLButtonElement>
  ) => {
    event.preventDefault()
    event.stopPropagation()
  }

  private renderTreeRow = (index: RowIndexPath) => this.renderFile(index.row)
  private canSelectTreeRow = (index: RowIndexPath) =>
    this.canSelectRow(index.row)
  private onSelectedTreeRowChanged = (index: RowIndexPath) =>
    this.onSelectedRowChanged(index.row)
  private onTreeRowDoubleClick = (index: RowIndexPath, source: ClickSource) =>
    this.onRowDoubleClick(index.row, source)
  private onTreeRowContextMenu = (
    index: RowIndexPath,
    event: React.MouseEvent<HTMLDivElement>
  ) => this.onRowContextMenu(index.row, event)
  private onTreeRowFocus = (index: RowIndexPath) => this.onRowFocus(index.row)
  private onTreeRowBlur = (index: RowIndexPath) => this.onRowBlur(index.row)
  private getTreeRowAriaLabel = (index: RowIndexPath) =>
    this.getFileAriaLabel(index.row)

  public render() {
    const visibleRows = this.visibleRows
    const directories = visibleRows.flatMap((row, index) =>
      row.kind === 'directory' ? [index] : []
    )
    const selectedRows = this.selectedRowsForFile()
    const invalidationProps = {
      focusedRow: this.state.focusedRow,
      visibleRows,
      availableWidth: this.props.availableWidth,
    }

    return this.props.showTree ? (
      <div className="file-list changes-list-container">
        <div className="filter-list changes-tree-list">
          <SectionList
            rowRenderer={this.renderTreeRow}
            rowCount={[visibleRows.length]}
            rowHeight={29}
            selectedRows={selectedRows.map(row => ({ section: 0, row }))}
            selectFirstRowOnFocus={
              this.props.selectedFile === null || selectedRows.length > 0
            }
            canSelectRow={this.canSelectTreeRow}
            rowCustomClassNameMap={
              new Map([
                [
                  'changes-tree-directory-list-item',
                  directories.map(row => ({ section: 0, row })),
                ],
              ])
            }
            onSelectedRowChanged={this.onSelectedTreeRowChanged}
            onRowDoubleClick={this.onTreeRowDoubleClick}
            onRowContextMenu={this.onTreeRowContextMenu}
            onRowKeyboardFocus={this.onTreeRowFocus}
            onRowBlur={this.onTreeRowBlur}
            getRowAriaLabel={this.getTreeRowAriaLabel}
            invalidationProps={invalidationProps}
          />
        </div>
      </div>
    ) : (
      <div className="file-list">
        <List
          rowRenderer={this.renderFile}
          rowCount={visibleRows.length}
          rowHeight={29}
          selectedRows={selectedRows}
          onSelectedRowChanged={this.onSelectedRowChanged}
          onRowDoubleClick={this.onRowDoubleClick}
          onRowContextMenu={this.onRowContextMenu}
          onRowKeyboardFocus={this.onRowFocus}
          onRowBlur={this.onRowBlur}
          getRowAriaLabel={this.getFileAriaLabel}
          invalidationProps={invalidationProps}
        />
      </div>
    )
  }

  private onRowFocus = (row: number) => {
    this.setState({ focusedRow: row })
  }

  private onRowBlur = (row: number) => {
    if (this.state.focusedRow === row) {
      this.setState({ focusedRow: null })
    }
  }
}
