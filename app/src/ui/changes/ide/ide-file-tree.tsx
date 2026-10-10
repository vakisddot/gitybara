import * as React from 'react'
import memoizeOne from 'memoize-one'

import { Repository } from '../../../models/repository'
import { WorkingDirectoryFileChange } from '../../../models/status'
import { getRepositoryFilePaths } from '../../../lib/git/ls-files'
import { mapStatus } from '../../../lib/status'
import { SectionList } from '../../lib/list/section-list'
import { RowIndexPath } from '../../lib/list/list-row-index-path'
import { PathLabel } from '../../lib/path-label'
import { PathText } from '../../lib/path-text'
import { TooltipDirection } from '../../lib/tooltip'
import { TooltippedContent } from '../../lib/tooltipped-content'
import { Octicon, iconForStatus } from '../../octicons'
import {
  buildChangesTreeRows,
  ChangesTreeRow,
  getChangesTreeDirectoryIds,
  IChangesTreeFileItem,
} from '../tree/tree-changes-rows'
import {
  TreeChangesDirectoryRow,
  TreeGuideLines,
  TreeIndent,
} from '../tree/tree-changes-directory-row'
import { getDisplayStatus } from '../changed-file'
import {
  getChangedFileCountByDirectory,
  getCollapsedIdeDirectoryIds,
  getDirectoriesContainingPaths,
  mergeFilePaths,
  toggleIdeDirectory,
} from './ide-file-tree-state'

type IdeTreeRow = ChangesTreeRow<IChangesTreeFileItem>
type IdeTreeDirectoryRow = Extract<IdeTreeRow, { kind: 'directory' }>

/** How long to wait after the changes updated before listing files again */
const ReloadDelay = 300

const NoMatches: ReadonlyArray<number> = []

interface IIdeFileTreeProps {
  readonly repository: Repository

  /**
   * The files that have changes. Used to show which of the files in the
   * repository were added, modified, deleted and so on.
   */
  readonly changedFiles: ReadonlyArray<WorkingDirectoryFileChange>
  readonly rowHeight: number
  readonly availableWidth: number
}

interface IIdeFileTreeState {
  /** Every file in the repository, or null until they've been listed */
  readonly repositoryPaths: ReadonlyArray<string> | null
  readonly loadFailed: boolean
  readonly expandedDirectoryIds: ReadonlySet<string>
  readonly selectedPath: string | null
}

/**
 * A tree of every file in the repository, with the changed files marked by
 * their status. It's the file explorer of the IDE view.
 */
export class IdeFileTree extends React.Component<
  IIdeFileTreeProps,
  IIdeFileTreeState
