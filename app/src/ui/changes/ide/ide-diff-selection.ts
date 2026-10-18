import CodeMirror from 'codemirror'
import { IPreviousLineBlock } from './ide-line-changes'

const CodeSelector =
  '.CodeMirror-code pre.CodeMirror-line, .CodeMirror-code .ide-previous-line code'

interface IPreviousBlock {
  readonly block: IPreviousLineBlock
  readonly handle: CodeMirror.LineHandle
  readonly above: boolean
  readonly node?: HTMLElement
}

interface ISelectionPoint {
  /** A document line, or a row within a previous block. */
  readonly line: number
  readonly ch: number
  readonly block?: IPreviousBlock
}

interface ISelectionRow {
  readonly line: number
  readonly text: string
  readonly block?: IPreviousBlock
}

/** Select displayed old and current code together without editing the document. */
export class IdeDiffSelection {
  private enabled = false
  private dragging = false
  private anchor: ISelectionPoint | null = null
  private head: ISelectionPoint | null = null
  private anchorElement: Element | null = null
  private readonly lines = new WeakMap<Element, CodeMirror.LineHandle>()

  public constructor(
    private readonly editor: CodeMirror.Editor,
    private readonly previousBlocks: () => ReadonlyArray<IPreviousBlock>
  ) {
    // Keep keyboard commands in the viewer while selecting display-only code.
    editor.getWrapperElement().tabIndex = -1
  }

  /** The selected old and current code, or null for an editor-only selection. */
  public getSelectedText(): string | null {
    const selection = this.getSelection()
    if (!selection || selection.isCollapsed) {
      return null
    }
    const selected = this.selectedRows()
    if (!selected || !selected.rows.some(row => row.block !== undefined)) {
      return null
    }
    return selected.rows
      .map((row, index) =>
        row.text.slice(
          index === 0 ? selected.start : 0,
          index === selected.rows.length - 1 ? selected.end : undefined
        )
      )
      .join('\n')
  }

  /** Select both versions when expanded, otherwise leave selection to the editor. */
  public selectAll(): boolean {
    if (!this.enabled) {
      return false
    }
    const code = this.editor
      .getWrapperElement()
      .querySelector('.CodeMirror-code')
    if (!code) {
      return false
    }
    this.clearSelection()
    const firstLine = this.editor.firstLine()
    const lastLine = this.editor.lastLine()
    const blocks = this.previousBlocks()
    const first = blocks.find(
      block =>
        block.above && this.editor.getLineNumber(block.handle) === firstLine
    )
    const last = blocks
      .filter(
        block =>
          !block.above && this.editor.getLineNumber(block.handle) === lastLine
      )
      .pop()
    this.anchor = first
      ? { block: first, line: 0, ch: 0 }
      : { line: firstLine, ch: 0 }
    this.head = last
      ? {
          block: last,
          line: last.block.lines.length - 1,
          ch: last.block.lines[last.block.lines.length - 1].length,
        }
      : { line: lastLine, ch: this.editor.getLine(lastLine).length }
    this.editor.getInputField().blur()
    this.editor.getWrapperElement().focus({ preventScroll: true })
    this.editor.getWrapperElement().classList.add('ide-selecting-diff')
    document.getSelection()?.selectAllChildren(code)
    return true
  }

  public setEnabled(enabled: boolean) {
    if (this.enabled === enabled) {
      return
    }

    this.enabled = enabled
    const wrapper = this.editor.getWrapperElement()
    wrapper.classList.toggle('ide-diff-selection-enabled', enabled)
    if (enabled) {
      this.editor.on('focus', this.clearSelection)
      this.editor.on('renderLine', this.onRenderLine)
      wrapper.addEventListener('mousedown', this.onMouseDown, true)
      wrapper.addEventListener('selectstart', this.onSelectStart, true)
      document.addEventListener('copy', this.onCopy, true)
      document.addEventListener('cut', this.onCopy, true)
      // Associate already rendered lines with their document handles, too.
      this.editor.refresh()
    } else {
      this.editor.off('focus', this.clearSelection)
      this.editor.off('renderLine', this.onRenderLine)
      wrapper.removeEventListener('mousedown', this.onMouseDown, true)
      wrapper.removeEventListener('selectstart', this.onSelectStart, true)
      document.removeEventListener('copy', this.onCopy, true)
      document.removeEventListener('cut', this.onCopy, true)
      this.endDrag()
      this.clearSelection()
    }
  }

