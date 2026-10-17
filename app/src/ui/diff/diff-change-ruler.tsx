import * as React from 'react'
import { DiffRow, DiffRowType, SimplifiedDiffRow } from './diff-helpers'

type ChangeRulerMarkKind = 'added' | 'deleted' | 'modified'

/**
 * A mark over the scroll bar for rows that changed, with where it starts and
 * how tall it is as fractions of the height of the diff.
 */
export interface IChangeRulerMark {
  readonly kind: ChangeRulerMarkKind
  readonly top: number
  readonly height: number
}

/** A modified row is the old and the new line side by side, in a split diff */
const MarkKinds: Partial<Record<DiffRowType, ChangeRulerMarkKind>> = {
  [DiffRowType.Added]: 'added',
  [DiffRowType.Deleted]: 'deleted',
  [DiffRowType.Modified]: 'modified',
}

/**
 * A mark for each run of changed rows of the same kind, at the place in the
 * scroll bar that the rows are at in the diff.
 */
export function getChangeRulerMarks(
  rows: ReadonlyArray<DiffRow | SimplifiedDiffRow>,
  getRowHeight: (index: number) => number
): ReadonlyArray<IChangeRulerMark> {
  const heights = rows.map((_, index) => getRowHeight(index))
  const total = heights.reduce((sum, height) => sum + height, 0)
  const marks = new Array<IChangeRulerMark>()
  let top = 0

  for (let index = 0; index < rows.length; ) {
    const kind = MarkKinds[rows[index].type]
    let height = heights[index]
    let next = index + 1

    if (kind !== undefined) {
      while (next < rows.length && MarkKinds[rows[next].type] === kind) {
        height += heights[next]
        next++
      }

      marks.push({ kind, top: top / total, height: height / total })
    }

    top += height
    index = next
  }

  return total > 0 ? marks : []
}

interface IDiffChangeRulerProps {
  readonly marks: ReadonlyArray<IChangeRulerMark>
}

/**
 * Marks over the scroll bar of a unified or split diff for where its changes
 * are, like the ones of the Gitybara view.
 */
export class DiffChangeRuler extends React.Component<IDiffChangeRulerProps> {
  public render() {
    return (
      <div className="diff-change-ruler" aria-hidden="true">
        {this.props.marks.map(({ kind, top, height }, index) => (
          <div
            key={index}
            className={`diff-change-mark ${kind}`}
            style={{ top: `${top * 100}%`, height: `${height * 100}%` }}
          />
        ))}
      </div>
    )
  }
}
