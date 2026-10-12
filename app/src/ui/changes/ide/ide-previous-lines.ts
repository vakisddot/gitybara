import CodeMirror from 'codemirror'
import 'codemirror/addon/runmode/runmode'

import { IPreviousLineBlock } from './ide-line-changes'

const PreviousLinesGutter = 'ide-previous-lines-gutter'

/** How long the old lines take to open or close, in milliseconds */
const ExpandDuration = 300

interface IPreview {
  readonly block: IPreviousLineBlock
  readonly handle: CodeMirror.LineHandle
  readonly above: boolean
  widget?: CodeMirror.LineWidget
  node?: HTMLElement
}

/** Where the line that is read is on the screen, to keep it there */
interface IReadLine {
  readonly line: number

  /** From the top of the screen to the top of the line, in pixels */
  readonly offset: number
}

/** The old lines that are drawn opening or closing */
interface IExpansion {
  /** The blocks that are drawn, and how high they are when open */
  readonly blocks: ReadonlyArray<{
    readonly preview: IPreview
    readonly height: number
  }>
  readonly readLine: IReadLine

  /** How far open the blocks are, from 0 to 1 */
  progress: number

  /** Whether they are opening, otherwise closing */
  opening: boolean
  time: number
  frameId: number
}

/**
 * The lines that were removed or replaced. While they are hidden, the gutter
 * counts them where they were, and they are shown all at once.
 *
 * Old code is display-only: widgets and gutter markers never enter the document.
 */
export class IdePreviousLines {
  private blocks: ReadonlyArray<IPreviousLineBlock> | null = null
  private previews: IPreview[] = []
  private shown = false

  private expansion: IExpansion | null = null

  /** The widths the old lines were last lined up with, in pixels */
  private gutterWidth = -1
  private lineNumberWidth = -1

  public constructor(private readonly editor: CodeMirror.Editor) {
    editor.on('update', this.lineUpWithGutter)
  }

  public setBlocks(blocks: ReadonlyArray<IPreviousLineBlock>) {
    if (this.blocks === blocks) {
      return
    }

    this.clear()
    this.blocks = blocks
    const count = this.editor.lineCount()
    this.previews = blocks.map(block => ({
      block,
      handle: this.editor.getLineHandle(Math.min(block.line, count - 1)),
      above: block.line < count,
    }))
    this.refresh()
  }

  /**
   * Show or hide the previous lines. The blocks on the screen grow open and
   * shrink closed, unless the system asks for less motion. What is above the
   * line that is read stays where it is, so they open and close at that line.
   */
  public setShown(shown: boolean) {
    if (this.shown === shown) {
      return
    }

    this.shown = shown

    // It turns around from where it is
    if (this.expansion !== null) {
      this.expansion.opening = shown
      return
    }

    const readLine = this.getReadLine()

    if (shown) {
      this.refresh()
    }

    // The blocks that aren't drawn are already where they end up
    const blocks = this.previews.flatMap(preview =>
      preview.node?.isConnected === true
        ? [{ preview, height: preview.node.offsetHeight }]
        : []
    )

    if (!isMotionWanted() || blocks.length === 0) {
      if (!shown) {
        this.refresh()
      }
      this.keepInPlace(readLine)
      return
    }

    const expansion: IExpansion = {
      blocks,
      readLine,
      progress: shown ? 0 : 1,
      opening: shown,
      time: performance.now(),
      frameId: 0,
    }
    this.expansion = expansion
    this.drawExpansion(expansion)
    expansion.frameId = requestAnimationFrame(this.onExpansionFrame)
  }

