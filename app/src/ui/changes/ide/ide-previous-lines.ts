import CodeMirror from 'codemirror'
import 'codemirror/addon/runmode/runmode'

import { IPreviousLineBlock } from './ide-line-changes'

export type PreviousLinesMode = 'ghost' | 'hover'

const PreviousLinesGutter = 'ide-previous-lines-gutter'

interface IPreview {
  readonly block: IPreviousLineBlock
  readonly handle: CodeMirror.LineHandle
  readonly above: boolean
  expanded: boolean
  widget?: CodeMirror.LineWidget
}

/** Old code is display-only: widgets and gutter markers never enter the document. */
export class IdePreviousLines {
  private blocks: ReadonlyArray<IPreviousLineBlock> | null = null
  private previews: IPreview[] = []
  private mode: PreviousLinesMode = 'ghost'
  private popup: HTMLDivElement | null = null
  private popupMarker: HTMLButtonElement | null = null
  private pinned = false
  private closeTimeout: number | null = null

  public constructor(
    private readonly editor: CodeMirror.Editor,
    private readonly container: HTMLElement
  ) {
    editor.on('scroll', this.closePopup)
    editor.on('update', this.exposeHoverMarkers)
    window.addEventListener('resize', this.closePopup)
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
      expanded: false,
    }))
    this.refresh()
  }

  public setMode(mode: PreviousLinesMode) {
    if (this.mode !== mode) {
      this.mode = mode
      this.refresh()
    }
  }

  /** Also called when the syntax mode or tab width changes. */
  public refresh() {
    this.closePopup()
    this.editor.operation(() => {
      this.clearPresentation()
      const gutters = (this.editor.getOption('gutters') ?? []).filter(
        gutter => gutter !== PreviousLinesGutter
      )
      if (this.mode === 'hover' && this.previews.length > 0) {
        gutters.push(PreviousLinesGutter)
      }
      this.editor.setOption('gutters', gutters)

      for (const preview of this.previews) {
        // The handle follows edits; a removed anchor no longer has a preview.
        if (this.editor.getLineNumber(preview.handle) === null) {
          continue
        }
        if (this.mode === 'ghost') {
          this.addGhost(preview)
        } else {
          this.addHoverMarker(preview)
        }
      }
    })
  }

  public clear() {
    this.closePopup()
    this.editor.operation(() => this.clearPresentation())
    this.blocks = null
    this.previews = []
  }

  public destroy() {
    this.clear()
    this.editor.off('scroll', this.closePopup)
    this.editor.off('update', this.exposeHoverMarkers)
    window.removeEventListener('resize', this.closePopup)
  }

  private clearPresentation() {
    for (const preview of this.previews) {
      preview.widget?.clear()
      preview.widget = undefined
    }
    this.editor.clearGutter(PreviousLinesGutter)
  }

  private exposeHoverMarkers = () => {
    // CodeMirror hides gutter wrappers from assistive technology by default.
    for (const markers of this.container.querySelectorAll(
      '.ide-previous-lines-markers'
    )) {
      const wrapper = markers.closest('.CodeMirror-gutter-wrapper')
      wrapper?.removeAttribute('aria-hidden')
      for (const element of wrapper?.children ?? []) {
        if (!element.contains(markers)) {
          element.setAttribute('aria-hidden', 'true')
        }
      }
    }
  }

  private addGhost(preview: IPreview) {
    const node = document.createElement('div')
    node.className = 'ide-previous-lines-ghost'
    const toggle = document.createElement('button')
    toggle.type = 'button'
    toggle.className = 'ide-previous-lines-toggle'
    const rows = document.createElement('div')
    const update = () => {
      toggle.textContent = `${
        preview.expanded ? '▾ Hide' : '▸ Show'
      } ${lineLabel(preview.block)}`
      toggle.setAttribute('aria-expanded', String(preview.expanded))
      rows.replaceChildren()
      if (preview.expanded) {
        rows.appendChild(this.createRows(preview.block))
      }
    }
    toggle.addEventListener('click', () => {
      preview.expanded = !preview.expanded
      update()
      preview.widget?.changed()
    })
    update()
    node.append(toggle, rows)
    preview.widget = this.editor.addLineWidget(preview.handle, node, {
      above: preview.above,
      coverGutter: true,
      noHScroll: true,
    })
  }

  private addHoverMarker(preview: IPreview) {
    const marker = document.createElement('button')
    marker.type = 'button'
    marker.className = 'ide-previous-lines-marker'
    marker.textContent = '−'
    marker.setAttribute('aria-label', `Preview ${lineLabel(preview.block)}`)
    marker.setAttribute('aria-haspopup', 'dialog')
    marker.addEventListener('mouseenter', () => this.showPopup(preview, marker))
    marker.addEventListener('focus', () => this.showPopup(preview, marker))
    marker.addEventListener('mouseleave', this.scheduleClose)
    marker.addEventListener('blur', this.scheduleClose)
    marker.addEventListener('click', () => {
      this.showPopup(preview, marker)
      this.pinPopup()
    })
    const existing = this.editor.lineInfo(preview.handle)?.gutterMarkers?.[
      PreviousLinesGutter
    ]
    if (existing) {
      existing.appendChild(marker)
    } else {
      const markers = document.createElement('div')
      markers.className = 'ide-previous-lines-markers'
      markers.appendChild(marker)
      this.editor.setGutterMarker(preview.handle, PreviousLinesGutter, markers)
    }
  }

  private showPopup(preview: IPreview, marker: HTMLButtonElement) {
    this.cancelClose()
    if (this.popupMarker === marker || this.pinned) {
      return
    }
    this.closePopup()
    const popup = document.createElement('div')
    popup.className = 'ide-previous-lines-popup cm-s-default'
    popup.setAttribute('role', 'dialog')
    popup.setAttribute('aria-label', lineLabel(preview.block))
    const header = document.createElement('div')
    header.className = 'ide-previous-lines-popup-header'
    const title = document.createElement('span')
    title.textContent = lineLabel(preview.block)
    const pin = document.createElement('button')
    pin.type = 'button'
    pin.textContent = 'Keep open'
    pin.addEventListener('click', () => this.pinPopup())
    const close = document.createElement('button')
    close.type = 'button'
    close.textContent = 'Close'
    close.addEventListener('click', this.closePopup)
    header.append(title, pin, close)
    popup.append(header, this.createRows(preview.block))
    popup.addEventListener('mouseenter', this.cancelClose)
    popup.addEventListener('mouseleave', this.scheduleClose)
    popup.addEventListener('focusin', this.cancelClose)
    popup.addEventListener('focusout', this.scheduleClose)
    this.container.appendChild(popup)
    this.popup = popup
    document.addEventListener('keydown', this.onKeyDown)
    this.popupMarker = marker
    marker.setAttribute('aria-expanded', 'true')

    const bounds = this.container.getBoundingClientRect()
    const anchor = marker.getBoundingClientRect()
    popup.style.left = `${Math.max(
      4,
      Math.min(
        anchor.right - bounds.left + 8,
        bounds.width - popup.offsetWidth - 4
      )
    )}px`
    popup.style.top = `${Math.max(
      4,
      Math.min(anchor.top - bounds.top, bounds.height - popup.offsetHeight - 4)
    )}px`
  }

  private pinPopup() {
    this.pinned = true
    this.cancelClose()
    const button = this.popup?.querySelector('button')
    if (button !== null && button !== undefined) {
      button.textContent = 'Kept open'
      button.disabled = true
    }
  }

  private cancelClose = () => {
    if (this.closeTimeout !== null) {
      window.clearTimeout(this.closeTimeout)
      this.closeTimeout = null
    }
  }

  private scheduleClose = () => {
    this.cancelClose()
    if (!this.pinned) {
      this.closeTimeout = window.setTimeout(() => {
        if (!this.popup?.contains(document.activeElement)) {
          this.closePopup()
        }
      }, 250)
    }
  }

  private closePopup = () => {
    this.cancelClose()
    document.removeEventListener('keydown', this.onKeyDown)
    this.popup?.remove()
    this.popup = null
    this.popupMarker?.setAttribute('aria-expanded', 'false')
    this.popupMarker = null
    this.pinned = false
  }

  private onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape' && this.popup !== null) {
      // Focus before closing, so the marker's focus handler cannot reopen it.
      this.popupMarker?.focus()
      this.closePopup()
      event.preventDefault()
      event.stopPropagation()
    }
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
      const lineNumber = document.createElement('span')
      lineNumber.className = 'ide-previous-line-number'
      lineNumber.textContent = String(block.oldLineNumber + i)
      const minus = document.createElement('span')
      minus.className = 'ide-previous-line-minus'
      minus.textContent = '−'
      minus.setAttribute('aria-hidden', 'true')
      const code = document.createElement('code')
      code.style.tabSize = String(this.editor.getOption('tabSize'))
      row.append(lineNumber, minus, code)
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

function lineLabel(block: IPreviousLineBlock): string {
  return `${block.lines.length} previous ${
    block.lines.length === 1 ? 'line' : 'lines'
  }`
}
