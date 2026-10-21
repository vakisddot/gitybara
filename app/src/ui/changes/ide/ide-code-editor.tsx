import * as React from 'react'
import * as Path from 'path'
import CodeMirror from 'codemirror'
import 'codemirror/addon/fold/foldcode'
import 'codemirror/addon/fold/foldgutter'
import 'codemirror/addon/search/match-highlighter'
import 'codemirror/addon/search/searchcursor'
import 'codemirror/addon/selection/active-line'
import 'codemirror/addon/selection/mark-selection'
import 'codemirror/mode/meta'

import {
  getFoldRanges,
  getFoldRangesByStart,
  IFoldRange,
  isPartlyOverlapping,
} from './ide-folding'
import {
  detectIndentUnit,
  getIndentGuidesStyle,
  getLineIndentation,
} from './ide-indentation'
import { IInlineChange, ILineChanges, ILineRange } from './ide-line-changes'
import { IdePreviousLines } from './ide-previous-lines'
import { IMenuItem, showContextualMenu } from '../../../lib/menu-item'
import * as ipcRenderer from '../../../lib/ipc-renderer'
import { getCSharpTokenClass } from '../../../lib/csharp/semantic-tokens'
import {
  ICSharpDocument,
  ICSharpLocation,
  ICSharpPosition,
} from '../../../lib/csharp/types'
import {
  highlightCSharp,
  navigateCSharp,
  updateCSharpDocument,
} from './ide-csharp'

/** Padding to the left of the text of a line, keep in sync with the styles. */
const TextPadding = 12

/** Files with more lines than this don't get their indentation worked out. */
const MaxAnalyzedLines = 50000

const FoldGutter = 'ide-fold-gutter'

/** Only this many matches of a search are marked, so a short query stays fast. */
const MaxSearchMatches = 5000

/** Where the match that a search went to is among the matches of the search. */
export interface ISearchPosition {
  readonly index: number
  readonly total: number
}

/** What is worked out from the text of the editor, for the folding and guides */
interface IAnalysis {
  readonly generation: number
  readonly tabSize: number

  /** How many columns one level of indentation is */
  readonly unit: number

  /** How many columns each line is indented */
  readonly columns: ReadonlyArray<number>

  readonly ranges: ReadonlyArray<IFoldRange>
  readonly byStart: ReadonlyMap<number, IFoldRange>
}

interface IIdeCodeEditorProps {
  /** File content magnification; does not change the text or undo history. */
  readonly zoomFactor?: number

  /** The file that is edited, to pick the language from. */
  readonly path: string

  /** The text of the file, with \n as the line ending. */
  readonly text: string

  /**
   * The text is only put in the editor when this changes, so what was typed in
   * it is kept when the text of the file changes behind it.
   */
  readonly revision: number

  /** The text that is shown when the editor gets the text of the file. */
  readonly draft: string | null

  /** The width of a tab character, in characters. */
  readonly tabSize: number

  /** Whether to color the code. */
  readonly highlight: boolean

  readonly readOnly: boolean

  /**
   * The lines that differ from the committed version, to mark in the gutter
   * and with a color in the background
   */
  readonly lineChanges: ILineChanges

  /** How visible unchanged text is, as a percentage */
  readonly unchangedTextOpacity: number

  /** Whether to show the lines that were removed or replaced */
  readonly showPreviousLines: boolean

  /**
   * The unchanged lines to hide behind a line that says how many there are,
   * which shows them again when it's clicked.
   */
  readonly collapsedRanges: ReadonlyArray<ILineRange>

  /** Called when the text starts or stops differing from the saved text. */
  readonly onDirtyChange: (isDirty: boolean) => void

  /** Called when the user asks to save the file. */
  readonly onSave: () => void

  /** Viewer actions appended after the standard text-selection actions. */
  readonly additionalContextMenuItems?: ReadonlyArray<IMenuItem>

  /** Present only for C# source in the working repository. */
  readonly repositoryPath?: string
  readonly navigationPosition?: ICSharpPosition
  readonly onNavigate?: (
    location: ICSharpLocation,
    origin: ICSharpLocation
  ) => void
  readonly onNavigationResults?: (
    locations: ReadonlyArray<ICSharpLocation>,
    origin: ICSharpLocation,
    references: boolean
  ) => void
  readonly onNavigationBack?: () => void
  readonly onNavigationForward?: () => void
  readonly onCSharpStatus?: (message: string, failed: boolean) => void
}

/**
 * Work out from a path which of the modes of CodeMirror to use and load it.
 * Returns the mime type of the mode, or null for a file that isn't colored.
 */
async function loadMode(path: string): Promise<string | null> {
  const info = CodeMirror.findModeByFileName(Path.basename(path))

  if (info === undefined || info.mode === 'null') {
    return null
  }

  try {
    await import(
      /* webpackInclude: /[\\/]([\w.-]+)[\\/]\1\.js$/ */
      `codemirror/mode/${info.mode}/${info.mode}`
    )
  } catch (e) {
    log.error(`Failed to load the ${info.mode} mode`, e)
    return null
  }

  return info.mime ?? info.mode
}