  private onRenderLine = (
    editor: CodeMirror.Editor,
    line: CodeMirror.LineHandle,
    element: HTMLElement
  ) => {
    this.lines.set(element, line)
  }

  private onMouseDown = (event: MouseEvent) => {
    if (
      event.button !== 0 ||
      event.ctrlKey ||
      event.metaKey ||
      event.altKey ||
      event.shiftKey ||
      !(event.target instanceof Element) ||
      !event.target.closest(CodeSelector) ||
      event.target.closest('.ide-collapsed-lines, .ide-fold-ellipsis')
    ) {
      return
    }

    // CodeMirror otherwise prevents native selection on its document lines.
    event.stopPropagation()
    this.clearSelection()
    this.anchorElement = event.target.closest(CodeSelector)
    this.anchor = this.pointFromMouse(event)
    this.editor.getInputField().blur()
    this.editor.getWrapperElement().focus({ preventScroll: true })
    this.editor.getWrapperElement().classList.add('ide-selecting-diff')
    this.dragging = true
    document.addEventListener('mousemove', this.onMouseMove, true)
    document.addEventListener('mouseup', this.onMouseUp, true)
  }

  private onSelectStart = (event: Event) => {
    if (this.dragging) {
      event.stopPropagation()
    }
  }

  private onMouseMove = (event: MouseEvent) => {
    // Native ranges lose their anchor when CodeMirror scrolls it out of the
    // rendered viewport. Keep the source position and highlight the visible
    // part of the range until the mouse is released.
    if (this.anchorElement?.isConnected !== false || this.anchor === null) {
      return
    }
    const caret = document.caretRangeFromPoint?.(event.clientX, event.clientY)
    if (!caret) {
      return
    }
    this.head = this.pointAt(caret.startContainer, caret.startOffset)
    const codes = this.editor.getWrapperElement().querySelectorAll(CodeSelector)
    const anchorLine = this.documentLine(this.anchor)
    const headLine = this.head && this.documentLine(this.head)
    const code =
      anchorLine !== null && headLine !== null && anchorLine <= headLine
        ? codes[0]
        : codes[codes.length - 1]
    if (!code) {
      return
    }
    const visibleAnchor = document.createRange()
    visibleAnchor.selectNodeContents(code)
    visibleAnchor.collapse(code === codes[0])
    event.preventDefault()
    document
      .getSelection()
      ?.setBaseAndExtent(
        visibleAnchor.startContainer,
        visibleAnchor.startOffset,
        caret.startContainer,
        caret.startOffset
      )
  }

  private endDrag() {
    document.removeEventListener('mousemove', this.onMouseMove, true)
    document.removeEventListener('mouseup', this.onMouseUp, true)
    this.dragging = false
  }

  private onMouseUp = (event: MouseEvent) => {
    this.endDrag()
    const selection = this.getSelection()
    if (selection && this.anchorElement?.isConnected) {
      this.anchor = selection.anchorNode
        ? this.pointAt(selection.anchorNode, selection.anchorOffset)
        : null
      this.head = selection.focusNode
        ? this.pointAt(selection.focusNode, selection.focusOffset)
        : null
    } else {
      this.head = this.pointFromMouse(event)
    }
    const selected = this.selectedRows()
    if (!selected || selected.rows.some(row => row.block !== undefined)) {
      return
    }

    // Current code goes back to CodeMirror so typing and keyboard selection
    // keep working. Selections containing old code remain display-only.
    const { anchor, head } = this
    this.clearSelection()
    if (anchor && head) {
      this.editor.setSelection(anchor, head)
      this.editor.focus()
    }
  }

  private pointFromMouse(event: MouseEvent): ISelectionPoint | null {
    const caret = document.caretRangeFromPoint?.(event.clientX, event.clientY)
    return caret
      ? this.pointAt(caret.startContainer, caret.startOffset)
      : this.editor.coordsChar({ left: event.clientX, top: event.clientY })
  }

