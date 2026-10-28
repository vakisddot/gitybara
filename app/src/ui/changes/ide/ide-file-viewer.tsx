import * as React from 'react'
import memoizeOne from 'memoize-one'
import * as ipcRenderer from '../../../lib/ipc-renderer'

import { Repository } from '../../../models/repository'
import { WorkingDirectoryFileChange } from '../../../models/status'
import { AppFileStatus } from '../../../models/status'
import { DiffType, IDiff } from '../../../models/diff'
import { getWorkingDirectoryDiff } from '../../../lib/git/diff'
import { mapStatus } from '../../../lib/status'
import { formatBytes } from '../../lib/bytes'
import { Button } from '../../lib/button'
import { FileContentZoom } from '../../lib/file-content-zoom'
import { TabBar, TabBarType } from '../../tab-bar'
import {
  isMarkdownFile,
  MarkdownFilePreview,
} from '../../lib/markdown-file-preview'
import { PathText } from '../../lib/path-text'
import { AriaLiveContainer } from '../../accessibility/aria-live-container'
import { DiffSearchInput } from '../../diff/diff-search-input'
import { UnchangedTextOpacity } from '../../diff/unchanged-text-opacity'
import {
  getUnchangedTextOpacity,
  setUnchangedTextOpacity,
} from '../../lib/diff-mode'
import { Octicon, iconForStatus } from '../../octicons'
import * as octicons from '../../octicons/octicons.generated'
import { IdeCodeEditor } from './ide-code-editor'
import { ICSharpLocation } from '../../../lib/csharp/types'
import { closeCSharpWorkspace } from './ide-csharp'
import {
  IdeFileContents,
  isHighlightable,
  readCommitFileContents,
  readIdeFileContents,
  writeIdeFileLines,
} from './ide-file-contents'
import { getFileIconName } from './ide-file-icons'
import { IdeIcon } from './ide-icon'
import { IdeKeysButton } from './ide-keys-button'
import { getFoldRanges } from './ide-folding'
import {
  arePreviousLinesShownAfterRelease,
  getIdeShortcut,
} from './ide-shortcuts'
import {
  getAdjacentChangeStart,
  getChangeGroupStarts,
  getCollapsibleRanges,
  getLineChanges,
  ILineChanges,
  isSameLineChanges,
  NoLineChanges,
} from './ide-line-changes'

/** How long to wait after the changes updated before reading the file again */
const ReloadDelay = 200

/** How long after a mouse button the app command for it is taken as the same click. */
const NativeNavigationEchoMs = 500

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

/**
 * Whether the previous lines were switched on, for every file and viewer until
 * they are switched off or the app is closed. A peek doesn't change it.
 */
let previousLinesSwitchedOn = false

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
   * Whether to collapse the unchanged lines away from the changes, as a diff
   * does, until the whole file is asked for. The Gitybara view does this.
   */
  readonly collapseUnchangedLines?: boolean

  /**
   * Show the file as it was in this commit. The file is then never read again
   * and the changed files aren't looked at.
   */
  readonly commit?: IIdeFileViewerCommit
  readonly onSelectedPathChanged?: (path: string) => void
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

  /** The text captured when opening the Markdown preview, null in code mode. */
  readonly markdownPreview: string | null

  /** Whether the text in the editor differs from the saved text */
  readonly isDirty: boolean

  /** The file changed on disk while there were edits that weren't saved. */
  readonly changedOnDisk: boolean
  readonly saveError: string | null

  /** How visible unchanged text is, as a percentage */
  readonly unchangedTextOpacity: number

  /** Whether the lines that were removed or replaced are shown */
  readonly showPreviousLines: boolean

  /** Whether the whole file is shown where unchanged lines are collapsed */
  readonly isWholeFileExpanded: boolean

  /** Whether the box to search the file is shown, and what it announced */
  readonly isSearching: boolean
  readonly searchMessage: string
  readonly searchResultCount?: number
  readonly selectedSearchResult?: number
  readonly navigation: ICSharpLocation | null
  readonly navigationHistory: ReadonlyArray<ICSharpLocation>
  readonly navigationForwardHistory: ReadonlyArray<ICSharpLocation>
  readonly navigationResults: {
    readonly locations: ReadonlyArray<ICSharpLocation>
    readonly origin: ICSharpLocation
    readonly references: boolean
  } | null
  readonly csharpStatus: string
  readonly csharpFailed: boolean
}