/** A text editor for a file, with the gutter and the folding of the IDE view. */
export class IdeCodeEditor extends React.Component<IIdeCodeEditorProps> {
  private containerRef = React.createRef<HTMLDivElement>()
  private editor: CodeMirror.Editor | null = null
  private cleanGeneration = 0
  private isDirty = false
  private modeRequestId = 0
  private previousLines: IdePreviousLines | null = null
  private inlineChanges: ReadonlyArray<IInlineChange> | null = null
  private inlineMarks = new Array<CodeMirror.TextMarker>()
  private semanticMarks = new Array<CodeMirror.TextMarker>()
  private semanticTimer: number | null = null
  private semanticGeneration = 0
  private semanticPending = false
  private semanticAgain = false
  private semanticFailed = false
  private navigationRequestId = 0

  /** The classes added to the lines to mark the changes, to take them off */
  private changeClasses = new Array<{
    readonly handle: CodeMirror.LineHandle
    readonly where: 'gutter' | 'background' | 'text'
    readonly className: string
  }>()

  /** The unchanged lines that were collapsed */
  private collapsedRanges: ReadonlyArray<ILineRange> = []

  /** The lines that are still collapsed, and the marks that hide them */
  private collapsed = new Array<{
    readonly range: ILineRange
    readonly mark: CodeMirror.TextMarker
  }>()

  /** Marks over the scroll bar for the lines that have changes */
  private ruler: HTMLDivElement | null = null

  /** The height of the text when the ruler was drawn, to see if it changed */
  private rulerTextHeight = 0
  private rulerFrameId: number | null = null

  /** Where the last jump to a change went, to continue from there */
  private lastJump: { readonly line: number; readonly top: number } | null =
    null

  /** What is worked out from the text, until the text changes */
  private analysis: IAnalysis | null = null

  /**
   * The text that is searched for and where it was found. The matches are
   * kept as long as the text doesn't change, so they stay where they were found.
   */
  private searchQuery: string | null = null
  private searchMatches = new Array<{
    readonly from: CodeMirror.Position
    readonly to: CodeMirror.Position
  }>()

  /** The marks over the matches, the one of the current match looks different */
  private searchMarks = new Array<CodeMirror.TextMarker>()
  private searchIndex = -1

  public componentDidMount() {
    const container = this.containerRef.current

    if (container === null) {
      return
    }

    const { tabSize, readOnly } = this.props
    const save = () => this.props.onSave()

    const editor = CodeMirror(container, {
      value: '',
      lineNumbers: true,
      tabSize,
      indentUnit: tabSize,
      indentWithTabs: false,
      readOnly,
      styleActiveLine: !readOnly,
      styleSelectedText: true,
      highlightSelectionMatches: { minChars: 1, style: 'ide-selection-match' },
      lineWrapping: false,
      viewportMargin: 20,
      gutters: ['CodeMirror-linenumbers', FoldGutter],
      foldGutter: this.getFoldGutterOptions(),
      foldOptions: {
        rangeFinder: this.findFoldRange,
        widget: this.createFoldWidget,
      },
      extraKeys: {
        'Ctrl-S': save,
        'Cmd-S': save,
        Tab: cm => this.onTab(cm),
        'Shift-Tab': 'indentLess',
        F12: () => {
          this.navigate(false)
        },
        'Shift-F12': () => {
          this.navigate(true)
        },
        'Alt-Left': () => this.props.onNavigationBack?.(),
        'Alt-Right': () => this.props.onNavigationForward?.(),
      },
    })

    this.editor = editor
    this.previousLines = new IdePreviousLines(editor)
    this.previousLines.setShown(this.props.showPreviousLines)
    const wrapper = editor.getWrapperElement()
    wrapper.addEventListener('mousedown', this.onContextMouseDown, true)
    wrapper.addEventListener('contextmenu', this.onContextMenu, true)
    wrapper.addEventListener('select-all', this.onSelectAll)
    wrapper.addEventListener('keydown', this.onSelectAllKeyDown, true)
    editor.on('renderLine', this.onRenderLine)
    editor.on('changes', this.onChanges)
    editor.on('update', this.onUpdate)
    editor.on('viewportChange', this.scheduleSemanticHighlight)
    if (this.props.repositoryPath !== undefined) {
      ipcRenderer.on('csharp-refresh', this.onCSharpRefresh)
      const wrapper = editor.getWrapperElement()
      wrapper.addEventListener('mousedown', this.onCSharpClick)
      wrapper.addEventListener('mousemove', this.onNavigationModifier)
      window.addEventListener('keydown', this.onNavigationModifier)
      window.addEventListener('keyup', this.onNavigationModifier)
      window.addEventListener('blur', this.onWindowBlur)
    }

    // Drawn over the scroll bar, where it shows where the changes are
    const ruler = document.createElement('div')
    ruler.className = 'ide-change-ruler'
    ruler.setAttribute('aria-hidden', 'true')
    container.appendChild(ruler)
    this.ruler = ruler

    this.setText()
    this.applyMode()
    this.applyNavigationPosition()
  }