  /** Also called when the syntax mode or tab width changes. */
  public refresh() {
    this.stopExpansion()
    this.editor.operation(() => {
      this.clearPresentation()

      // The gutter stays while the lines are shown, so the text doesn't move
      // sideways when they are shown or hidden
      const gutters = (this.editor.getOption('gutters') ?? []).filter(
        gutter => gutter !== PreviousLinesGutter
      )
      if (this.previews.length > 0) {
        gutters.push(PreviousLinesGutter)
      }
      this.editor.setOption('gutters', gutters)

      // Lines removed before and after the last line are counted together
      const hiddenCounts = new Map<CodeMirror.LineHandle, number>()

      for (const preview of this.previews) {
        // The handle follows edits; a removed anchor no longer has a preview.
        if (this.editor.getLineNumber(preview.handle) === null) {
          continue
        }

        if (this.shown) {
          this.addWidget(preview)
        } else {
          hiddenCounts.set(
            preview.handle,
            (hiddenCounts.get(preview.handle) ?? 0) + preview.block.lines.length
          )
        }
      }

      for (const [handle, count] of hiddenCounts) {
        this.editor.setGutterMarker(
          handle,
          PreviousLinesGutter,
          createCount(count)
        )
      }
    })
  }

  public clear() {
    this.stopExpansion()
    this.editor.operation(() => this.clearPresentation())
    this.blocks = null
    this.previews = []
  }

  private clearPresentation() {
    for (const preview of this.previews) {
      preview.widget?.clear()
      preview.widget = undefined
      preview.node = undefined
    }
    this.editor.clearGutter(PreviousLinesGutter)
  }

  private onExpansionFrame = () => {
    const expansion = this.expansion

    if (expansion === null) {
      return
    }

    const now = performance.now()
    const step = (now - expansion.time) / ExpandDuration
    expansion.time = now
    expansion.progress = expansion.opening
      ? Math.min(1, expansion.progress + step)
      : Math.max(0, expansion.progress - step)

    if (expansion.progress === (expansion.opening ? 1 : 0)) {
      this.endExpansion(expansion)
    } else {
      this.drawExpansion(expansion)
      expansion.frameId = requestAnimationFrame(this.onExpansionFrame)
    }
  }

  /** The blocks are as high as they are open, and fade in as they open. */
  private drawExpansion({ blocks, progress, readLine }: IExpansion) {
    const eased = easeInOut(progress)

    for (const { preview, height } of blocks) {
      const style = preview.node?.style
      if (style !== undefined) {
        style.overflow = 'hidden'
        style.height = `${height * eased}px`
        style.opacity = String(eased)
      }
    }

    // CodeMirror measures them again, to know where the lines below them go
    this.editor.operation(() =>
      blocks.forEach(({ preview }) => preview.widget?.changed())
    )
    this.keepInPlace(readLine)
  }

  private endExpansion(expansion: IExpansion) {
    this.stopExpansion()

    if (expansion.opening) {
      for (const { preview } of expansion.blocks) {
        preview.node?.style.removeProperty('overflow')
        preview.node?.style.removeProperty('height')
        preview.node?.style.removeProperty('opacity')
      }
      this.editor.operation(() =>
        expansion.blocks.forEach(({ preview }) => preview.widget?.changed())
      )
    } else {
      this.refresh()
    }

    this.keepInPlace(expansion.readLine)
  }

  /** The blocks stay as they are drawn, for what is done to them next */
  private stopExpansion() {
    if (this.expansion !== null) {
      cancelAnimationFrame(this.expansion.frameId)
      this.expansion = null
    }
  }

  private keepInPlace({ line, offset }: IReadLine) {
    this.editor.scrollTo(
      null,
      this.editor.heightAtLine(line, 'local', true) - offset
    )
  }

  /**
   * The old lines are drawn over the gutter, so their numbers and text start
   * where those of the lines of the file do. The widths of the gutter are given
   * to the styles, as they change with the number of lines and the gutters.
   */
  private lineUpWithGutter = () => {
    const gutters = this.editor.getGutterElement()
    const gutterWidth = gutters.offsetWidth
    const lineNumberWidth =
      gutters.querySelector<HTMLElement>('.CodeMirror-linenumbers')
        ?.offsetWidth ?? 0

    if (
      gutterWidth === this.gutterWidth &&
      lineNumberWidth === this.lineNumberWidth
    ) {
      return
    }

    this.gutterWidth = gutterWidth
    this.lineNumberWidth = lineNumberWidth
    const { style } = this.editor.getWrapperElement()
    style.setProperty('--ide-gutter-width', `${gutterWidth}px`)
    style.setProperty('--ide-line-number-width', `${lineNumberWidth}px`)
  }

