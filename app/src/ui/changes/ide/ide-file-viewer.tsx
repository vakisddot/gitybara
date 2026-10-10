import * as React from 'react'
import * as Path from 'path'
import classNames from 'classnames'
import memoizeOne from 'memoize-one'
import { AutoSizer, Grid, GridCellProps } from 'react-virtualized'

import { Repository } from '../../../models/repository'
import { WorkingDirectoryFileChange } from '../../../models/status'
import { DiffType } from '../../../models/diff'
import { getWorkingDirectoryDiff } from '../../../lib/git/diff'
import { mapStatus } from '../../../lib/status'
import { highlight } from '../../../lib/highlighter/worker'
import { ITokens } from '../../../lib/highlighter/types'
import { formatBytes } from '../../lib/bytes'
import { Button } from '../../lib/button'
import { syntaxHighlightLine } from '../../diff/diff-helpers'
import { PathText } from '../../lib/path-text'
import { Octicon, iconForStatus } from '../../octicons'
import * as octicons from '../../octicons/octicons.generated'
import {
  IdeFileContents,
  isHighlightable,
  readIdeFileContents,
} from './ide-file-contents'
import { getFileIconName } from './ide-file-icons'
import { IdeIcon } from './ide-icon'
import {
  getFoldRanges,
  getFoldRangesByStart,
  getVisibleIndexOfLine,
  getVisibleLines,
  IFoldRange,
  pruneFoldedLines,
  unfoldBlocksHiding,
} from './ide-folding'
import { detectIndentUnit, getLineIndentation } from './ide-indentation'
import {
  getChangeGroupStarts,
  getLineChanges,
  ILineChanges,
  isSameLineChanges,
  NoLineChanges,
} from './ide-line-changes'

/** The height of a line in pixels, keep in sync with the styles. */
const LineHeight = 20

/** Room to the right of the longest line, in characters. */
const TrailingColumns = 4

/** Padding on each side of the line numbers, in pixels. */
const GutterPadding = 12

/** Padding to the left of the text of a line, keep in sync with the styles. */
const TextPadding = 12

/** The width of the column of the gutter with the buttons to fold blocks. */
const FoldColumnWidth = 16

/** How long to wait after the changes updated before reading the file again */
const ReloadDelay = 200

/** The characters of the sample used to measure the width of a character. */
const MeasureSample = '0'.repeat(100)

interface IIdeFileViewerProps {
  readonly repository: Repository

  /** The file to show, relative to the repository root. */
  readonly path: string | null

  /** The changed files, the file is read again when these change. */
  readonly changedFiles: ReadonlyArray<WorkingDirectoryFileChange>

  /** The width of a tab character, in characters. */
  readonly tabSize: number
}

interface IIdeFileViewerState {
  /** What is shown for the path, null while it's being read */
  readonly contents: IdeFileContents | null
  readonly failed: boolean

  /**
   * The syntax highlighting of the lines, by line index. It's null until the
   * highlighter is done, and for files that aren't highlighted.
   */
  readonly tokens: ITokens | null

  /** The lines that differ from the committed version, to mark in the gutter */
  readonly lineChanges: ILineChanges

  /**
   * The blocks that are folded, by the line they start on, with the text of
   * that line to tell if it's still the same block after the file changed.
   */
  readonly folded: ReadonlyMap<number, string>

  /** The width in pixels of a character in the monospace font. */
  readonly characterWidth: number
}

/** Read-only view of a file of the repository, without any of the diff. */
export class IdeFileViewer extends React.Component<
  IIdeFileViewerProps,
  IIdeFileViewerState