  public componentDidUpdate(prevProps: IIdeCodeEditorProps) {
    const editor = this.editor

    if (editor === null) {
      return
    }

    const { path, revision, tabSize, readOnly, highlight, lineChanges } =
      this.props

    if (prevProps.zoomFactor !== this.props.zoomFactor) {
      this.refresh()
    }

    if (prevProps.tabSize !== tabSize) {
      editor.setOption('tabSize', tabSize)
      editor.setOption('indentUnit', tabSize)
      this.previousLines?.refresh()
    }

    if (prevProps.readOnly !== readOnly) {
      editor.setOption('readOnly', readOnly)
      editor.setOption('styleActiveLine', !readOnly)
    }

    this.previousLines?.setShown(this.props.showPreviousLines)

    if (prevProps.path !== path || prevProps.highlight !== highlight) {
      this.applyMode()
      this.clearSemanticMarks()
      this.scheduleSemanticHighlight()
    }

    if (prevProps.path !== path || prevProps.revision !== revision) {
      this.setText(prevProps.path === path)
    } else if (prevProps.lineChanges !== lineChanges) {
      this.markChanges()
    }
    if (prevProps.navigationPosition !== this.props.navigationPosition) {
      this.applyNavigationPosition()
    }

    this.collapseLines()
  }

  public componentWillUnmount() {
    this.editor?.setOption('highlightSelectionMatches', false)
    const wrapper = this.editor?.getWrapperElement()
    wrapper?.removeEventListener('mousedown', this.onContextMouseDown, true)
    wrapper?.removeEventListener('contextmenu', this.onContextMenu, true)
    wrapper?.removeEventListener('select-all', this.onSelectAll)
    wrapper?.removeEventListener('keydown', this.onSelectAllKeyDown, true)
    // Keep a just-edited file in Roslyn when switching to another source file.
    const document = this.getCSharpDocument()
    if (document !== null) {
      updateCSharpDocument(document)
    }
    if (this.props.repositoryPath !== undefined) {
      ipcRenderer.removeListener('csharp-refresh', this.onCSharpRefresh)
      const wrapper = this.editor?.getWrapperElement()
      wrapper?.removeEventListener('mousedown', this.onCSharpClick)
      wrapper?.removeEventListener('mousemove', this.onNavigationModifier)
      window.removeEventListener('keydown', this.onNavigationModifier)
      window.removeEventListener('keyup', this.onNavigationModifier)
      window.removeEventListener('blur', this.onWindowBlur)
    }
    if (this.semanticTimer !== null) {
      window.clearTimeout(this.semanticTimer)
    }
    this.navigationRequestId++
    this.clearSemanticMarks()
    if (this.rulerFrameId !== null) {
      window.cancelAnimationFrame(this.rulerFrameId)
    }
    this.ruler = null

    this.modeRequestId++
    this.clearInlineChanges()
    this.previousLines?.dispose()
    this.previousLines = null
    this.editor = null
    this.containerRef.current?.replaceChildren()
  }

  /** The lines of the text in the editor. */
  public getLines(): ReadonlyArray<string> {
    return this.editor?.getDoc().getValue('\n').split('\n') ?? []
  }

  private onContextMouseDown = (event: MouseEvent) => {
    // CodeMirror otherwise focuses its hidden input on right-click, replacing
    // a native selection that includes previous code before the menu opens.
    if (event.button === 2) {
      event.stopPropagation()
    }
  }

  private onContextMenu = (event: MouseEvent) => {
    event.preventDefault()
    event.stopPropagation()
    const displayedSelection = this.previousLines?.getSelectedText() ?? null
    if (displayedSelection === null) {
      // The native Copy role reads a current-only selection from this input.
      this.editor?.focus()
    }
    const text = displayedSelection ?? this.editor?.getSelection() ?? ''
    showContextualMenu([
      {
        label: 'Copy',
        role: text.length > 0 ? 'copy' : undefined,
        enabled: text.length > 0,
      },
      {
        label: __DARWIN__ ? 'Select All' : 'Select all',
        action: () => this.onSelectAll(),
      },
      ...(this.props.additionalContextMenuItems ?? []),
    ])
  }

  private onSelectAll = (event?: Event) => {
    event?.preventDefault()
    event?.stopPropagation()
    if (!this.previousLines?.selectAll()) {
      this.editor?.execCommand('selectAll')
      this.editor?.focus()
    }
  }

  private onSelectAllKeyDown = (event: KeyboardEvent) => {
    if (
      event.key.toLowerCase() === 'a' &&
      (__DARWIN__ ? event.metaKey : event.ctrlKey) &&
      !event.altKey &&
      !event.shiftKey
    ) {
      this.onSelectAll(event)
    }
  }

  /**
   * The lines of the text in the editor with the state of the editor they are
   * from, for `markSaved` when they are written to the file.
   */
  public getSnapshot(): { lines: ReadonlyArray<string>; generation: number } {
    return {
      lines: this.getLines(),
      generation: this.editor?.getDoc().changeGeneration(true) ?? 0,
    }
  }

  /**
   * Call after the text of a snapshot was saved, so the text of the editor
   * doesn't count as changed unless it changed again after the snapshot.
   */
  public markSaved(generation: number) {
    this.cleanGeneration = generation
    this.updateDirty()
    const document = this.getCSharpDocument()
    if (document !== null) {
      updateCSharpDocument(document)
    }
  }

  public focus() {
    this.editor?.focus()
  }

  /** Measure the editor again after it has been hidden by a file preview. */
  public refresh() {
    this.editor?.refresh()
    this.previousLines?.refresh()
  }

