import * as React from 'react'
import memoizeOne from 'memoize-one'

import {
  getBoolean,
  getNumber,
  setBoolean,
  setNumber,
} from '../../../lib/local-storage'
import { Repository } from '../../../models/repository'
import { WorkingDirectoryFileChange } from '../../../models/status'
import { AppFileStatus } from '../../../models/status'
import { DiffType, IDiff } from '../../../models/diff'
import { getWorkingDirectoryDiff } from '../../../lib/git/diff'
import { mapStatus } from '../../../lib/status'
import { formatBytes } from '../../lib/bytes'
import { Button } from '../../lib/button'
import { PathText } from '../../lib/path-text'
import { AriaLiveContainer } from '../../accessibility/aria-live-container'
import { DiffSearchInput } from '../../diff/diff-search-input'
import { Octicon, iconForStatus } from '../../octicons'
import * as octicons from '../../octicons/octicons.generated'
import { IdeCodeEditor } from './ide-code-editor'
import { PreviousLinesMode } from './ide-previous-lines'
import {
  IdeFileContents,
  isHighlightable,
  readCommitFileContents,
  readIdeFileContents,
  writeIdeFileLines,
} from './ide-file-contents'
import { getFileIconName } from './ide-file-icons'
import { IdeIcon } from './ide-icon'
import { getFoldRanges } from './ide-folding'
import { getIdeShortcut } from './ide-shortcuts'
import {
  getChangeGroupStarts,
  getLineChanges,
  ILineChanges,
  isSameLineChanges,
  NoLineChanges,
} from './ide-line-changes'

/** How long to wait after the changes updated before reading the file again */
const ReloadDelay = 200

const HighlightChangesKey = 'ide-highlight-changes'
const UnchangedTextOpacityKey = 'ide-unchanged-text-opacity'
const HoverPreviousLinesKey = 'ide-hover-previous-lines'

/** Edits that weren't saved and the text of the file they were made to. */
interface IDraft {
  readonly text: string
  readonly base: string
}

/**
 * The edits that weren't saved, by repository and file. They are kept when
 * another file is shown, or when the viewer goes away, so that they aren't lost.
 */
const unsavedDrafts = new Map<string, IDraft>()

const getDraftKey = (repository: Repository, path: string) =>
  `${repository.path}\0${path}`

/** A commit to show the file of, instead of the working directory. */
export interface IIdeFileViewerCommit {
  readonly sha: string

  /** The diff of the file, to mark the lines that changed */
  readonly diff: IDiff | null
  readonly status: AppFileStatus
}

interface IIdeFileViewerProps {
  readonly repository: Repository

  /** The file to show, relative to the repository root. */
  readonly path: string | null

  /** The changed files, the file is read again when these change. */
  readonly changedFiles: ReadonlyArray<WorkingDirectoryFileChange>

  /** The width of a tab character, in characters. */
  readonly tabSize: number

  /** Shown at the end of the header, for the options of the view */
  readonly headerExtras?: React.ReactNode

  /** Whether the file can't be edited, which also leaves out unsaved edits */
  readonly readOnly?: boolean

  /**
   * Show the file as it was in this commit. The file is then never read again
   * and the changed files aren't looked at.
   */
  readonly commit?: IIdeFileViewerCommit
}

interface IIdeFileViewerState {
  /** What is shown for the path, null while it's being read */
  readonly contents: IdeFileContents | null

  /** The path that the contents are of */
  readonly contentsPath: string | null
  readonly failed: boolean

  /** The lines that differ from the committed version, to mark in the gutter */
  readonly lineChanges: ILineChanges

  /** Goes up when the editor has to take the text of the file again */
  readonly revision: number

  /** What was typed in the file and not saved, when the editor is opened */
  readonly draft: string | null

  /** Whether the text in the editor differs from the saved text */
  readonly isDirty: boolean

  /** The file changed on disk while there were edits that weren't saved. */
  readonly changedOnDisk: boolean
  readonly saveError: string | null

  /** Whether the lines that have changes have a color in the background */
  readonly highlightChanges: boolean

  /** How visible unchanged text is, as a percentage */
  readonly unchangedTextOpacity: number
  readonly previousLinesMode: PreviousLinesMode