/** A file of the repository to read and edit, without any of the diff. */
export class IdeFileViewer extends React.Component<
  IIdeFileViewerProps,
  IIdeFileViewerState
> {
  private unmounted = false
  private lastMouseUpNavigation = 0
  private loadRequestId = 0
  private reloadTimeoutId: number | null = null
  private editorRef = React.createRef<IdeCodeEditor>()
  private searchInputRef = React.createRef<DiffSearchInput>()

  /** Flips when the search has something to announce, even if it's the same */
  private searchAnnouncementSignal = false

  /** The key that shows the previous lines while it's held down */
  private previousLinesPress: {
    readonly key: string
    readonly time: number
    readonly wereShown: boolean
  } | null = null

  /** What was read last, which isn't shown while there are unsaved edits */
  private latest: {
    readonly contents: IdeFileContents
    readonly lineChanges: ILineChanges
  } | null = null

  private getChangeStarts = memoizeOne(getChangeGroupStarts)
  private getCollapsibleRanges = memoizeOne(getCollapsibleRanges)

  private getFoldRangeCount = memoizeOne(
    (lines: ReadonlyArray<string>, tabSize: number) =>
      getFoldRanges(lines, tabSize).length
  )

  private getEditorText = memoizeOne((lines: ReadonlyArray<string>) =>
    lines.join('\n')
  )

  public constructor(props: IIdeFileViewerProps) {
    super(props)

    this.state = {
      contents: null,
      contentsPath: null,
      failed: false,
      lineChanges: NoLineChanges,
      revision: 0,
      draft: null,
      markdownPreview: null,
      isDirty: false,
      changedOnDisk: false,
      saveError: null,
      showPreviousLines: previousLinesSwitchedOn,
      isWholeFileExpanded: false,
      unchangedTextOpacity: getUnchangedTextOpacity(),
      isSearching: false,
      searchMessage: '',
      navigation: null,
      navigationHistory: [],
      navigationForwardHistory: [],
      navigationResults: null,
      csharpStatus: '',
      csharpFailed: false,
    }
  }

  public componentDidMount() {
    document.addEventListener('keydown', this.onKeyDown)
    document.addEventListener('keyup', this.onKeyUp)
    window.addEventListener('blur', this.onWindowBlur)
    ipcRenderer.on('navigate-source', this.onNativeNavigation)
    document.addEventListener('mouseup', this.onMouseUp)

    // The Find menu item, see app.tsx
    document.addEventListener('find-text', this.showSearch)

    this.loadContents()
  }

  public getSnapshotBeforeUpdate(prevProps: IIdeFileViewerProps) {
    // The editor still has the text of the previous file, keep the edits
    if (
      prevProps.path !== this.props.path ||
      prevProps.repository.path !== this.props.repository.path
    ) {
      this.keepUnsavedEdits(prevProps.repository, prevProps.path)
    }

    return null
  }

  public componentDidUpdate(prevProps: IIdeFileViewerProps) {
    const changedRepository =
      prevProps.repository.path !== this.props.repository.path
    if (changedRepository && prevProps.onSelectedPathChanged !== undefined) {
      closeCSharpWorkspace(prevProps.repository.path)
    }
    if (
      prevProps.path !== this.props.path ||
      changedRepository ||
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
        markdownPreview: null,
        isDirty: false,
        changedOnDisk: false,
        saveError: null,
        isWholeFileExpanded: false,
        isSearching: false,
        searchMessage: '',
        searchResultCount: undefined,
        selectedSearchResult: undefined,
        csharpStatus: '',
        csharpFailed: false,
        navigationResults: null,
        navigation:
          !changedRepository && this.state.navigation?.path === this.props.path
            ? this.state.navigation
            : null,
        navigationHistory: changedRepository
          ? []
          : this.state.navigationHistory,
        navigationForwardHistory:
          !changedRepository && this.state.navigation?.path === this.props.path
            ? this.state.navigationForwardHistory
            : [],
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
    document.removeEventListener('keyup', this.onKeyUp)
    window.removeEventListener('blur', this.onWindowBlur)
    ipcRenderer.removeListener('navigate-source', this.onNativeNavigation)
    document.removeEventListener('mouseup', this.onMouseUp)
    document.removeEventListener('find-text', this.showSearch)
    this.unmounted = true
    this.keepUnsavedEdits(this.props.repository, this.props.path)
    if (this.props.onSelectedPathChanged !== undefined) {
      closeCSharpWorkspace(this.props.repository.path)
    }

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
      markdownPreview:
        prevState.markdownPreview !== null && contents.kind === 'text'
          ? draft?.text ?? contents.lines.join('\n')
          : null,
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
    editor.revealLine(getAdjacentChangeStart(starts, reference, direction))
    return true
  }

  /** The unchanged lines that are hidden, which are none in the whole file */
  private getCollapsedRanges(lines: ReadonlyArray<string>) {
    return this.props.collapseUnchangedLines !== true ||
      this.state.isWholeFileExpanded
      ? []
      : this.getCollapsibleRanges(this.state.lineChanges, lines.length)
  }

  /** Whether there are unchanged lines to show or to collapse again */
  private canToggleWholeFile() {
    const lines = this.getLines()

    return (
      this.props.collapseUnchangedLines === true &&
      lines !== null &&
      (this.state.isWholeFileExpanded ||
        this.getCollapsibleRanges(this.state.lineChanges, lines.length).length >
          0)
    )
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
    if (this.state.markdownPreview !== null) {
      return
    }

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
      case 'previous-lines':
        if (this.pressPreviousLinesKey(event)) {
          event.preventDefault()
        }
        break
      case 'whole-file':
        if (!event.repeat && this.canToggleWholeFile()) {
          event.preventDefault()
          this.onToggleWholeFile()
        }
        break
    }
  }

  /** Show the previous lines while the key is down, when there are any. */
  private pressPreviousLinesKey(event: KeyboardEvent) {
    if (this.state.lineChanges.previousLines.length === 0) {
      return false
    }

    // A key that is held repeats. A press that is still going on is one that
    // wasn't seen to end, so it goes on from where that one started.
    if (!event.repeat) {
      this.previousLinesPress = {
        key: event.key.toLowerCase(),
        time: event.timeStamp,
        wereShown:
          this.previousLinesPress?.wereShown ?? this.state.showPreviousLines,
      }
      this.setState({ showPreviousLines: true })
    }

    return true
  }

  private onKeyUp = (event: KeyboardEvent) => {
    const press = this.previousLinesPress

    // macOS doesn't tell when a key that is pressed with Cmd is let go
    if (
      press !== null &&
      (event.key.toLowerCase() === press.key ||
        event.key === 'Meta' ||
        event.key === 'Control')
    ) {
      this.releasePreviousLinesKey(event.timeStamp - press.time)
    }
  }

  /** The key can't be seen to be let go once the window has lost the focus. */
  private onWindowBlur = () => this.releasePreviousLinesKey(Infinity)

  private releasePreviousLinesKey(heldFor: number) {
    const press = this.previousLinesPress

    if (press !== null) {
      this.previousLinesPress = null
      this.switchPreviousLines(
        arePreviousLinesShownAfterRelease(press.wereShown, heldFor)
      )
    }
  }

  private switchPreviousLines(shown: boolean) {
    previousLinesSwitchedOn = shown
    this.setState({ showPreviousLines: shown })
  }

  private onTogglePreviousLines = () =>
    this.switchPreviousLines(!this.state.showPreviousLines)

  /** Show the box to search the file, when there is text to search in. */
  private showSearch = () => {
    if (this.getLines() === null || this.state.markdownPreview !== null) {
      return false
    }

    if (!this.state.isSearching) {
      this.setState({ isSearching: true, searchMessage: '' })
    } else {
      this.searchInputRef.current?.focus()
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
      searchResultCount: query.trim() === '' ? undefined : position?.total ?? 0,
      selectedSearchResult: position?.index,
      searchMessage:
        query.trim() === ''
          ? ''
          : position === null
          ? `No results for “${query}”`
          : `Result ${position.index + 1} of ${position.total} for “${query}”`,
    })
  }

  private onSearchClose = () => {
    this.editorRef.current?.clearSearch()
    this.setState({
      isSearching: false,
      searchMessage: '',
      searchResultCount: undefined,
      selectedSearchResult: undefined,
    })
  }

  private onUnchangedTextOpacityChange = (unchangedTextOpacity: number) => {
    setUnchangedTextOpacity(unchangedTextOpacity)
    this.setState({ unchangedTextOpacity })
  }

  private onToggleWholeFile = () =>
    this.setState(state => ({
      isWholeFileExpanded: !state.isWholeFileExpanded,
    }))

  private onPreviousChange = () => this.goToChange(-1)
  private onNextChange = () => this.goToChange(1)
  private onFoldAll = () => this.editorRef.current?.foldAll()
  private onUnfoldAll = () => this.editorRef.current?.unfoldAll()

  private onCSharpStatus = (csharpStatus: string, csharpFailed: boolean) => {
    if (!this.unmounted) {
      this.setState({ csharpStatus, csharpFailed })
    }
  }

  private onRetryCSharp = () => this.editorRef.current?.retryCSharp()

  private onNavigate = (
    navigation: ICSharpLocation,
    origin: ICSharpLocation
  ) => {
    this.setState(state => ({
      navigation,
      navigationHistory: [...state.navigationHistory, origin],
      navigationForwardHistory: [],
      navigationResults: null,
    }))
    this.props.onSelectedPathChanged?.(navigation.path)
  }

  private onNavigationBack = () => this.navigateHistory('back')

  private onNavigationForward = () => this.navigateHistory('forward')

  private canNavigateWithMouse() {
    return (
      this.props.onSelectedPathChanged !== undefined &&
      this.props.commit === undefined
    )
  }

  private onNativeNavigation = (
    _: Electron.IpcRendererEvent,
    direction: 'back' | 'forward'
  ) => {
    // The same click can arrive here as well as through onMouseUp.
    if (Date.now() - this.lastMouseUpNavigation < NativeNavigationEchoMs) {
      return
    }

    if (this.canNavigateWithMouse()) {
      this.navigateHistory(direction)
    }
  }

  /**
   * The side buttons of a mouse go back and forward. Windows turns them into
   * an app command, which doesn't always reach the window, so they are also
   * handled here.
   */
  private onMouseUp = (event: MouseEvent) => {
    if (
      (event.button !== 3 && event.button !== 4) ||
      !this.canNavigateWithMouse()
    ) {
      return
    }

    event.preventDefault()
    this.lastMouseUpNavigation = Date.now()
    this.navigateHistory(event.button === 3 ? 'back' : 'forward')
  }

  private navigateHistory(direction: 'back' | 'forward') {
    const { navigationHistory, navigationForwardHistory } = this.state
    const history =
      direction === 'back' ? navigationHistory : navigationForwardHistory
    const navigation = history[history.length - 1]
    if (navigation === undefined) {
      return
    }
    const { path } = this.props
    const position = this.editorRef.current?.getCursorPosition()
    const current =
      path !== null &&
      this.state.contentsPath === path &&
      position !== undefined &&
      position !== null
        ? { path, position }
        : this.state.navigation?.path === path
        ? this.state.navigation
        : null
    const otherHistory =
      direction === 'back' ? navigationForwardHistory : navigationHistory
    const returnHistory =
      current === null ? otherHistory : [...otherHistory, current]
    this.setState({
      navigation,
      navigationHistory:
        direction === 'back' ? history.slice(0, -1) : returnHistory,
      navigationForwardHistory:
        direction === 'forward' ? history.slice(0, -1) : returnHistory,
      navigationResults: null,
    })
    this.props.onSelectedPathChanged?.(navigation.path)
  }

  private onNavigationResults = (
    locations: ReadonlyArray<ICSharpLocation>,
    origin: ICSharpLocation,
    references: boolean
  ) =>
    this.setState({
      navigationResults:
        locations.length === 0 ? null : { locations, origin, references },
    })

  private onCloseNavigationResults = () =>
    this.setState({ navigationResults: null })

  private onNavigationResultClick = (
    event: React.MouseEvent<HTMLButtonElement>
  ) => {
    const results = this.state.navigationResults
    const location =
      results?.locations[Number(event.currentTarget.dataset.index)]
    if (results !== null && location !== undefined) {
      this.onNavigate(location, results.origin)
    }
  }

  private hasCSharpSupport(path: string) {
    return (
      this.props.commit === undefined &&
      this.props.onSelectedPathChanged !== undefined &&
      path.toLowerCase().endsWith('.cs')
    )
  }

  private renderNavigationResults() {
    const results = this.state.navigationResults
    if (results === null) {
      return null
    }
    return (
      <section
        className="ide-csharp-results"
        aria-label={results.references ? 'References' : 'Definitions'}
      >
        <div className="ide-csharp-results-header">
          <strong>
            {results.references ? 'References' : 'Definitions'} (
            {results.locations.length})
          </strong>
          <Button
            onClick={this.onCloseNavigationResults}
            ariaLabel="Close navigation results"
          >
            Close
          </Button>
        </div>
        <ul>
          {results.locations.map((location, index) => (
            <li
              key={`${location.path}:${location.position.line}:${location.position.character}`}
            >
              <button
                className="button-component"
                type="button"
                data-index={index}
                onClick={this.onNavigationResultClick}
              >
                {location.path}:{location.position.line + 1}
              </button>
            </li>
          ))}
        </ul>
      </section>
    )
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
        {this.state.lineChanges.previousLines.length > 0 && (
          <Button
            className="ide-file-viewer-header-button"
            onClick={this.onTogglePreviousLines}
            ariaPressed={this.state.showPreviousLines}
            tooltip={`Show previous lines (F or ${
              __DARWIN__ ? 'Cmd' : 'Ctrl'
            }+', hold to peek)`}
            ariaLabel="Show previous lines"
          >
            <Octicon symbol={octicons.diffRemoved} />
          </Button>
        )}
        <UnchangedTextOpacity
          value={this.state.unchangedTextOpacity}
          onChange={this.onUnchangedTextOpacityChange}
        />
      </div>
    )
  }

  /** The button that shows the whole file, as in the unified and split diffs */
  private renderWholeFileButton() {
    if (
      this.props.collapseUnchangedLines !== true ||
      this.getLines() === null
    ) {
      return null
    }

    const { isWholeFileExpanded } = this.state
    const label = isWholeFileExpanded
      ? 'Collapse unchanged lines'
      : 'Expand whole file'

    return (
      <div className="ide-file-viewer-header-buttons">
        <Button
          className="ide-file-viewer-header-button"
          onClick={this.onToggleWholeFile}
          disabled={!this.canToggleWholeFile()}
          tooltip={`${label} (E)`}
          ariaLabel={label}
        >
          <Octicon
            symbol={isWholeFileExpanded ? octicons.fileDiff : octicons.fileCode}
          />
        </Button>
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
          <Octicon symbol={octicons.chevronRight} />
        </Button>
        <Button
          className="ide-file-viewer-header-button"
          onClick={this.onUnfoldAll}
          tooltip="Unfold all blocks"
          ariaLabel="Unfold all blocks"
        >
          <Octicon symbol={octicons.chevronDown} />
        </Button>
      </div>
    )
  }

  private renderHeader(path: string) {
    const status = this.getStatus()
    const { isDirty } = this.state

    return (
      <div className="header">
        {this.props.onSelectedPathChanged !== undefined && (
          <div className="ide-file-viewer-header-buttons">
            <Button
              className="ide-file-viewer-header-button"
              onClick={this.onNavigationBack}
              disabled={this.state.navigationHistory.length === 0}
              tooltip="Go back (Alt+Left / Mouse4)"
              ariaLabel="Go back"
            >
              <Octicon symbol={octicons.arrowLeft} />
            </Button>
            <Button
              className="ide-file-viewer-header-button"
              onClick={this.onNavigationForward}
              disabled={this.state.navigationForwardHistory.length === 0}
              tooltip="Go forward (Alt+Right / Mouse5)"
              ariaLabel="Go forward"
            >
              <Octicon symbol={octicons.arrowRight} />
            </Button>
          </div>
        )}
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
        {this.state.markdownPreview === null && (
          <>
            {this.renderChangeNavigation()}
            {this.renderWholeFileButton()}
            {this.renderFoldButtons()}
          </>
        )}
        {this.hasCSharpSupport(path) && this.state.csharpStatus !== '' && (
          <span className="ide-csharp-status" role="status">
            {this.state.csharpFailed
              ? 'C# unavailable'
              : this.state.csharpStatus}
          </span>
        )}
        {this.getLines() !== null && this.state.markdownPreview === null && (
          <div className="ide-file-viewer-header-buttons">
            <IdeKeysButton
              canEdit={!this.isEditorReadOnly()}
              canNavigate={this.hasCSharpSupport(path)}
              canExpandWholeFile={this.props.collapseUnchangedLines === true}
            />
          </div>
        )}
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
    isDeleted: boolean,
    zoomFactor: number
  ): JSX.Element {
    const { tabSize } = this.props
    const { revision, draft, lineChanges } = this.state
    const { markdownPreview } = this.state

    return (
      <>
        {this.renderBanners(isDeleted)}
        {this.hasCSharpSupport(path) && this.state.csharpFailed && (
          <div className="ide-file-viewer-banner">
            <span className="ide-file-viewer-banner-text">
              {this.state.csharpStatus}
            </span>
            <Button onClick={this.onRetryCSharp}>Retry C#</Button>
          </div>
        )}
        {isMarkdownFile(path) && (
          <TabBar
            selectedIndex={markdownPreview === null ? 0 : 1}
            onTabClicked={this.onMarkdownModeChanged}
            type={TabBarType.Switch}
          >
            <span>Code</span>
            <span>Preview</span>
          </TabBar>
        )}
        <div
          className="ide-file-viewer-lines"
          hidden={markdownPreview !== null}
        >
          {this.state.isSearching && (
            <>
              <DiffSearchInput
                ref={this.searchInputRef}
                onSearch={this.onSearch}
                onClose={this.onSearchClose}
                resultCount={this.state.searchResultCount}
                selectedResult={this.state.selectedSearchResult}
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
            zoomFactor={zoomFactor}
            highlight={isHighlightable(lines)}
            readOnly={isDeleted || this.props.readOnly === true}
            unchangedTextOpacity={this.state.unchangedTextOpacity}
            showPreviousLines={this.state.showPreviousLines}
            collapsedRanges={this.getCollapsedRanges(lines)}
            lineChanges={lineChanges}
            onDirtyChange={this.onDirtyChange}
            onSave={this.onSave}
            additionalContextMenuItems={
              this.canToggleWholeFile()
                ? [
                    { type: 'separator' },
                    {
                      label: this.state.isWholeFileExpanded
                        ? 'Collapse unchanged lines'
                        : 'Expand whole file',
                      action: this.onToggleWholeFile,
                    },
                  ]
                : []
            }
            repositoryPath={
              !isDeleted && this.hasCSharpSupport(path)
                ? this.props.repository.path
                : undefined
            }
            navigationPosition={
              this.state.navigation?.path === path
                ? this.state.navigation.position
                : undefined
            }
            onNavigate={this.onNavigate}
            onNavigationBack={this.onNavigationBack}
            onNavigationForward={this.onNavigationForward}
            onNavigationResults={this.onNavigationResults}
            onCSharpStatus={this.onCSharpStatus}
          />
        </div>
        {markdownPreview !== null && (
          <MarkdownFilePreview
            markdown={markdownPreview}
            zoomFactor={zoomFactor}
          />
        )}
      </>
    )
  }

  private onMarkdownModeChanged = (index: number) => {
    this.setState(
      {
        markdownPreview:
          index === 1
            ? this.editorRef.current?.getLines().join('\n') ?? ''
            : null,
      },
      () => {
        if (index === 0) {
          this.editorRef.current?.refresh()
        }
      }
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
        return (
          <FileContentZoom>
            {zoomFactor =>
              this.renderEditor(
                path,
                contents.lines,
                contents.isDeleted,
                zoomFactor
              )
            }
          </FileContentZoom>
        )
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
        {this.renderNavigationResults()}
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