  /** The current caret position, for returning after source navigation. */
  public getCursorPosition(): ICSharpPosition | null {
    const cursor = this.editor?.getCursor()
    return cursor === undefined
      ? null
      : { line: cursor.line, character: cursor.ch }
  }

  /** Retry setup after an installation or connection failure. */
  public retryCSharp() {
    this.semanticFailed = false
    this.scheduleSemanticHighlight()
  }

  private applyNavigationPosition() {
    const position = this.props.navigationPosition
    if (position !== undefined && this.editor !== null) {
      this.revealLine(position.line)
      this.editor.setCursor(CodeMirror.Pos(position.line, position.character))
      this.editor.focus()
    }
  }

  private getCSharpDocument(): ICSharpDocument | null {
    const { repositoryPath, path } = this.props
    if (
      repositoryPath === undefined ||
      !path.toLowerCase().endsWith('.cs') ||
      this.editor === null
    ) {
      return null
    }
    return {
      repositoryPath,
      path,
      text: this.editor.getValue('\n'),
      isDirty: !this.editor.getDoc().isClean(this.cleanGeneration),
    }
  }

  private clearSemanticMarks() {
    this.semanticMarks.forEach(mark => mark.clear())
    this.semanticMarks = []
  }

  private onCSharpRefresh = (_: unknown, repositoryPath: string) => {
    if (repositoryPath === this.props.repositoryPath) {
      this.scheduleSemanticHighlight()
    }
  }

  private scheduleSemanticHighlight = () => {
    if (
      this.getCSharpDocument() === null ||
      !this.props.highlight ||
      this.semanticFailed
    ) {
      return
    }
    if (this.semanticTimer !== null) {
      window.clearTimeout(this.semanticTimer)
    }
    this.semanticTimer = window.setTimeout(() => {
      this.semanticTimer = null
      this.highlightSemantics()
    }, 250)
  }

  private async highlightSemantics() {
    if (this.semanticPending) {
      this.semanticAgain = true
      return
    }
    const editor = this.editor
    const document = this.getCSharpDocument()
    if (editor === null || document === null || !this.props.highlight) {
      return
    }
    const generation = this.semanticGeneration
    const viewport = editor.getViewport()
    const lastLine = Math.min(editor.lineCount() - 1, viewport.to + 20)
    this.semanticPending = true
    if (this.semanticMarks.length === 0) {
      this.props.onCSharpStatus?.('C# loading…', false)
    }
    try {
      const result = await highlightCSharp(document, {
        start: { line: Math.max(0, viewport.from - 20), character: 0 },
        end: { line: lastLine, character: editor.getLine(lastLine).length },
      })
      if (
        this.editor !== editor ||
        generation !== this.semanticGeneration ||
        !this.props.highlight
      ) {
        this.semanticAgain = true
        return
      }
      if (result.error !== null) {
        this.semanticFailed = true
        this.props.onCSharpStatus?.(result.error, true)
        return
      }
      editor.operation(() => {
        this.clearSemanticMarks()
        for (const token of result.tokens) {
          const className = getCSharpTokenClass(token.type)
          if (
            className === null ||
            token.line >= editor.lineCount() ||
            token.start + token.length > editor.getLine(token.line).length
          ) {
            continue
          }
          this.semanticMarks.push(
            editor.markText(
              CodeMirror.Pos(token.line, token.start),
              CodeMirror.Pos(token.line, token.start + token.length),
              { className }
            )
          )
        }
      })
      this.props.onCSharpStatus?.('C# ready', false)
    } catch (error) {
      if (this.editor === editor) {
        this.semanticFailed = true
        this.props.onCSharpStatus?.(String(error), true)
      }
    } finally {
      this.semanticPending = false
      if (this.semanticAgain && this.editor === editor) {
        this.semanticAgain = false
        this.scheduleSemanticHighlight()
      }
    }
  }

  /**
   * While Ctrl is held, the words that Ctrl+click goes to the definition of
   * are shown as links. Moving the mouse also updates it, for when Ctrl was
   * pressed in another window.
   */
  private onNavigationModifier = (event: KeyboardEvent | MouseEvent) => {
    this.editor
      ?.getWrapperElement()
      .classList.toggle('ide-csharp-navigable', event.ctrlKey || event.metaKey)
  }

  /** The key up of Ctrl isn't seen after the window loses focus. */
  private onWindowBlur = () => {
    this.editor?.getWrapperElement().classList.remove('ide-csharp-navigable')
  }

  private onCSharpClick = (event: MouseEvent) => {
    if (
      !(event.ctrlKey || event.metaKey) ||
      event.button !== 0 ||
      !(event.target instanceof Element) ||
      !event.target.closest('.CodeMirror-line')
    ) {
      return
    }
    const position = this.editor?.coordsChar(
      { left: event.clientX, top: event.clientY },
      'window'
    )
    if (position !== undefined) {
      event.preventDefault()
      this.navigate(false, position)
    }
  }

