import * as React from 'react'
import * as Path from 'path'
import CodeMirror from 'codemirror'
import 'codemirror/addon/fold/foldcode'
import 'codemirror/addon/fold/foldgutter'
import 'codemirror/mode/meta'

import { getFoldRanges, getFoldRangesByStart, IFoldRange } from './ide-folding'
import {
  detectIndentUnit,
  getIndentGuidesStyle,
  getLineIndentation,
} from './ide-indentation'
import { ILineChanges } from './ide-line-changes'

/** Padding to the left of the text of a line, keep in sync with the styles. */
const TextPadding = 12

/** Files with more lines than this don't get their indentation worked out. */
const MaxAnalyzedLines = 50000

const FoldGutter = 'ide-fold-gutter'

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

  /** The lines that differ from the committed version, to mark in the gutter */
  readonly lineChanges: ILineChanges

  /** Whether to also give those lines a color in the background */
  readonly highlightChanges: boolean

  /** Called when the text starts or stops differing from the saved text. */
  readonly onDirtyChange: (isDirty: boolean) => void

  /** Called when the user asks to save the file. */
  readonly onSave: () => void
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

  /** The classes added to the lines to mark the changes, to take them off */
  private changeClasses = new Array<{
    readonly handle: CodeMirror.LineHandle
    readonly where: 'gutter' | 'background'
    readonly className: string
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
      lineWrapping: false,
      viewportMargin: 20,
      gutters: ['CodeMirror-linenumbers', FoldGutter],
      foldGutter: {
        gutter: FoldGutter,
        rangeFinder: this.findFoldRange,
        indicatorOpen: createFoldIndicator(false),
        indicatorFolded: createFoldIndicator(true),
      },
      foldOptions: {
        rangeFinder: this.findFoldRange,
        widget: this.createFoldWidget,
      },
      extraKeys: {
        'Ctrl-S': save,
        'Cmd-S': save,
        Tab: cm => this.onTab(cm),
        'Shift-Tab': 'indentLess',
      },
    })

    this.editor = editor
    editor.on('renderLine', this.onRenderLine)
    editor.on('changes', this.onChanges)
    editor.on('update', this.onUpdate)

    // Drawn over the scroll bar, where it shows where the changes are
    const ruler = document.createElement('div')
    ruler.className = 'ide-change-ruler'
    ruler.setAttribute('aria-hidden', 'true')
    container.appendChild(ruler)
    this.ruler = ruler

    this.setText()
    this.applyMode()
  }

  public componentDidUpdate(prevProps: IIdeCodeEditorProps) {
    const editor = this.editor

    if (editor === null) {
      return
    }

    const { path, revision, tabSize, readOnly, highlight, lineChanges } =
      this.props

    if (prevProps.tabSize !== tabSize) {
      editor.setOption('tabSize', tabSize)
      editor.setOption('indentUnit', tabSize)
    }

    if (prevProps.readOnly !== readOnly) {
      editor.setOption('readOnly', readOnly)
    }

    if (prevProps.path !== path || prevProps.highlight !== highlight) {
      this.applyMode()
    }

    if (prevProps.path !== path || prevProps.revision !== revision) {
      this.setText(prevProps.path === path)
    } else if (
      prevProps.lineChanges !== lineChanges ||
      prevProps.highlightChanges !== this.props.highlightChanges
    ) {
      this.markChanges()
    }
  }

  public componentWillUnmount() {
    if (this.rulerFrameId !== null) {
      window.cancelAnimationFrame(this.rulerFrameId)
    }
    this.ruler = null

    this.modeRequestId++
    this.editor = null
    this.containerRef.current?.replaceChildren()
  }

  /** The lines of the text in the editor. */
  public getLines(): ReadonlyArray<string> {
    return this.editor?.getDoc().getValue('\n').split('\n') ?? []
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
  }

  public focus() {
    this.editor?.focus()
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

    editor.operation(() => {
      for (const mark of editor.findMarksAt(CodeMirror.Pos(line, 0))) {
        if (isFoldMark(mark)) {
          mark.clear()
        }
      }
    })

    const { clientHeight } = editor.getScrollInfo()
    const top = Math.max(
      0,
      editor.heightAtLine(line, 'local') - Math.floor(clientHeight / 3)
    )

    editor.scrollTo(null, top)
    this.lastJump = { line, top: editor.getScrollInfo().top }
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

    if (range === undefined) {
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
  }

  private async applyMode() {
    const editor = this.editor
    const { path, highlight } = this.props
    const requestId = ++this.modeRequestId

    if (editor === null) {
      return
    }

    editor.setOption('mode', 'text/plain')

    if (!highlight) {
      return
    }

    const mode = await loadMode(path)

    if (this.editor === editor && requestId === this.modeRequestId) {
      editor.setOption('mode', mode ?? 'text/plain')
    }
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
        where: 'gutter' | 'background',
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

      if (this.props.highlightChanges) {
        added.forEach(line => mark(line, 'background', 'change-added-line'))
        modified.forEach(line =>
          mark(line, 'background', 'change-modified-line')
        )

        // A line across the text where lines were removed
        removedBefore.forEach(line =>
          line >= lineCount
            ? mark(lineCount - 1, 'background', 'change-removed-after-line')
            : mark(line, 'background', 'change-removed-before-line')
        )
      }

      removedBefore.forEach(line =>
        line >= lineCount
          ? mark(lineCount - 1, 'gutter', 'change-removed-after')
          : mark(line, 'gutter', 'change-removed-before')
      )
    })

    this.scheduleRuler()
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
    return (
      <div
        className="ide-code-editor"
        ref={this.containerRef}
        onMouseOver={this.onMouseOver}
        onMouseLeave={this.onMouseLeave}
      />
    )
  }
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