> {
  private unmounted = false
  private loadRequestId = 0
  private highlightRequestId = 0
  private reloadTimeoutId: number | null = null
  private measureRef = React.createRef<HTMLSpanElement>()
  private gridRef = React.createRef<Grid>()

  /** How far the lines are scrolled and how tall they are, in pixels */
  private scrollTop = 0
  private viewportHeight = 0

  /** Where the last jump to a change went, to continue from there */
  private lastJump: {
    readonly line: number
    readonly scrollTop: number
  } | null = null

  public constructor(props: IIdeFileViewerProps) {
    super(props)

    this.state = {
      contents: null,
      failed: false,
      tokens: null,
      lineChanges: NoLineChanges,
      folded: new Map<number, string>(),
      characterWidth: 7,
    }
  }

  public componentDidMount() {
    this.measureCharacterWidth()
    this.loadContents()
  }

  public componentDidUpdate(prevProps: IIdeFileViewerProps) {
    if (prevProps.path !== this.props.path) {
      // Don't keep showing the previous file while the new one is read
      this.highlightRequestId++
      this.lastJump = null
      this.setState({
        contents: null,
        failed: false,
        tokens: null,
        lineChanges: NoLineChanges,
        folded: new Map<number, string>(),
      })
      this.loadContents()
    } else if (prevProps.changedFiles !== this.props.changedFiles) {
      this.scheduleReload()
    }
  }

  public componentWillUnmount() {
    this.unmounted = true

    if (this.reloadTimeoutId !== null) {
      window.clearTimeout(this.reloadTimeoutId)
    }
  }

  private measureCharacterWidth() {
    const width = this.measureRef.current?.getBoundingClientRect().width

    if (width !== undefined && width > 0) {
      this.setState({ characterWidth: width / MeasureSample.length })
    }
  }

  private scheduleReload() {
    if (this.reloadTimeoutId !== null) {
      window.clearTimeout(this.reloadTimeoutId)
    }

    // Changes tend to arrive in bursts, for example while an agent is writing
    // files, so wait for them to settle before reading the file again.
    this.reloadTimeoutId = window.setTimeout(() => {
      this.reloadTimeoutId = null
      this.loadContents()
    }, ReloadDelay)
  }

  private async loadContents() {
    const { repository, path } = this.props
    const requestId = ++this.loadRequestId

    if (path === null) {
      return
    }

    try {
      const [contents, diffLineChanges] = await Promise.all([
        readIdeFileContents(repository, path),
        this.readLineChanges(this.getChange()),
      ])

      // Ignore the result if the component is gone or a newer request exists
      if (this.unmounted || requestId !== this.loadRequestId) {
        return
      }

      // The committed version of a deleted file has nothing to compare to
      const lineChanges =
        contents.kind === 'text' && !contents.isDeleted
          ? diffLineChanges
          : NoLineChanges

      const contentsChanged = !isSameContents(this.state.contents, contents)

      if (
        !contentsChanged &&
        isSameLineChanges(this.state.lineChanges, lineChanges)
      ) {
        return
      }

      this.setState(prevState => ({
        contents,
        lineChanges,
        failed: false,
        tokens: contentsChanged ? null : prevState.tokens,
        folded:
          contents.kind === 'text'
            ? pruneFoldedLines(
                prevState.folded,
                contents.lines,
                this.getFolding(contents.lines, this.props.tabSize).byStart
              )
            : new Map<number, string>(),
      }))

      if (contentsChanged) {
        this.highlightContents(contents)
      }
    } catch (e) {
      log.error(`Failed to read ${path} to show it`, e)

      if (!this.unmounted && requestId === this.loadRequestId) {
        this.setState({ contents: null, failed: true })
      }
    }
  }

  /** The lines of the file that differ from the committed version. */
  private async readLineChanges(
    change: WorkingDirectoryFileChange | undefined
  ): Promise<ILineChanges> {
    if (change === undefined) {
      return NoLineChanges
    }

    try {
      const diff = await getWorkingDirectoryDiff(this.props.repository, change)

      return diff.kind === DiffType.Text
        ? getLineChanges(diff.hunks)
        : NoLineChanges
    } catch (e) {
      // The file is still shown, only without the markers
      log.error(`Failed to get the changed lines of ${change.path}`, e)
      return NoLineChanges
    }
  }

  private async highlightContents(contents: IdeFileContents) {
    const { path, tabSize } = this.props

    if (
      path === null ||
      contents.kind !== 'text' ||
      !isHighlightable(contents.lines)
    ) {
      return
    }

    const requestId = ++this.highlightRequestId
    const allLines = contents.lines.map((_, index) => index)

    try {
      const tokens = await highlight(
        contents.lines,
        Path.basename(path),
        Path.extname(path),
        tabSize,
        allLines
      )

      // Ignore the result if the file changed or was replaced while it ran
      if (!this.unmounted && requestId === this.highlightRequestId) {
        this.setState({ tokens })
      }
    } catch (e) {
      // The file is still shown, only without the colors
      log.error(`Failed to highlight ${path}`, e)
    }
  }

  private getChange() {
    const { path, changedFiles } = this.props
    return changedFiles.find(file => file.path === path)
  }

  private getLines() {
    const { contents } = this.state
    return contents?.kind === 'text' ? contents.lines : null
  }

  private getChangeStarts = memoizeOne(getChangeGroupStarts)

  private getIndentation = memoizeOne(
    (lines: ReadonlyArray<string>, tabSize: number) => ({
      unit: detectIndentUnit(lines, tabSize),
      columns: getLineIndentation(lines, tabSize),
    })
  )

  /** The style that draws the indent guides in the indentation of a line. */
  private getIndentGuidesStyle(
    columns: number,
    unit: number
  ): React.CSSProperties | undefined {
    if (columns <= 0) {
      return undefined
    }

    const unitWidth = unit * this.state.characterWidth
    const guideCount = Math.ceil(columns / unit)
    const color = 'var(--ide-indent-guide-color)'

    // A 1px line at the start of each level of indentation, from the start of
    // the text to the end of the indentation.
    return {
      backgroundImage: `repeating-linear-gradient(to right, ${color} 0, ${color} 1px, transparent 1px, transparent ${unitWidth}px)`,
      backgroundSize: `${guideCount * unitWidth}px 100%`,
      backgroundPosition: `${TextPadding}px 0`,
      backgroundRepeat: 'no-repeat',
    }
  }

  private getFolding = memoizeOne(
    (lines: ReadonlyArray<string>, tabSize: number) => {
      const ranges = getFoldRanges(lines, tabSize)
      return { ranges, byStart: getFoldRangesByStart(ranges) }
    }
  )

  private getVisible = memoizeOne(
    (
      lineCount: number,
      byStart: ReadonlyMap<number, IFoldRange>,
      folded: ReadonlyMap<number, string>
    ) => getVisibleLines(lineCount, byStart, folded)
  )

  /** The lines of the file with which of them are shown and can be folded. */
  private getLayout() {
    const lines = this.getLines()

    if (lines === null) {
      return null
    }

    const folding = this.getFolding(lines, this.props.tabSize)
    const visible = this.getVisible(
      lines.length,
      folding.byStart,
      this.state.folded
    )

    return { lines, folding, visible }
  }

  private toggleFold(line: number) {
    const layout = this.getLayout()

    if (layout === null) {
      return
    }

    this.setState(prevState => {
      const folded = new Map(prevState.folded)

      if (folded.has(line)) {
        folded.delete(line)
      } else {
        folded.set(line, layout.lines[line])
      }

      return { folded }
    })
  }

  private onFoldAll = () => {
    const layout = this.getLayout()

    if (layout !== null) {
      this.setState({
        folded: new Map(
          layout.folding.ranges.map(range => [
            range.start,
            layout.lines[range.start],
          ])
        ),
      })
    }
  }

  private onUnfoldAll = () => this.setState({ folded: new Map() })

  /** The line that "next change" and "previous change" go on from. */
  private getReferenceLine(visible: ReadonlyArray<number>) {
    const jump = this.lastJump

    // Right after a jump, continue from the change that was jumped to
    if (jump !== null && Math.abs(this.scrollTop - jump.scrollTop) < 1) {
      return jump.line
    }

    const visibleRows = this.viewportHeight / LineHeight
    const row =
      Math.floor(this.scrollTop / LineHeight) + Math.floor(visibleRows / 3)

    return visible[Math.min(row, visible.length - 1)] ?? 0
  }

  /** Scroll so the line is a third of the way down, showing what is above. */
  private scrollToLine(line: number) {
    const layout = this.getLayout()

    if (layout === null) {
      return
    }

    const row = getVisibleIndexOfLine(layout.visible, line)
    const visibleRows = Math.floor(this.viewportHeight / LineHeight)
    const scrollTop = Math.max(
      0,
      (row - Math.floor(visibleRows / 3)) * LineHeight
    )

    this.lastJump = { line, scrollTop }
    this.gridRef.current?.scrollToPosition({ scrollLeft: 0, scrollTop })
  }

  private goToChange(direction: 1 | -1) {
    const layout = this.getLayout()

    if (layout === null) {
      return
    }

    const { lines, folding, visible } = layout
    const starts = this.getChangeStarts(this.state.lineChanges, lines.length)

    if (starts.length === 0) {
      return
    }

    const reference = this.getReferenceLine(visible)
    const target =
      direction === 1
        ? starts.find(start => start > reference) ?? starts[0]
        : [...starts].reverse().find(start => start < reference) ??
          starts[starts.length - 1]

    // Open the blocks that hide the change before scrolling to it
    const folded = unfoldBlocksHiding(
      this.state.folded,
      folding.byStart,
      target
    )

    if (folded === this.state.folded) {
      this.scrollToLine(target)
    } else {
      this.setState({ folded }, () => this.scrollToLine(target))
    }
  }

  private onPreviousChange = () => this.goToChange(-1)
  private onNextChange = () => this.goToChange(1)

  private onGridScroll = ({ scrollTop }: { readonly scrollTop: number }) => {
    this.scrollTop = scrollTop
  }

  private renderChangeNavigation() {
    const lines = this.getLines()

    if (
      lines === null ||
      this.getChangeStarts(this.state.lineChanges, lines.length).length === 0
    ) {
      return null
    }

    return (
      <div className="ide-file-viewer-header-buttons">
        <Button
          className="ide-file-viewer-header-button"
          onClick={this.onPreviousChange}
          tooltip="Previous change"
          ariaLabel="Go to the previous change"
        >
          <Octicon symbol={octicons.arrowUp} />
        </Button>
        <Button
          className="ide-file-viewer-header-button"
          onClick={this.onNextChange}
          tooltip="Next change"
          ariaLabel="Go to the next change"
        >
          <Octicon symbol={octicons.arrowDown} />
        </Button>
      </div>
    )
  }

  private renderFoldButtons() {
    const layout = this.getLayout()

    if (layout === null || layout.folding.ranges.length === 0) {
      return null
    }

    return (
      <div className="ide-file-viewer-header-buttons">
        <Button
          className="ide-file-viewer-header-button"
          onClick={this.onFoldAll}
          tooltip="Fold all blocks"
          ariaLabel="Fold all blocks"
        >
          <Octicon symbol={octicons.fold} />
        </Button>
        <Button
          className="ide-file-viewer-header-button"
          onClick={this.onUnfoldAll}
          tooltip="Unfold all blocks"
          ariaLabel="Unfold all blocks"
        >
          <Octicon symbol={octicons.unfold} />
        </Button>
      </div>
    )
  }

  private renderHeader(path: string) {
    const change = this.getChange()

    return (
      <div className="header">
        <IdeIcon name={getFileIconName(path)} />
        <span className="ide-file-viewer-path">
          <PathText path={path} />
        </span>
        {this.renderChangeNavigation()}
        {this.renderFoldButtons()}
        {change !== undefined && (
          <Octicon
            symbol={iconForStatus(change.status)}
            className={
              'status status-' + mapStatus(change.status).toLowerCase()
            }
            title={mapStatus(change.status)}
          />
        )}
      </div>
    )
  }

  private renderMessage(message: string) {
    return <div className="ide-file-viewer-message">{message}</div>
  }

  private renderLines(
    lines: ReadonlyArray<string>,
    isDeleted: boolean
  ): JSX.Element {
    if (lines.length === 0) {
      return this.renderMessage('This file is empty.')
    }

    return (
      <>
        {isDeleted && (
          <div className="ide-file-viewer-banner">
            This file was deleted. Showing the last committed version.
          </div>
        )}
        <div className="ide-file-viewer-lines cm-s-default">
          <AutoSizer>
            {({ width, height }) => this.renderGrid(lines, width, height)}
          </AutoSizer>
        </div>
      </>
    )
  }

  private getGutterWidth(lineCount: number) {
    return (
      lineCount.toString().length * this.state.characterWidth +
      GutterPadding +
      FoldColumnWidth +
      GutterPadding / 2
    )
  }

  private renderGrid(
    lines: ReadonlyArray<string>,
    width: number,
    height: number
  ) {
    const layout = this.getLayout()

    if (layout === null) {
      return null
    }

    const { visible } = layout
    const { characterWidth } = this.state
    this.viewportHeight = height
    const gutterWidth = this.getGutterWidth(lines.length)
    const longestLine = getLongestLineLength(lines, this.props.tabSize)
    const contentWidth =
      gutterWidth +
      GutterPadding +
      (longestLine + TrailingColumns) * characterWidth

    return (
      <Grid
        ref={this.gridRef}
        onScroll={this.onGridScroll}
        width={width}
        height={height}
        columnCount={1}
        columnWidth={Math.max(width, contentWidth)}
        rowCount={visible.length}
        rowHeight={LineHeight}
        overscanRowCount={20}
        // The grid hides what overflows its inner container by default, which
        // keeps the line numbers from sticking to the left when scrolling.
        containerStyle={{ overflow: 'visible' }}
        cellRenderer={(cell: GridCellProps) =>
          this.renderLine(cell, layout, gutterWidth)
        }
        // Makes the grid render the lines again when they change
        lines={lines}
        visible={visible}
        tokens={this.state.tokens}
        lineChanges={this.state.lineChanges}
        tabSize={this.props.tabSize}
        characterWidth={characterWidth}
        aria-label="File contents"
        tabIndex={0}
      />
    )
  }

  /** Whether any of the lines of a folded block have changes. */
  private hasChangesIn(range: IFoldRange) {
    const { added, modified, removedBefore } = this.state.lineChanges

    for (let line = range.start + 1; line <= range.end; line++) {
      if (added.has(line) || modified.has(line) || removedBefore.has(line)) {
        return true
      }
    }

    return false
  }

  private renderLine(
    { key, rowIndex, style }: GridCellProps,
    layout: NonNullable<ReturnType<IdeFileViewer['getLayout']>>,
    gutterWidth: number
  ) {
    const { lines, folding, visible } = layout
    const line = visible[rowIndex]
    const range = folding.byStart.get(line)
    const isFolded = range !== undefined && this.state.folded.has(line)

    const { added, modified, removedBefore } = this.state.lineChanges
    const isLast = line === lines.length - 1
    const indentation = this.getIndentation(lines, this.props.tabSize)

    // A folded block with changes in it shows them on the line it starts on
    const hasHiddenChanges =
      isFolded && range !== undefined && this.hasChangesIn(range)

    const numberClassName = classNames('ide-line-number', {
      'change-added': added.has(line),
      'change-modified': modified.has(line) || hasHiddenChanges,
      'change-removed-before': removedBefore.has(line),
      'change-removed-after': isLast && removedBefore.has(lines.length),
    })

    return (
      <div key={key} style={style} className="ide-line">
        <span className={numberClassName} style={{ width: gutterWidth }}>
          <span className="ide-line-number-text">{line + 1}</span>
          <span className="ide-line-fold-column">
            {range !== undefined && (
              <span
                className={classNames('ide-line-fold', { folded: isFolded })}
                role="button"
                aria-label={isFolded ? 'Unfold block' : 'Fold block'}
                aria-expanded={!isFolded}
                onClick={() => this.toggleFold(line)}
              >
                <Octicon
                  symbol={
                    isFolded ? octicons.chevronRight : octicons.chevronDown
                  }
                />
              </span>
            )}
          </span>
        </span>
        <span
          className="ide-line-text"
          style={this.getIndentGuidesStyle(
            indentation.columns[line],
            indentation.unit
          )}
        >
          {this.renderLineText(lines[line], this.state.tokens?.[line])}
          {isFolded && range !== undefined && (
            <span
              className="ide-fold-ellipsis"
              title={`${range.end - range.start} lines are folded`}
              onClick={() => this.toggleFold(line)}
            >
              …
            </span>
          )}
        </span>
      </div>
    )
  }

  private renderLineText(line: string, tokens: ITokens[number] | undefined) {
    return tokens === undefined ? line : syntaxHighlightLine(line, [tokens])
  }

  private renderBody(): JSX.Element | null {
    const { contents, failed } = this.state

    if (failed) {
      return this.renderMessage('Couldn’t read this file.')
    }

    if (contents === null) {
      return null
    }

    switch (contents.kind) {
      case 'text':
        return this.renderLines(contents.lines, contents.isDeleted)
      case 'binary':
        return this.renderMessage('This is a binary file, it can’t be shown.')
      case 'too-large':
        return this.renderMessage(
          `This file is too large to show (${formatBytes(contents.size)}).`
        )
      case 'not-a-file':
        return this.renderMessage(
          'This isn’t a file, so there is nothing to show.'
        )
      case 'missing':
        return this.renderMessage('This file no longer exists.')
    }
  }

  public render() {
    const { path } = this.props

    if (path === null) {
      return (
        <div className="diff-container ide-file-viewer">
          {this.renderMessage('Select a file to see its contents.')}
        </div>
      )
    }

    return (
      <div className="diff-container ide-file-viewer">
        {this.renderHeader(path)}
        {this.renderBody()}
        <span
          className="ide-file-viewer-measure"
          ref={this.measureRef}
          aria-hidden={true}
        >
          {MeasureSample}
        </span>
      </div>
    )
  }
}

function isSameContents(a: IdeFileContents | null, b: IdeFileContents) {
  if (a === null || a.kind !== b.kind) {
    return false
  }

  if (a.kind === 'text' && b.kind === 'text') {
    return (
      a.isDeleted === b.isDeleted &&
      a.lines.length === b.lines.length &&
      a.lines.every((line, i) => line === b.lines[i])
    )
  }

  return a.kind === 'too-large' && b.kind === 'too-large'
    ? a.size === b.size
    : true
}

/** The length of the longest line in characters, with tabs expanded. */
export function getLongestLineLength(
  lines: ReadonlyArray<string>,
  tabSize: number
) {
  let longest = 0

  for (const line of lines) {
    let length = line.length

    // Tabs are shown as `tabSize` characters wide, at most
    for (let i = line.indexOf('\t'); i !== -1; i = line.indexOf('\t', i + 1)) {
      length += tabSize - 1
    }

    longest = Math.max(longest, length)
  }

  return longest
}