  private async navigate(
    references: boolean,
    position = this.editor?.getCursor()
  ) {
    const document = this.getCSharpDocument()
    const editor = this.editor
    if (document === null || editor === null || position === undefined) {
      return
    }
    const requestId = ++this.navigationRequestId
    const generation = this.semanticGeneration
    const origin = {
      path: document.path,
      position: { line: position.line, character: position.ch },
    }
    this.props.onCSharpStatus?.(
      references ? 'Finding references…' : 'Finding definition…',
      false
    )
    try {
      const result = await navigateCSharp(document, origin.position, references)
      if (
        this.editor !== editor ||
        requestId !== this.navigationRequestId ||
        generation !== this.semanticGeneration
      ) {
        return
      }
      if (result.error !== null) {
        this.props.onCSharpStatus?.(result.error, true)
      } else if (!references && result.locations.length === 1) {
        this.props.onCSharpStatus?.('C# ready', false)
        this.props.onNavigate?.(result.locations[0], origin)
      } else {
        this.props.onCSharpStatus?.(
          result.locations.length === 0
            ? references
              ? 'No references in this repository'
              : 'No definition in this repository'
            : 'C# ready',
          false
        )
        this.props.onNavigationResults?.(result.locations, origin, references)
      }
    } catch (error) {
      if (this.editor === editor && requestId === this.navigationRequestId) {
        this.props.onCSharpStatus?.(String(error), true)
      }
    }
  }

  /** Fold all the blocks that can be folded. */
  public foldAll() {
    const editor = this.editor

    if (editor === null) {
      return
    }

    const { ranges } = this.getAnalysis()

    editor.operation(() => {
      for (const { start } of ranges) {
        editor.foldCode(CodeMirror.Pos(start, 0), undefined, 'fold')
      }
    })
  }

  public unfoldAll() {
    const editor = this.editor

    if (editor !== null) {
      editor.operation(() => {
        for (const mark of editor.getAllMarks()) {
          if (isFoldMark(mark)) {
            mark.clear()
          }
        }
      })
    }
  }

  /** The line that "next change" and "previous change" go on from. */
  public getReferenceLine(): number {
    const editor = this.editor

    if (editor === null) {
      return 0
    }

    const { top, clientHeight } = editor.getScrollInfo()
    const jump = this.lastJump

    // Right after a jump, continue from the change that was jumped to
    if (jump !== null && Math.abs(top - jump.top) < 1) {
      return jump.line
    }

    return editor.lineAtHeight(top + clientHeight / 3, 'local')
  }

  /**
   * Scroll so the line is a third of the way down, showing what is above. A
   * block that hides the line is unfolded.
   */
  public revealLine(line: number) {
    const editor = this.editor

    if (editor === null) {
      return
    }

    this.unfoldLine(line)

    const { clientHeight } = editor.getScrollInfo()
    const top = Math.max(
      0,
      editor.heightAtLine(line, 'local') - Math.floor(clientHeight / 3)
    )

    editor.scrollTo(null, top)
    this.lastJump = { line, top: editor.getScrollInfo().top }
  }

  /** Unfold the blocks and show the collapsed lines that hide the line. */
  private unfoldLine(line: number) {
    const editor = this.editor

    let shownCollapsedLines = false

    editor?.operation(() => {
      for (const mark of editor.findMarksAt(CodeMirror.Pos(line, 0))) {
        if (this.collapsed.some(c => c.mark === mark)) {
          mark.clear()
          shownCollapsedLines = true
        } else if (isFoldMark(mark)) {
          mark.clear()
        }
      }
    })

    if (shownCollapsedLines) {
      this.refreshFoldGutter()
    }
  }

  /**
   * Mark the text that matches the query, whatever the case, and go to the next
   * or the previous match. A new query starts at the first or the last match.
   * Returns where the match is among the matches, or null when there is none.
   */
  public search(
    query: string,
    direction: 'next' | 'previous'
  ): ISearchPosition | null {
    const editor = this.editor

    if (editor === null || query.trim() === '') {
      this.clearSearch()
      return null
    }

    if (query !== this.searchQuery) {
      this.clearSearch()
      this.searchQuery = query

      const cursor = editor.getSearchCursor(query, CodeMirror.Pos(0, 0), true)

      while (
        this.searchMatches.length < MaxSearchMatches &&
        cursor.findNext()
      ) {
        this.searchMatches.push({ from: cursor.from(), to: cursor.to() })
      }

      editor.operation(() => {
        this.searchMarks = this.searchMatches.map(match =>
          markSearchMatch(editor, match, false)
        )
      })

      this.searchIndex = direction === 'next' ? -1 : this.searchMatches.length
      this.containerRef.current?.classList.toggle(
        'is-searching',
        this.searchMatches.length > 0
      )
    }

    const total = this.searchMatches.length

    if (total === 0) {
      return null
    }

    const previous = this.searchIndex
    const index = (previous + (direction === 'next' ? 1 : -1) + total) % total
    const { from, to } = this.searchMatches[index]

    this.searchIndex = index

    editor.operation(() => {
      if (previous >= 0 && previous < total) {
        this.searchMarks[previous].clear()
        this.searchMarks[previous] = markSearchMatch(
          editor,
          this.searchMatches[previous],
          false
        )
      }

      this.searchMarks[index].clear()
      this.searchMarks[index] = markSearchMatch(editor, { from, to }, true)
    })

    this.unfoldLine(from.line)
    editor.scrollIntoView(
      { from, to },
      Math.floor(editor.getScrollInfo().clientHeight / 3)
    )

    return { index, total }
  }