  /**
   * The line that is read and where it is: the one with the cursor while it's on
   * the screen, otherwise the one a third of the way down, where a jump to a
   * change puts it.
   */
  private getReadLine(): IReadLine {
    const editor = this.editor
    const { top, clientHeight } = editor.getScrollInfo()
    const cursor = editor.getCursor().line
    const cursorTop = editor.heightAtLine(cursor, 'local')
    const line =
      cursorTop >= top && cursorTop < top + clientHeight
        ? cursor
        : editor.lineAtHeight(top + clientHeight / 3, 'local')

    return { line, offset: editor.heightAtLine(line, 'local', true) - top }
  }

  private addWidget(preview: IPreview) {
    const node = document.createElement('div')
    node.className = 'ide-previous-lines-block'
    node.setAttribute('role', 'group')
    node.setAttribute('aria-label', linesLabel(preview.block.lines.length))
    node.appendChild(this.createRows(preview.block))
    preview.node = node
    // The text scrolls sideways with the text of the file, and old lines that
    // are longer than all of those make the file scroll further
    preview.widget = this.editor.addLineWidget(preview.handle, node, {
      above: preview.above,
      coverGutter: true,
    })
  }

  private createRows(block: IPreviousLineBlock): HTMLElement {
    const rows = document.createElement('div')
    rows.className = 'ide-previous-lines-rows'
    const changes = new Map(
      block.inlineChanges.map(range => [range.line, range])
    )
    const codeNodes = block.lines.map((_, i) => {
      const row = document.createElement('div')
      row.className = 'ide-previous-line'
      const gutter = document.createElement('span')
      gutter.className = 'ide-previous-line-gutter'
      const lineNumber = document.createElement('span')
      lineNumber.className = 'ide-previous-line-number'
      lineNumber.textContent = String(block.oldLineNumber + i)
      const minus = document.createElement('span')
      minus.className = 'ide-previous-line-minus'
      minus.textContent = '−'
      minus.setAttribute('aria-hidden', 'true')
      gutter.append(lineNumber, minus)
      const code = document.createElement('code')
      code.style.tabSize = String(this.editor.getOption('tabSize'))
      row.append(gutter, code)
      rows.appendChild(row)
      return code
    })
    CodeMirror.runMode(
      block.lines.join('\n'),
      this.editor.getOption('mode') ?? 'text/plain',
      (text, style, row, column) => {
        if (row === undefined || column === undefined) {
          return
        }

        const appendToken = (content: string, changed = false) => {
          if (content.length === 0) {
            return
          }
          const token = document.createElement('span')
          if (style) {
            token.className = `cm-${style.replace(/ /g, ' cm-')}`
          }
          if (changed) {
            token.classList.add('ide-inline-deletion')
          }
          token.textContent = content
          codeNodes[row].appendChild(token)
        }
        const range = changes.get(row)
        if (
          range === undefined ||
          range.end <= column ||
          range.start >= column + text.length
        ) {
          appendToken(text)
          return
        }

        // A changed span can start/end inside a syntax token or cross several.
        const start = Math.max(0, range.start - column)
        const end = Math.min(text.length, range.end - column)
        appendToken(text.slice(0, start))
        appendToken(text.slice(start, end), true)
        appendToken(text.slice(end))
      }
    )
    return rows
  }
}

/** Slow at the start and the end, from 0 to 1 */
function easeInOut(progress: number): number {
  return progress < 0.5 ? 4 * progress ** 3 : 1 - (-2 * progress + 2) ** 3 / 2
}

/** Whether to animate, as the system can ask for less motion */
function isMotionWanted(): boolean {
  return (
    typeof window.matchMedia === 'function' &&
    !window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}

/** The number of hidden lines, in the gutter where they were. */
function createCount(count: number): HTMLElement {
  const marker = document.createElement('div')
  marker.className = 'ide-previous-lines-count'
  marker.textContent = `−${count}`
  marker.title = linesLabel(count)
  return marker
}

function linesLabel(count: number): string {
  return `${count} previous ${count === 1 ? 'line' : 'lines'}`
}