> {
  private unmounted = false
  private loadRequestId = 0
  private reloadTimeoutId: number | null = null

  public constructor(props: IIdeFileTreeProps) {
    super(props)

    this.state = {
      repositoryPaths: null,
      loadFailed: false,
      expandedDirectoryIds: new Set<string>(),
      selectedPath: null,
    }
  }

  public componentDidMount() {
    this.loadRepositoryPaths()
  }

  public componentDidUpdate(prevProps: IIdeFileTreeProps) {
    if (prevProps.changedFiles !== this.props.changedFiles) {
      this.scheduleReload()
    }
  }

  public componentWillUnmount() {
    this.unmounted = true

    if (this.reloadTimeoutId !== null) {
      window.clearTimeout(this.reloadTimeoutId)
    }
  }

  private scheduleReload() {
    if (this.reloadTimeoutId !== null) {
      window.clearTimeout(this.reloadTimeoutId)
    }

    // Changes tend to arrive in bursts, for example while an agent is writing
    // files, so wait for them to settle before listing the files again.
    this.reloadTimeoutId = window.setTimeout(() => {
      this.reloadTimeoutId = null
      this.loadRepositoryPaths()
    }, ReloadDelay)
  }

  private async loadRepositoryPaths() {
    const requestId = ++this.loadRequestId

    try {
      const repositoryPaths = await getRepositoryFilePaths(
        this.props.repository
      )

      // Ignore the result if the component is gone or a newer request exists
      if (this.unmounted || requestId !== this.loadRequestId) {
        return
      }

      this.setState(prevState => {
        const previousPaths = prevState.repositoryPaths

        if (
          previousPaths !== null &&
          previousPaths.length === repositoryPaths.length &&
          previousPaths.every((path, i) => path === repositoryPaths[i])
        ) {
          return null
        }

        // The first time, open the directories that have changes so the
        // changed files are visible without having to look for them.
        const expandedDirectoryIds =
          previousPaths === null
            ? getDirectoriesContainingPaths(this.changedPaths)
            : prevState.expandedDirectoryIds

        return { repositoryPaths, loadFailed: false, expandedDirectoryIds }
      })
    } catch (e) {
      log.error('Failed to list the files in the repository', e)

      if (!this.unmounted && requestId === this.loadRequestId) {
        this.setState({ repositoryPaths: [], loadFailed: true })
      }
    }
  }

  private getChangedPaths = memoizeOne(
    (changedFiles: ReadonlyArray<WorkingDirectoryFileChange>) =>
      changedFiles.map(file => file.path)
  )

  private get changedPaths() {
    return this.getChangedPaths(this.props.changedFiles)
  }

  private getChangesByPath = memoizeOne(
    (changedFiles: ReadonlyArray<WorkingDirectoryFileChange>) =>
      new Map(changedFiles.map(file => [file.path, file]))
  )

  private getChangedFileCounts = memoizeOne(getChangedFileCountByDirectory)

  private getFileItems = memoizeOne(
    (
      repositoryPaths: ReadonlyArray<string>,
      changedPaths: ReadonlyArray<string>
    ): ReadonlyArray<IChangesTreeFileItem> =>
      mergeFilePaths(repositoryPaths, changedPaths).map(path => ({
        id: path,
        path,
      }))
  )

  private getDirectoryIds = memoizeOne(
    (fileItems: ReadonlyArray<IChangesTreeFileItem>) =>
      getChangesTreeDirectoryIds(fileItems)
  )

  private getRows = memoizeOne(
    (
      fileItems: ReadonlyArray<IChangesTreeFileItem>,
      expandedDirectoryIds: ReadonlySet<string>
    ): ReadonlyArray<IdeTreeRow> =>
      buildChangesTreeRows(
        fileItems,
        getCollapsedIdeDirectoryIds(
          this.getDirectoryIds(fileItems),
          expandedDirectoryIds
        )
      )
  )

  private getVisibleRows(): ReadonlyArray<IdeTreeRow> {
    const { repositoryPaths, expandedDirectoryIds } = this.state

    if (repositoryPaths === null) {
      return []
    }

    return this.getRows(
      this.getFileItems(repositoryPaths, this.changedPaths),
      expandedDirectoryIds
    )
  }

  private getSelectedRows = memoizeOne(
    (
      visibleRows: ReadonlyArray<IdeTreeRow>,
      selectedPath: string | null
    ): ReadonlyArray<RowIndexPath> => {
      const index =
        selectedPath === null
          ? -1
          : visibleRows.findIndex(
              row => row.kind === 'file' && row.item.path === selectedPath
            )

      return index === -1 ? [] : [{ section: 0, row: index }]
    }
  )

  private getDirectoryRowClassNameMap = memoizeOne(
    (visibleRows: ReadonlyArray<IdeTreeRow>) => {
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

  private canSelectRow = (index: RowIndexPath) => {
    return this.getVisibleRows()[index.row]?.kind === 'file'
  }

  private onSelectionChanged = (selectedRows: ReadonlyArray<RowIndexPath>) => {
    const row =
      selectedRows.length > 0
        ? this.getVisibleRows()[selectedRows[0].row]
        : undefined

    if (row?.kind === 'file') {
      this.setState({ selectedPath: row.item.path })
    }
  }

  private getDirectoryIdFromEvent(
    event:
      | React.MouseEvent<HTMLButtonElement>
      | React.KeyboardEvent<HTMLButtonElement>
  ) {
    return event.currentTarget.getAttribute('data-directory-id')
  }

  private toggleDirectory(directoryId: string | null) {
    if (directoryId !== null) {
      this.setState(prevState => ({
        expandedDirectoryIds: toggleIdeDirectory(
          prevState.expandedDirectoryIds,
          directoryId
        ),
      }))
    }
  }

  private onDirectoryRowClick = (
    event: React.MouseEvent<HTMLButtonElement>
  ) => {
    event.stopPropagation()
    this.toggleDirectory(this.getDirectoryIdFromEvent(event))
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

    if (shouldToggle) {
      event.preventDefault()
      event.stopPropagation()
      this.toggleDirectory(this.getDirectoryIdFromEvent(event))
    }
  }

  private onDirectoryRowContextMenu = (
    event: React.MouseEvent<HTMLButtonElement>
  ) => {
    event.stopPropagation()
  }

  private renderDirectoryRow(row: IdeTreeDirectoryRow) {
    // The count on a directory is how many changed files it contains, it's
    // left out when there are none.
    const changedFileCount = this.getChangedFileCounts(this.changedPaths).get(
      row.path
    )

    return (
      <TreeChangesDirectoryRow
        row={{ ...row, fileCount: changedFileCount ?? 0 }}
        matches={NoMatches}
        availableWidth={this.props.availableWidth}
        onClick={this.onDirectoryRowClick}
        onKeyDown={this.onDirectoryRowKeyDown}
        onContextMenu={this.onDirectoryRowContextMenu}
      />
    )
  }

  private renderFileRow(path: string, displayPath: string, depth: number) {
    const change = this.getChangesByPath(this.props.changedFiles).get(path)
    const indentation = depth * TreeIndent

    const listItemPadding = 10 * 2
    const statusWidth = 16
    const filePadding = 5
    const availablePathWidth =
      this.props.availableWidth -
      listItemPadding -
      indentation -
      filePadding -
      statusWidth

    if (change === undefined) {
      return (
        <div
          className="file ide-file"
          style={{ paddingLeft: `calc(var(--spacing) + ${indentation}px)` }}
        >
          <PathText path={displayPath} availableWidth={availablePathWidth} />
        </div>
      )
    }

    const fileStatus = mapStatus(change.status)

    return (
      <div
        className="file ide-file"
        style={{ paddingLeft: `calc(var(--spacing) + ${indentation}px)` }}
      >
        <PathLabel
          path={displayPath}
          status={getDisplayStatus(change.status, path, displayPath)}
          availableWidth={availablePathWidth}
          ariaHidden={true}
        />
        <TooltippedContent
          tooltip={fileStatus}
          direction={TooltipDirection.EAST}
        >
          <Octicon
            symbol={iconForStatus(change.status)}
            className={'status status-' + fileStatus.toLowerCase()}
          />
        </TooltippedContent>
      </div>
    )
  }

  private renderRow = (index: RowIndexPath) => {
    const row = this.getVisibleRows()[index.row]

    if (row === undefined) {
      return null
    }

    if (row.kind === 'directory') {
      return this.renderDirectoryRow(row)
    }

    return (
      <div className="changes-tree-file-row">
        <TreeGuideLines depth={row.depth} />
        {this.renderFileRow(row.item.path, row.displayPath, row.depth)}
      </div>
    )
  }

  private getRowAriaLabel = (index: RowIndexPath) => {
    const row = this.getVisibleRows()[index.row]

    if (row?.kind !== 'file') {
      return undefined
    }

    const change = this.getChangesByPath(this.props.changedFiles).get(
      row.item.path
    )

    return change === undefined
      ? row.item.path
      : `${row.item.path} ${mapStatus(change.status)}`
  }

  public render() {
    const { repositoryPaths, loadFailed, selectedPath } = this.state

    if (repositoryPaths === null) {
      return <div className="ide-file-tree-message">Loading files…</div>
    }

    if (loadFailed) {
      return (
        <div className="ide-file-tree-message">
          Couldn’t list the files in this repository.
        </div>
      )
    }

    const visibleRows = this.getVisibleRows()

    if (visibleRows.length === 0) {
      return <div className="ide-file-tree-message">No files found.</div>
    }

    return (
      <div className="filter-list changes-tree-list ide-file-tree">
        <SectionList
          id="ide-file-list"
          rowCount={[visibleRows.length]}
          rowRenderer={this.renderRow}
          rowHeight={this.props.rowHeight}
          selectedRows={this.getSelectedRows(visibleRows, selectedPath)}
          selectionMode="single"
          canSelectRow={this.canSelectRow}
          rowCustomClassNameMap={this.getDirectoryRowClassNameMap(visibleRows)}
          onSelectionChanged={this.onSelectionChanged}
          getRowAriaLabel={this.getRowAriaLabel}
          invalidationProps={{
            visibleRows,
            changedFiles: this.props.changedFiles,
            availableWidth: this.props.availableWidth,
          }}
        />
      </div>
    )
  }
}