  /** Take off the marks of the matches of a search. */
  public clearSearch() {
    this.searchMarks.forEach(mark => mark.clear())
    this.searchMarks = []
    this.searchMatches = []
    this.searchQuery = null
    this.searchIndex = -1
    this.containerRef.current?.classList.remove('is-searching')
  }

  private getAnalysis(): IAnalysis {
    const { tabSize } = this.props
    const generation = this.editor?.getDoc().changeGeneration() ?? 0
    const cached = this.analysis

    if (
      cached !== null &&
      cached.generation === generation &&
      cached.tabSize === tabSize
    ) {
      return cached
    }

    const lines = this.getLines()
    const analyzed = lines.length <= MaxAnalyzedLines
    const ranges = analyzed ? getFoldRanges(lines, tabSize) : []

    this.analysis = {
      generation,
      tabSize,
      unit: analyzed ? detectIndentUnit(lines, tabSize) : tabSize,
      columns: analyzed ? getLineIndentation(lines, tabSize) : [],
      ranges,
      byStart: getFoldRangesByStart(ranges),
    }

    return this.analysis
  }

  private findFoldRange = (
    editor: CodeMirror.Editor,
    pos: CodeMirror.Position
  ): CodeMirror.FoldRange | undefined => {
    const range = this.getAnalysis().byStart.get(pos.line)

    // A block that runs into or out of collapsed lines can't be folded
    if (
      range === undefined ||
      this.collapsed.some(c => isPartlyOverlapping(range, c.range))
    ) {
      return undefined
    }

    return {
      from: CodeMirror.Pos(range.start, editor.getLine(range.start).length),
      to: CodeMirror.Pos(range.end, editor.getLine(range.end).length),
    }
  }

  private createFoldWidget = (
    from: CodeMirror.Position,
    to: CodeMirror.Position
  ) => {
    const widget = document.createElement('span')
    widget.className = 'ide-fold-ellipsis'
    widget.textContent = '…'
    widget.title = `${to.line - from.line} lines are folded`
    return widget
  }

  private onTab(editor: CodeMirror.Editor) {
    if (editor.somethingSelected()) {
      editor.execCommand('indentMore')
    } else if (editor.getOption('indentWithTabs')) {
      editor.replaceSelection('\t')
    } else {
      editor.execCommand('insertSoftTab')
    }
  }

  /** Draw a line at each level of indentation in the indentation of a line. */
  private onRenderLine = (
    editor: CodeMirror.Editor,
    line: CodeMirror.LineHandle,
    element: HTMLElement
  ) => {
    const lineNumber = editor.getLineNumber(line)

    if (lineNumber === null) {
      return
    }

    const { unit, columns } = this.getAnalysis()
    const style = getIndentGuidesStyle(
      columns[lineNumber] ?? 0,
      unit,
      `${TextPadding}px`
    )

    if (style !== undefined) {
      Object.assign(element.style, style)
    }
  }

  private onChanges = () => {
    this.semanticGeneration++
    this.clearSemanticMarks()
    this.scheduleSemanticHighlight()
    // The matches were found in the text from before
    if (this.searchQuery !== null) {
      this.clearSearch()
    }

    this.updateDirty()
    this.scheduleRuler()
  }

  /** Folding, wrapping and the like change how tall the text is. */
  private onUpdate = () => {
    if (
      this.editor !== null &&
      this.editor.getScrollInfo().height !== this.rulerTextHeight
    ) {
      this.scheduleRuler()
    }
  }

  private scheduleRuler() {
    if (this.rulerFrameId === null) {
      this.rulerFrameId = window.requestAnimationFrame(() => {
        this.rulerFrameId = null
        this.drawRuler()
      })
    }
  }

  /**
   * Draw a mark for each group of lines that have changes, at the place in the
   * scroll bar that the group is at in the text. The lines are the ones that
   * were marked in the gutter, so they follow the lines while they are edited.
   */
  private drawRuler() {
    const { editor, ruler } = this

    if (editor === null || ruler === null) {
      return
    }

    const textHeight = editor.getScrollInfo().height
    this.rulerTextHeight = textHeight

    const marks = new Array<HTMLElement>()
    const lineHeight = editor.defaultTextHeight()

    const addMark = (kind: string, top: number, bottom: number) => {
      const mark = document.createElement('div')
      mark.className = `ide-change-mark ${kind}`
      mark.style.top = `${(top / textHeight) * 100}%`
      mark.style.height = `${(Math.max(bottom - top, 0) / textHeight) * 100}%`
      marks.push(mark)
    }

    const kinds = [
      { className: 'change-added', kind: 'added' },
      { className: 'change-modified', kind: 'modified' },
    ]

    for (const { className, kind } of textHeight > 0 ? kinds : []) {
      const lines = this.changeClasses
        .filter(c => c.where === 'gutter' && c.className === className)
        .map(c => editor.getLineNumber(c.handle))
        .filter((line): line is number => line !== null)
        .sort((a, b) => a - b)

      // Lines right after each other are one mark
      for (let i = 0; i < lines.length; ) {
        let last = i

        while (last + 1 < lines.length && lines[last + 1] === lines[last] + 1) {
          last++
        }

        addMark(
          kind,
          editor.heightAtLine(lines[i], 'local'),
          editor.heightAtLine(lines[last], 'local') + lineHeight
        )
        i = last + 1
      }
    }

    for (const c of textHeight > 0 ? this.changeClasses : []) {
      const line = editor.getLineNumber(c.handle)

      if (line === null) {
        continue
      }

      // Lines were removed before the line, or after it when it's the last
      if (c.className === 'change-removed-before') {
        addMark('removed', editor.heightAtLine(line, 'local'), 0)
      } else if (c.className === 'change-removed-after') {
        addMark('removed', editor.heightAtLine(line, 'local') + lineHeight, 0)
      }
    }

    ruler.replaceChildren(...marks)
  }