  /** Whether the box to search the file is shown, and what it announced */
  readonly isSearching: boolean
  readonly searchMessage: string
}

/** A file of the repository to read and edit, without any of the diff. */
export class IdeFileViewer extends React.Component<
  IIdeFileViewerProps,
  IIdeFileViewerState
> {
  private unmounted = false
  private loadRequestId = 0
  private reloadTimeoutId: number | null = null
  private editorRef = React.createRef<IdeCodeEditor>()

  /** Flips when the search has something to announce, even if it's the same */
  private searchAnnouncementSignal = false

  /** What was read last, which isn't shown while there are unsaved edits */
  private latest: {
    readonly contents: IdeFileContents
    readonly lineChanges: ILineChanges
  } | null = null

  public constructor(props: IIdeFileViewerProps) {
    super(props)

    this.state = {
      contents: null,
      contentsPath: null,
      failed: false,
      lineChanges: NoLineChanges,
      revision: 0,
      draft: null,
      isDirty: false,
      changedOnDisk: false,
      saveError: null,
      highlightChanges: getBoolean(HighlightChangesKey, false),
      previousLinesMode: getBoolean(HoverPreviousLinesKey, false)
        ? 'hover'
        : 'ghost',
      unchangedTextOpacity: Math.max(
        0,
        Math.min(100, getNumber(UnchangedTextOpacityKey, 100))
      ),
      isSearching: false,
      searchMessage: '',
    }
  }

  public componentDidMount() {
    document.addEventListener('keydown', this.onKeyDown)

    // The Find menu item, see app.tsx
    document.addEventListener('find-text', this.showSearch)

    this.loadContents()
  }

  public getSnapshotBeforeUpdate(prevProps: IIdeFileViewerProps) {
    // The editor still has the text of the previous file, keep the edits
    if (prevProps.path !== this.props.path) {
      this.keepUnsavedEdits(prevProps.repository, prevProps.path)
    }

    return null
  }

  public componentDidUpdate(prevProps: IIdeFileViewerProps) {
    if (
      prevProps.path !== this.props.path ||
      prevProps.commit?.sha !== this.props.commit?.sha
    ) {
      // Don't keep showing the previous file while the new one is read
      this.latest = null
      this.setState({
        contents: null,
        contentsPath: null,
        failed: false,
        lineChanges: NoLineChanges,
        draft: null,
        isDirty: false,
        changedOnDisk: false,
        saveError: null,
        isSearching: false,
        searchMessage: '',
      })
      this.loadContents()
    } else if (prevProps.commit?.diff !== this.props.commit?.diff) {
      this.loadContents()
    } else if (
      this.props.commit === undefined &&
      prevProps.changedFiles !== this.props.changedFiles
    ) {
      this.scheduleReload()
    }
  }

  public componentWillUnmount() {
    document.removeEventListener('keydown', this.onKeyDown)
    document.removeEventListener('find-text', this.showSearch)
    this.unmounted = true
    this.keepUnsavedEdits(this.props.repository, this.props.path)

    if (this.reloadTimeoutId !== null) {
      window.clearTimeout(this.reloadTimeoutId)
    }
  }

  private keepUnsavedEdits(repository: Repository, path: string | null) {
    const editor = this.editorRef.current
    const { contents, isDirty } = this.state

    if (
      path === null ||
      editor === null ||
      !isDirty ||
      contents?.kind !== 'text'
    ) {
      return
    }

    unsavedDrafts.set(getDraftKey(repository, path), {
      text: editor.getLines().join('\n'),
      base: contents.lines.join('\n'),
    })
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
      const { commit } = this.props
      const [contents, diffLineChanges] = await Promise.all([
        commit === undefined
          ? readIdeFileContents(repository, path)
          : readCommitFileContents(repository, commit.sha, path),
        commit === undefined
          ? this.readLineChanges(this.getChange())
          : getLineChangesOfDiff(commit.diff),
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

      this.latest = { contents, lineChanges }

      const { state } = this
      const isOpened = state.contentsPath === path
      const contentsChanged =
        !isOpened || !isSameContents(state.contents, contents)

      // Edits that weren't saved stay in the editor, the user decides what to
      // do about the file having changed
      if (isOpened && state.isDirty) {
        if (contentsChanged) {
          this.setState({ changedOnDisk: true })
        }

        return
      }

      if (
        !contentsChanged &&
        isSameLineChanges(state.lineChanges, lineChanges)
      ) {
        return
      }

      this.showContents(contents, lineChanges, contentsChanged, path)
    } catch (e) {
      log.error(`Failed to read ${path} to show it`, e)

      if (!this.unmounted && requestId === this.loadRequestId) {
        this.setState({ contents: null, contentsPath: null, failed: true })
      }
    }
  }

  private showContents(
    contents: IdeFileContents,
    lineChanges: ILineChanges,
    contentsChanged: boolean,
    path: string
  ) {
    const { repository } = this.props
    const draftKey = getDraftKey(repository, path)
    const draft =
      this.state.contentsPath === path || this.props.readOnly
        ? undefined
        : unsavedDrafts.get(draftKey)

    this.setState(prevState => ({
      contents,
      contentsPath: path,
      lineChanges,
      failed: false,
      revision: contentsChanged ? prevState.revision + 1 : prevState.revision,
      draft: draft?.text ?? null,
      // The edits of the draft were made to another version of the file
      changedOnDisk:
        draft !== undefined &&
        contents.kind === 'text' &&
        draft.base !== contents.lines.join('\n'),
    }))
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

  private getChange() {
    const { path, changedFiles } = this.props
    return changedFiles.find(file => file.path === path)
  }

  private getStatus() {
    return this.props.commit?.status ?? this.getChange()?.status
  }

  private getLines() {
    const { contents } = this.state
    return contents?.kind === 'text' ? contents.lines : null
  }

  private getChangeStarts = memoizeOne(getChangeGroupStarts)

  private getFoldRangeCount = memoizeOne(
    (lines: ReadonlyArray<string>, tabSize: number) =>
      getFoldRanges(lines, tabSize).length
  )

  private getEditorText = memoizeOne((lines: ReadonlyArray<string>) =>
    lines.join('\n')
  )

  private onDirtyChange = (isDirty: boolean) => {
    const { repository, path } = this.props

    if (path !== null && !isDirty) {
      unsavedDrafts.delete(getDraftKey(repository, path))
    }

    this.setState({ isDirty })
  }

  private onSave = async () => {
    const { repository, path } = this.props
    const { contents, isDirty } = this.state
    const editor = this.editorRef.current

    if (
      path === null ||
      editor === null ||
      !isDirty ||
      contents?.kind !== 'text' ||
      contents.isDeleted
    ) {
      return
    }

    const { lines, generation } = editor.getSnapshot()

    try {
      await writeIdeFileLines(repository, path, lines, contents.format)
    } catch (e) {
      log.error(`Failed to save ${path}`, e)

      if (!this.unmounted && this.props.path === path) {
        this.setState({ saveError: `Couldn’t save the file: ${e.message}` })
      }

      return
    }

    if (this.unmounted || this.props.path !== path) {
      return
    }

    // What was read from the file is what was just written to it
    this.setState({
      contents: { ...contents, lines },
      changedOnDisk: false,
      saveError: null,
    })
    this.editorRef.current?.markSaved(generation)
    this.scheduleReload()
  }

  /** Take what is in the file now, and let go of the unsaved edits. */
  private onReloadFromDisk = () => {
    const { path } = this.props

    if (this.latest !== null && path !== null) {
      unsavedDrafts.delete(getDraftKey(this.props.repository, path))
      this.showContents(
        this.latest.contents,
        this.latest.lineChanges,
        true,
        path
      )
      this.setState({ draft: null, isDirty: false, changedOnDisk: false })
    }
  }

  /** Go on with the unsaved edits, they replace the file when saved. */
  private onKeepEdits = () => {
    this.setState(prevState => ({
      changedOnDisk: false,
      contents: this.latest?.contents ?? prevState.contents,
    }))
  }

  /** Go to the next or previous change. Returns false if there isn't one. */
  private goToChange(direction: 1 | -1) {
    const lines = this.getLines()
    const editor = this.editorRef.current

    if (lines === null || editor === null) {
      return false
    }

    const starts = this.getChangeStarts(this.state.lineChanges, lines.length)

    if (starts.length === 0) {
      return false
    }

    const reference = editor.getReferenceLine()
    const target =
      direction === 1
        ? starts.find(start => start > reference) ?? starts[0]
        : [...starts].reverse().find(start => start < reference) ??
          starts[starts.length - 1]

    editor.revealLine(target)
    return true
  }

  /** Whether the editor takes no typing, because of how it's shown. */
  private isEditorReadOnly() {
    const { contents } = this.state

    return (
      this.props.readOnly === true ||
      (contents?.kind === 'text' && contents.isDeleted)
    )
  }

  private onKeyDown = (event: KeyboardEvent) => {
    switch (getIdeShortcut(event, this.isEditorReadOnly())) {
      case 'find':
        if (this.showSearch()) {
          event.preventDefault()
        }
        break
      case 'previous-change':
        if (this.goToChange(-1)) {
          event.preventDefault()
        }
        break
      case 'next-change':
        if (this.goToChange(1)) {
          event.preventDefault()
        }
        break
    }
  }

  /** Show the box to search the file, when there is text to search in. */
  private showSearch = () => {
    if (this.getLines() === null) {
      return false
    }

    if (!this.state.isSearching) {
      this.setState({ isSearching: true, searchMessage: '' })
    }

    return true
  }

  private onSearch = (query: string, direction: 'next' | 'previous') => {
    const position = this.editorRef.current?.search(query, direction)

    if (position === undefined) {
      return
    }

    this.searchAnnouncementSignal = !this.searchAnnouncementSignal
    this.setState({
      searchMessage:
        position === null
          ? `No results for “${query}”`
          : `Result ${position.index + 1} of ${position.total} for “${query}”`,
    })
  }

  private onSearchClose = () => {
    this.editorRef.current?.clearSearch()
    this.setState({ isSearching: false, searchMessage: '' })
  }

  private onToggleHighlightChanges = () => {
    const highlightChanges = !this.state.highlightChanges

    setBoolean(HighlightChangesKey, highlightChanges)
    this.setState({ highlightChanges })
  }

  private onUnchangedTextOpacityChange = (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    const unchangedTextOpacity = event.currentTarget.valueAsNumber

    setNumber(UnchangedTextOpacityKey, unchangedTextOpacity)
    this.setState({ unchangedTextOpacity })
  }

  private onPreviousChange = () => this.goToChange(-1)
  private onPreviousLinesModeChange = (
    event: React.ChangeEvent<HTMLSelectElement>
  ) => {
    const previousLinesMode =
      event.currentTarget.value === 'hover' ? 'hover' : 'ghost'
    setBoolean(HoverPreviousLinesKey, previousLinesMode === 'hover')
    this.setState({ previousLinesMode })
  }
  private onNextChange = () => this.goToChange(1)
  private onFoldAll = () => this.editorRef.current?.foldAll()
  private onUnfoldAll = () => this.editorRef.current?.unfoldAll()

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
          tooltip="Previous change (W)"
          ariaLabel="Go to the previous change"
        >
          <Octicon symbol={octicons.arrowUp} />
        </Button>
        <Button
          className="ide-file-viewer-header-button"
          onClick={this.onNextChange}
          tooltip="Next change (S)"
          ariaLabel="Go to the next change"
        >
          <Octicon symbol={octicons.arrowDown} />
        </Button>
        <Button
          className="ide-file-viewer-header-button"
          onClick={this.onToggleHighlightChanges}
          ariaPressed={this.state.highlightChanges}
          tooltip="Highlight changed lines"
          ariaLabel="Highlight changed lines"
        >
          <Octicon symbol={octicons.paintbrush} />
        </Button>
        <label className="ide-file-viewer-opacity">
          <span>Unchanged</span>
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            value={this.state.unchangedTextOpacity}
            onChange={this.onUnchangedTextOpacityChange}
            aria-label="Unchanged text opacity"
            aria-valuetext={`${this.state.unchangedTextOpacity}% visible`}
          />
          <span className="ide-file-viewer-opacity-value">
            {this.state.unchangedTextOpacity}%
          </span>
        </label>
        {this.state.lineChanges.previousLines.length > 0 && (
          <select
            className="ide-file-viewer-previous-mode"
            aria-label="Previous lines display"
            value={this.state.previousLinesMode}
            onChange={this.onPreviousLinesModeChange}
          >
            <option value="ghost">Ghost lines</option>
            <option value="hover">Hover preview</option>
          </select>
        )}
      </div>
    )
  }

  private renderFoldButtons() {
    const lines = this.getLines()

    if (
      lines === null ||
      this.getFoldRangeCount(lines, this.props.tabSize) === 0
    ) {
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
    const status = this.getStatus()
    const { isDirty } = this.state

    return (
      <div className="header">
        <IdeIcon name={getFileIconName(path)} />
        <span className="ide-file-viewer-path">
          <PathText path={path} />
        </span>
        {isDirty && (
          <>
            <Octicon
              symbol={octicons.dotFill}
              className="ide-file-viewer-unsaved"
              title="This file has changes that aren’t saved"
            />
            <Button
              className="ide-file-viewer-save"
              onClick={this.onSave}
              tooltip="Save (Ctrl+S)"
            >
              Save
            </Button>
          </>
        )}
        {this.renderChangeNavigation()}
        {this.renderFoldButtons()}
        {status !== undefined && (
          <Octicon
            symbol={iconForStatus(status)}
            className={'status status-' + mapStatus(status).toLowerCase()}
            title={mapStatus(status)}
          />
        )}
        {this.props.headerExtras}
      </div>
    )
  }

  private renderMessage(message: string) {
    return <div className="ide-file-viewer-message">{message}</div>
  }

  private renderBanners(isDeleted: boolean) {
    const { changedOnDisk, saveError } = this.state

    return (
      <>
        {isDeleted && (
          <div className="ide-file-viewer-banner">
            {this.props.commit === undefined
              ? 'This file was deleted. Showing the last committed version.'
              : 'This file was deleted in this commit. Showing the version before it.'}
          </div>
        )}
        {changedOnDisk && (
          <div className="ide-file-viewer-banner">
            <span className="ide-file-viewer-banner-text">
              This file changed on disk while you have changes that aren’t
              saved.
            </span>
            <Button
              className="ide-file-viewer-banner-button"
              onClick={this.onReloadFromDisk}
            >
              Reload and discard my changes
            </Button>
            <Button
              className="ide-file-viewer-banner-button"
              onClick={this.onKeepEdits}
            >
              Keep my changes
            </Button>
          </div>
        )}
        {saveError !== null && (
          <div className="ide-file-viewer-banner ide-file-viewer-error">
            {saveError}
          </div>
        )}
      </>
    )
  }

  private renderEditor(
    path: string,
    lines: ReadonlyArray<string>,
    isDeleted: boolean
  ): JSX.Element {
    const { tabSize } = this.props
    const { revision, draft, lineChanges } = this.state

    return (
      <>
        {this.renderBanners(isDeleted)}
        <div className="ide-file-viewer-lines">
          {this.state.isSearching && (
            <>
              <DiffSearchInput
                onSearch={this.onSearch}
                onClose={this.onSearchClose}
              />
              <AriaLiveContainer
                message={this.state.searchMessage}
                trackedUserInput={this.searchAnnouncementSignal}
              />
            </>
          )}
          <IdeCodeEditor
            key={path}
            ref={this.editorRef}
            path={path}
            text={this.getEditorText(lines)}
            revision={revision}
            draft={draft}
            tabSize={tabSize}
            highlight={isHighlightable(lines)}
            readOnly={isDeleted || this.props.readOnly === true}
            highlightChanges={this.state.highlightChanges}
            unchangedTextOpacity={this.state.unchangedTextOpacity}
            previousLinesMode={this.state.previousLinesMode}
            lineChanges={lineChanges}
            onDirtyChange={this.onDirtyChange}
            onSave={this.onSave}
          />
        </div>
      </>
    )
  }

  private renderBody(path: string): JSX.Element | null {
    const { contents, contentsPath, failed } = this.state

    if (failed) {
      return this.renderMessage('Couldn’t read this file.')
    }

    if (contents === null || contentsPath !== path) {
      return null
    }

    switch (contents.kind) {
      case 'text':
        return this.renderEditor(path, contents.lines, contents.isDeleted)
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
        {this.renderBody(path)}
      </div>
    )
  }
}

function getLineChangesOfDiff(diff: IDiff | null): ILineChanges {
  return diff?.kind === DiffType.Text
    ? getLineChanges(diff.hunks)
    : NoLineChanges
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
