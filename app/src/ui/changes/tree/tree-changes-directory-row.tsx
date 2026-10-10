import * as React from 'react'

import { PathText } from '../../lib/path-text'
import { Octicon } from '../../octicons'
import * as octicons from '../../octicons/octicons.generated'
import { IChangesTreeDirectoryRow } from './tree-changes-rows'

export const TreeIndent = 16

const TreeDirectoryHorizontalPadding = 10 * 2
const TreeDirectoryChevronWidth = 12
const TreeDirectoryChevronMarginRight = 4
const TreeDirectoryCountPadding = 5
const TreeDirectoryCountDigitApproximateWidth = 8

interface ITreeChangesDirectoryRowProps {
  readonly row: IChangesTreeDirectoryRow
  readonly matches: ReadonlyArray<number>
  readonly availableWidth: number

  /** An icon to show for the directory, after the chevron. */
  readonly icon?: JSX.Element

  /** The width the icon takes up, including the space after it. */
  readonly iconWidth?: number
  readonly onClick: (event: React.MouseEvent<HTMLButtonElement>) => void
  readonly onKeyDown: (event: React.KeyboardEvent<HTMLButtonElement>) => void
  readonly onContextMenu: (event: React.MouseEvent<HTMLButtonElement>) => void
}

function getTreeDirectoryRowStyle(depth: number): React.CSSProperties {
  return {
    paddingLeft: `calc(var(--spacing) + ${depth * TreeIndent}px)`,
  }
}

function getTreeDirectoryNameAvailableWidth(
  row: IChangesTreeDirectoryRow,
  availableWidth: number,
  iconWidth: number
) {
  const indentation = row.depth * TreeIndent
  const countWidth =
    row.fileCount.toString().length * TreeDirectoryCountDigitApproximateWidth

  return (
    availableWidth -
    TreeDirectoryHorizontalPadding -
    indentation -
    TreeDirectoryChevronWidth -
    TreeDirectoryChevronMarginRight -
    iconWidth -
    TreeDirectoryCountPadding -
    countWidth
  )
}

export function TreeGuideLines({ depth }: { readonly depth: number }) {
  if (depth <= 0) {
    return null
  }

  const guides = new Array<JSX.Element>()

  for (let level = 0; level < depth; level++) {
    guides.push(<span key={level} className="changes-tree-guide-cell" />)
  }

  return (
    <span className="changes-tree-guide-cells" aria-hidden={true}>
      {guides}
    </span>
  )
}

export function TreeChangesDirectoryRow(props: ITreeChangesDirectoryRowProps) {
  const {
    row,
    matches,
    availableWidth,
    icon,
    iconWidth = 0,
    onClick,
    onKeyDown,
    onContextMenu,
  } = props
  const countLabel = `${row.fileCount} changed file${
    row.fileCount === 1 ? '' : 's'
  }`
  const nameMatches =
    matches.length > 0 ? { title: matches, subtitle: [] } : undefined
  const availableNameWidth = getTreeDirectoryNameAvailableWidth(
    row,
    availableWidth,
    icon === undefined ? 0 : iconWidth
  )

  return (
    <button
      className="changes-tree-directory-row"
      style={getTreeDirectoryRowStyle(row.depth)}
      onClick={onClick}
      onKeyDown={onKeyDown}
      onContextMenu={onContextMenu}
      type="button"
      aria-expanded={row.expanded}
      aria-label={`${row.path}, ${countLabel}`}
      data-directory-id={row.id}
    >
      <TreeGuideLines depth={row.depth} />
      <Octicon
        className="changes-tree-chevron"
        symbol={row.expanded ? octicons.chevronDown : octicons.chevronRight}
      />
      {icon}
      <span className="changes-tree-directory-name">
        <PathText
          path={row.name}
          matches={nameMatches}
          tagName="span"
          availableWidth={availableNameWidth}
        />
      </span>
      {row.fileCount > 0 && (
        <span className="changes-tree-directory-count">{row.fileCount}</span>
      )}
    </button>
  )
}