  private updateDirty() {
    const editor = this.editor

    if (editor === null) {
      return
    }

    const isDirty = !editor.getDoc().isClean(this.cleanGeneration)

    if (isDirty !== this.isDirty) {
      this.isDirty = isDirty
      this.props.onDirtyChange(isDirty)
    }
  }

  /**
   * Put the text of the props in the editor. When it's the same file, the
   * scroll position and the cursor stay where they were.
   */
  private setText(keepPosition = false) {
    const editor = this.editor

    if (editor === null) {
      return
    }

    const { text, draft } = this.props
    const scroll = editor.getScrollInfo()
    const cursor = editor.getCursor()

    this.lastJump = null
    this.analysis = null
    this.changeClasses = []
    this.previousLines?.clear()
    this.clearInlineChanges()
    this.clearCollapsedLines()

    editor.operation(() => {
      editor.setValue(text)
      editor.clearHistory()
      this.cleanGeneration = editor.getDoc().changeGeneration(true)

      if (draft !== null && draft !== text) {
        editor.setValue(draft)
      }

      if (keepPosition) {
        editor.setCursor(cursor)
        editor.scrollTo(scroll.left, scroll.top)
      } else {
        editor.setCursor(CodeMirror.Pos(0, 0))
        editor.scrollTo(0, 0)
      }
    })

    this.updateDirty()
    this.markChanges()
    this.collapseLines()
    this.scheduleSemanticHighlight()
  }

  /**
   * Hide the lines of the collapsed ranges. Nothing is done while the ranges
   * stay the same, so lines that were shown by a click stay shown when the
   * changes of the file are worked out again.
   */
  private collapseLines() {
    const editor = this.editor
    const ranges = this.props.collapsedRanges

    if (editor === null || isSameRanges(ranges, this.collapsedRanges)) {
      return
    }

    this.clearCollapsedLines()
    this.collapsedRanges = ranges
    const lineCount = editor.lineCount()

    editor.operation(() => {
      for (const range of ranges) {
        const { start, end } = range

        if (end >= lineCount) {
          continue
        }

        // CodeMirror can't hide lines that a folded block runs into or out of
        for (const mark of editor.getAllMarks()) {
          const found = isFoldMark(mark) ? mark.find() : undefined
          if (
            found !== undefined &&
            'from' in found &&
            isPartlyOverlapping(
              { start: found.from.line, end: found.to.line },
              range
            )
          ) {
            mark.clear()
          }
        }

        const widget = document.createElement('span')
        widget.className = 'ide-collapsed-lines'
        widget.textContent = `⋯ ${end - start + 1} unchanged lines`
        widget.title = 'Show the unchanged lines'

        // The line of the widget is the first of the range, which isn't shown
        const handle = editor.addLineClass(start, 'wrap', 'ide-collapsed-line')
        const mark = editor.markText(
          CodeMirror.Pos(start, 0),
          CodeMirror.Pos(end),
          { replacedWith: widget, inclusiveLeft: true, inclusiveRight: true }
        )
        CodeMirror.on(mark, 'clear', () => {
          editor.removeLineClass(handle, 'wrap', 'ide-collapsed-line')
          this.collapsed = this.collapsed.filter(c => c.mark !== mark)
        })
        widget.addEventListener('click', () => {
          mark.clear()
          this.refreshFoldGutter()
        })
        this.collapsed.push({ range, mark })
      }
    })

    this.refreshFoldGutter()
  }

  private getFoldGutterOptions() {
    return {
      gutter: FoldGutter,
      rangeFinder: this.findFoldRange,
      indicatorOpen: createFoldIndicator(false),
      indicatorFolded: createFoldIndicator(true),
    }
  }

  /**
   * Draw the fold buttons again, for the blocks that can or can't be folded
   * since lines were collapsed or shown. The gutter only redraws by itself
   * when the text changes.
   */
  private refreshFoldGutter() {
    this.editor?.setOption('foldGutter', this.getFoldGutterOptions())
  }

  private clearCollapsedLines() {
    const { collapsed } = this

    this.collapsedRanges = []
    this.editor?.operation(() => collapsed.forEach(({ mark }) => mark.clear()))
  }

  private async applyMode() {
    const editor = this.editor
    const { path, highlight } = this.props
    const requestId = ++this.modeRequestId

    if (editor === null) {
      return
    }

    editor.setOption('mode', 'text/plain')
    this.previousLines?.refresh()

    if (!highlight) {
      return
    }

    const mode = await loadMode(path)

    if (this.editor === editor && requestId === this.modeRequestId) {
      editor.setOption('mode', mode ?? 'text/plain')
      this.previousLines?.refresh()
    }
  }

