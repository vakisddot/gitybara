import * as React from 'react'

import { PathLabel } from '../lib/path-label'
import { Octicon, iconForStatus } from '../octicons'
import { Checkbox, CheckboxValue } from '../lib/checkbox'
import { mapStatus } from '../../lib/status'
import {
  AppFileStatus,
  AppFileStatusKind,
  WorkingDirectoryFileChange,
} from '../../models/status'
import { TooltipDirection } from '../lib/tooltip'
import { TooltippedContent } from '../lib/tooltipped-content'
import { AriaLiveContainer } from '../accessibility/aria-live-container'
import { IMatches } from '../../lib/fuzzy-find'

interface IChangedFileProps {
  readonly file: WorkingDirectoryFileChange
  readonly include: boolean | null
  readonly displayPath?: string
  readonly availableWidth: number
  readonly disableSelection: boolean
  readonly checkboxTooltip?: string
  readonly focused: boolean
  readonly indentation?: number
  /** The characters in the file path to highlight */
  readonly matches?: IMatches
  readonly onIncludeChanged: (
    file: WorkingDirectoryFileChange,
    include: boolean
  ) => void
}

function getDirectoryName(path: string) {
  const lastPathSeparatorIndex = path.lastIndexOf('/')
  return lastPathSeparatorIndex === -1
    ? ''
    : path.substring(0, lastPathSeparatorIndex)
}

function getFileName(path: string) {
  const lastPathSeparatorIndex = path.lastIndexOf('/')
  return lastPathSeparatorIndex === -1
    ? path
    : path.substring(lastPathSeparatorIndex + 1)
}

export function getDisplayStatus(
  status: AppFileStatus,
  path: string,
  displayPath: string
): AppFileStatus {
  if (path === displayPath) {
    return status
  }

  if (
    status.kind !== AppFileStatusKind.Renamed &&
    status.kind !== AppFileStatusKind.Copied
  ) {
    return status
  }

  // Tree view renders the basename of the current path. Shorten the old path
  // to its basename when both files live in the same directory, but keep the
  // full old path otherwise so the user can still see where the file moved
  // from.
  if (getDirectoryName(status.oldPath) !== getDirectoryName(path)) {
    return status
  }

  return {
    ...status,
    oldPath: getFileName(status.oldPath),
  }
}

/** a changed file in the working directory for a given repository */
export class ChangedFile extends React.Component<IChangedFileProps, {}> {
  private handleCheckboxChange = (event: React.FormEvent<HTMLInputElement>) => {
    const include = event.currentTarget.checked
    this.props.onIncludeChanged(this.props.file, include)
  }

  private get checkboxValue(): CheckboxValue {
    if (this.props.include === true) {
      return CheckboxValue.On
    } else if (this.props.include === false) {
      return CheckboxValue.Off
    } else {
      return CheckboxValue.Mixed
    }
  }

  public render() {
    const {
      file,
      availableWidth,
      disableSelection,
      checkboxTooltip,
      focused,
      indentation = 0,
      displayPath = file.path,
      matches,
    } = this.props
    const { status, path } = file
    const fileStatus = mapStatus(status)
    const displayStatus = getDisplayStatus(status, path, displayPath)

    const listItemPadding = 10 * 2
    const checkboxWidth = 20
    const statusWidth = 16
    const filePadding = 5

    const availablePathWidth =
      availableWidth -
      listItemPadding -
      indentation -
      checkboxWidth -
      filePadding -
      statusWidth

    const includedText =
      this.props.include === true
        ? 'included'
        : this.props.include === undefined
        ? 'partially included'
        : 'not included'

    const pathScreenReaderMessage = `${path} ${mapStatus(
      status
    )} ${includedText}`

    return (
      <div
        className="file"
        style={
          indentation > 0
            ? { paddingLeft: `calc(var(--spacing) + ${indentation}px)` }
            : undefined
        }
      >
        <TooltippedContent
          tooltip={checkboxTooltip}
          direction={TooltipDirection.EAST}
          tagName="div"
        >
          <Checkbox
            // The checkbox doesn't need to be tab reachable since we emulate
            // checkbox behavior on the list item itself, ie hitting space bar
            // while focused on a row will toggle selection.
            tabIndex={-1}
            value={this.checkboxValue}
            onChange={this.handleCheckboxChange}
            disabled={disableSelection}
          />
        </TooltippedContent>

        <PathLabel
          path={displayPath}
          status={displayStatus}
          availableWidth={availablePathWidth}
          ariaHidden={true}
          matches={matches}
        />

        <AriaLiveContainer message={pathScreenReaderMessage} />
        <TooltippedContent
          ancestorFocused={focused}
          openOnFocus={true}
          tooltip={fileStatus}
          direction={TooltipDirection.EAST}
        >
          <Octicon
            symbol={iconForStatus(status)}
            className={'status status-' + fileStatus.toLowerCase()}
          />
        </TooltippedContent>
      </div>
    )
  }
}
