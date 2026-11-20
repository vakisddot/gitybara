import CodeMirror from 'codemirror'

import {
  IReviewComment,
  ReviewCommentSide,
} from '../../../models/review-comment'
import { IPreviousLineBlock } from './ide-line-changes'

/** The gutter with the button to comment on a line. */
export const CommentGutter = 'ide-comment-gutter'

/** The line a comment is written on. */
export interface IReviewTarget {
  readonly side: ReviewCommentSide

  /** The 1-based number of the line in that version of the file. */
  readonly line: number

  /** The text of the line. */
  readonly lineText: string
}

/** What the editor needs to show review comments and take new ones. */
export interface IIdeEditorReview {
  /** The comments on the file that is shown. */
  readonly comments: ReadonlyArray<IReviewComment>
  readonly onAdd: (target: IReviewTarget, body: string) => void
  readonly onUpdate: (id: string, body: string) => void
  readonly onRemove: (id: string) => void
}

/** Where a comment is shown: next to a line of the editor, by its index. */
export interface IReviewAnchor {
  readonly line: number

  /**
   * Whether it goes above the line rather than below it, as for a comment on
   * an old line, which is shown with the old lines above the line after them.
   */
  readonly above: boolean
}

/**
 * Where to show a comment on a line: under a line of the file, or with the old
 * lines it is one of. Null when the file doesn't have the line.
 */
export function getReviewAnchor(
  target: Pick<IReviewTarget, 'side' | 'line'>,
  lineCount: number,
  previousLines: ReadonlyArray<IPreviousLineBlock>
): IReviewAnchor | null {
  if (lineCount === 0) {
    return null
  }

  if (target.side === 'new') {
    return target.line >= 1 && target.line <= lineCount
      ? { line: target.line - 1, above: false }
      : null
  }

  const block = previousLines.find(
    b =>
      target.line >= b.oldLineNumber &&
      target.line < b.oldLineNumber + b.lines.length
  )
  if (block === undefined) {
    return null
  }

  // Old lines after the last line of the file are shown under it
  return block.line < lineCount
    ? { line: block.line, above: true }
    : { line: lineCount - 1, above: false }
}

interface IPlacedWidget {
  readonly anchor: IReviewAnchor
  readonly handle: CodeMirror.LineHandle
  readonly widget: CodeMirror.LineWidget
}

/**
 * The widgets that show review comments, and the box to write one, under
 * their lines. Each has a node of its own that it keeps when it moves, so what
 * is drawn in it, like the text being typed, stays.
 */
export class IdeReviewWidgets {
  private readonly nodes = new Map<string, HTMLElement>()
  private readonly placed = new Map<string, IPlacedWidget>()
  private readonly observer: ResizeObserver | null

  public constructor(private readonly editor: CodeMirror.Editor) {
    // CodeMirror measures a widget when it's added, so it's told when one
    // changes height, as when a comment is edited
    this.observer =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(this.onResize)
  }

  /**
   * Show a widget for each key at its anchor, moving the ones that moved and
   * removing the ones that are gone. Returns the nodes to draw in, and the
   * nodes of the widgets that were removed.
   */
  public sync(
    items: ReadonlyArray<{
      readonly key: string
      readonly anchor: IReviewAnchor
    }>
  ): {
    readonly nodes: ReadonlyMap<string, HTMLElement>
    readonly removed: ReadonlyArray<HTMLElement>
  } {
    const wanted = new Map(items.map(item => [item.key, item.anchor]))
    const removed = new Array<HTMLElement>()

    this.editor.operation(() => {
      for (const [key, node] of this.nodes) {
        if (!wanted.has(key)) {
          this.unplace(key)
          this.observer?.unobserve(node)
          this.nodes.delete(key)
          removed.push(node)
        }
      }

      for (const [key, anchor] of wanted) {
        const placed = this.placed.get(key)
        if (
          placed !== undefined &&
          placed.anchor.above === anchor.above &&
          this.editor.getLineNumber(placed.handle) === anchor.line
        ) {
          continue
        }

        this.unplace(key)
        this.place(key, anchor)
      }
    })

    return { nodes: this.nodes, removed }
  }

  /** Remove all the widgets. Returns their nodes. */
  public clear(): ReadonlyArray<HTMLElement> {
    return this.sync([]).removed
  }

  public dispose() {
    this.clear()
    this.observer?.disconnect()
  }

  private place(key: string, anchor: IReviewAnchor) {
    let node = this.nodes.get(key)
    if (node === undefined) {
      node = document.createElement('div')
      node.className = 'ide-review-widget'
      this.nodes.set(key, node)
      this.observer?.observe(node)
    }

    const handle = this.editor.getLineHandle(anchor.line)
    const widget = this.editor.addLineWidget(handle, node, {
      above: anchor.above,
      noHScroll: true,
      handleMouseEvents: false,
    })
    this.placed.set(key, { anchor, handle, widget })
  }

  private unplace(key: string) {
    this.placed.get(key)?.widget.clear()
    this.placed.delete(key)
  }

  private onResize = (entries: ReadonlyArray<ResizeObserverEntry>) => {
    const changed = new Set(entries.map(entry => entry.target))
    this.editor.operation(() => {
      for (const [key, placed] of this.placed) {
        const node = this.nodes.get(key)
        if (node !== undefined && changed.has(node)) {
          placed.widget.changed()
        }
      }
    })
  }
}

/** The line a comment is on, like "line 12" or "old line 3". */
export function getLineLabel(
  target: Pick<IReviewTarget, 'side' | 'line'>
): string {
  return target.side === 'old'
    ? `old line ${target.line}`
    : `line ${target.line}`
}

/** The "+" in the gutter of the line under the pointer. */
export function createCommentButton(line: number): HTMLElement {
  const button = document.createElement('div')
  button.className = 'ide-comment-button'
  button.textContent = '+'
  button.title = `Comment on line ${line} for Claude`
  button.setAttribute('aria-hidden', 'true')
  return button
}