  private clearInlineChanges() {
    this.inlineMarks.forEach(mark => mark.clear())
    this.inlineMarks = []
    this.inlineChanges = null
  }

  /** Mark the lines that differ from the committed version in the gutter. */
  private markChanges() {
    const editor = this.editor

    if (editor === null) {
      return
    }

    const { added, modified, removedBefore } = this.props.lineChanges
    const lineCount = editor.lineCount()

    editor.operation(() => {
      for (const { handle, where, className } of this.changeClasses) {
        editor.removeLineClass(handle, where, className)
      }

      this.changeClasses = []

      const mark = (
        line: number,
        where: 'gutter' | 'background' | 'text',
        className: string
      ) => {
        if (line >= 0 && line < lineCount) {
          this.changeClasses.push({
            handle: editor.addLineClass(line, where, className),
            where,
            className,
          })
        }
      }

      added.forEach(line => mark(line, 'gutter', 'change-added'))
      modified.forEach(line => mark(line, 'gutter', 'change-modified'))
      added.forEach(line => mark(line, 'text', 'ide-changed-line'))
      modified.forEach(line => mark(line, 'text', 'ide-changed-line'))

      added.forEach(line => mark(line, 'background', 'change-added-line'))
      modified.forEach(line => mark(line, 'background', 'change-modified-line'))

      // A line across the text where lines were removed
      removedBefore.forEach(line =>
        line >= lineCount
          ? mark(lineCount - 1, 'background', 'change-removed-after-line')
          : mark(line, 'background', 'change-removed-before-line')
      )

      removedBefore.forEach(line =>
        line >= lineCount
          ? mark(lineCount - 1, 'gutter', 'change-removed-after')
          : mark(line, 'gutter', 'change-removed-before')
      )

      const { inlineChanges } = this.props.lineChanges
      if (this.inlineChanges !== inlineChanges) {
        this.clearInlineChanges()
        this.inlineChanges = inlineChanges
        for (const { line, start, end } of inlineChanges) {
          this.inlineMarks.push(
            editor.markText(
              CodeMirror.Pos(line, start),
              CodeMirror.Pos(line, end),
              { className: 'ide-inline-change' }
            )
          )
        }
      }
    })

    this.scheduleRuler()
    this.previousLines?.setBlocks(this.props.lineChanges.previousLines)
  }

  /**
   * The buttons to fold blocks all show while the pointer is over the gutter.
   * The line numbers and buttons aren't inside the element of the gutter, so
   * the styles can't go by hovering it, and this is a class on the container
   * rather than state so that nothing is drawn again when the pointer moves.
   */
  private onMouseOver = (event: React.MouseEvent<HTMLDivElement>) => {
    const inGutter =
      event.target instanceof Element &&
      event.target.closest(
        '.CodeMirror-gutter-wrapper, .CodeMirror-gutters'
      ) !== null

    this.containerRef.current?.classList.toggle('gutter-hovered', inGutter)
  }

  private onMouseLeave = () => {
    this.containerRef.current?.classList.remove('gutter-hovered')
  }

  public render() {
    const { lineChanges, unchangedTextOpacity } = this.props
    const hasChanges =
      lineChanges.added.size > 0 ||
      lineChanges.modified.size > 0 ||
      lineChanges.removedBefore.size > 0
    const style = {
      '--ide-unchanged-text-opacity': hasChanges
        ? unchangedTextOpacity / 100
        : 1,
    } as React.CSSProperties

    return (
      // Hovering only shows an extra hint, and the keyboard has its own way to
      // reach it, so there is no focus event to pair this with.
      // eslint-disable-next-line jsx-a11y/mouse-events-have-key-events
      <div
        className="ide-code-editor"
        style={style}
        ref={this.containerRef}
        onMouseOver={this.onMouseOver}
        onMouseLeave={this.onMouseLeave}
      />
    )
  }
}

/** Mark a match of a search, in another way when it's the one gone to. */
function markSearchMatch(
  editor: CodeMirror.Editor,
  {
    from,
    to,
  }: { readonly from: CodeMirror.Position; readonly to: CodeMirror.Position },
  isCurrent: boolean
) {
  return editor.markText(from, to, {
    className: isCurrent ? 'ide-search-current' : 'ide-search-match',
  })
}

function isSameRanges(
  a: ReadonlyArray<ILineRange>,
  b: ReadonlyArray<ILineRange>
) {
  return (
    a.length === b.length &&
    a.every((range, i) => range.start === b[i].start && range.end === b[i].end)
  )
}

function isFoldMark(mark: CodeMirror.TextMarker): boolean {
  return (
    (mark as CodeMirror.TextMarker & { __isFold?: boolean }).__isFold === true
  )
}

/** The button in the gutter to fold a block, or to unfold it when it's folded */
function createFoldIndicator(folded: boolean): HTMLElement {
  const indicator = document.createElement('div')
  indicator.className = folded
    ? 'ide-fold-indicator folded'
    : 'ide-fold-indicator'
  indicator.setAttribute('role', 'button')
  indicator.setAttribute('aria-label', folded ? 'Unfold block' : 'Fold block')
  return indicator
}