  private pointAt(node: Node, offset: number): ISelectionPoint | null {
    const code = (node instanceof Element ? node : node.parentElement)?.closest(
      CodeSelector
    )
    if (!code) {
      return null
    }
    const prefix = document.createRange()
    prefix.selectNodeContents(code)
    prefix.setEnd(node, offset)
    const contents = prefix.cloneContents()
    for (const token of contents.querySelectorAll('[cm-text]')) {
      token.replaceWith(token.getAttribute('cm-text') ?? '')
    }
    const ch = contents.textContent?.length ?? 0
    const handle = this.lines.get(code)
    if (handle) {
      const line = this.editor.getLineNumber(handle)
      // A folded visual line can contain several document lines.
      if (code.querySelector('.ide-fold-ellipsis')) {
        const caret = document.createRange()
        caret.setStart(node, offset)
        caret.collapse(true)
        const rect = caret.getBoundingClientRect()
        return this.editor.coordsChar({
          left: rect.left,
          top: rect.top + rect.height / 2,
        })
      }
      return line === null
        ? null
        : { line, ch: Math.min(ch, handle.text.length) }
    }
    const block = this.previousBlocks().find(block =>
      block.node?.contains(code)
    )
    if (!block?.node) {
      return null
    }
    const line = Array.from(
      block.node.querySelectorAll<Element>('code')
    ).indexOf(code)
    return { block, line, ch }
  }

  private getSelection(): Selection | null {
    const selection = document.getSelection()
    const wrapper = this.editor.getWrapperElement()
    return selection?.rangeCount &&
      wrapper.contains(selection.anchorNode) &&
      wrapper.contains(selection.focusNode)
      ? selection
      : null
  }

  private clearSelection = () => {
    this.getSelection()?.removeAllRanges()
    this.anchor = null
    this.head = null
    this.anchorElement = null
    this.editor.getWrapperElement().classList.remove('ide-selecting-diff')
  }

  private documentLine(point: ISelectionPoint): number | null {
    return point.block
      ? this.editor.getLineNumber(point.block.handle)
      : point.line
  }

  private selectedRows() {
    if (!this.anchor || !this.head) {
      return null
    }
    const rows: ISelectionRow[] = []
    const blocks = this.previousBlocks()
    const anchorLine = this.documentLine(this.anchor)
    const headLine = this.documentLine(this.head)
    if (anchorLine === null || headLine === null) {
      return null
    }
    let line = Math.min(anchorLine, headLine)
    const anchored = new Map<CodeMirror.LineHandle, IPreviousBlock[]>()
    for (const block of blocks) {
      const group = anchored.get(block.handle)
      if (group) {
        group.push(block)
      } else {
        anchored.set(block.handle, [block])
      }
    }
    const appendBlock = (block: IPreviousBlock) =>
      block.block.lines.forEach((text, line) =>
        rows.push({ block, line, text })
      )
    this.editor.eachLine(line, Math.max(anchorLine, headLine) + 1, handle => {
      const group = anchored.get(handle) ?? []
      group.filter(block => block.above).forEach(appendBlock)
      rows.push({ line: line++, text: handle.text })
      group.filter(block => !block.above).forEach(appendBlock)
    })
    const indexOf = (point: ISelectionPoint) =>
      rows.findIndex(
        row => row.block === point.block && row.line === point.line
      )
    const anchorIndex = indexOf(this.anchor)
    const headIndex = indexOf(this.head)
    if (anchorIndex < 0 || headIndex < 0) {
      return null
    }
    const forwards =
      anchorIndex < headIndex ||
      (anchorIndex === headIndex && this.anchor.ch <= this.head.ch)
    const start = forwards ? this.anchor : this.head
    const end = forwards ? this.head : this.anchor
    return {
      rows: rows.slice(
        Math.min(anchorIndex, headIndex),
        Math.max(anchorIndex, headIndex) + 1
      ),
      start: start.ch,
      end: end.ch,
    }
  }

  private onCopy = (event: ClipboardEvent) => {
    const text = this.getSelectedText()
    if (text === null || !event.clipboardData) {
      return
    }
    event.preventDefault()
    event.stopPropagation()
    event.clipboardData.setData('text/plain', text)
  }
}
