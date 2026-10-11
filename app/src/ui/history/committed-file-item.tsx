import * as React from 'react'

import { CommittedFileChange } from '../../models/status'
import { mapStatus } from '../../lib/status'
import { PathLabel } from '../lib/path-label'
import { Octicon, iconForStatus } from '../octicons'
import { TooltippedContent } from '../lib/tooltipped-content'
import { TooltipDirection } from '../lib/tooltip'
import { getDisplayStatus } from '../changes/changed-file'

interface ICommittedFileItemProps {
  readonly availableWidth: number
  readonly file: CommittedFileChange
  readonly focused: boolean
  readonly displayPath?: string
  readonly indentation?: number

  /** An icon to show before the path of the file. */
  readonly icon?: JSX.Element

  /** The width the icon takes up, including the space after it. */
  readonly iconWidth?: number
}

export class CommittedFileItem extends React.Component<ICommittedFileItemProps> {
  public render() {
    const {
      file,
      focused,
      displayPath = file.path,
      indentation = 0,
      icon,
      iconWidth = 0,
    } = this.props
    const { status } = file
    const fileStatus = mapStatus(status)

    const listItemPadding = 10 * 2
    const statusWidth = 16
    const filePathPadding = 5
    const availablePathWidth =
      this.props.availableWidth -
      indentation -
      (icon === undefined ? 0 : iconWidth) -
      listItemPadding -
      filePathPadding -
      statusWidth

    return (
      <div
        className="file"
        style={
          indentation > 0
            ? { paddingLeft: `calc(var(--spacing) + ${indentation}px)` }
            : undefined
        }
      >
        {icon}
        <PathLabel
          path={displayPath}
          status={getDisplayStatus(status, file.path, displayPath)}
          availableWidth={availablePathWidth}
          ariaHidden={true}
        />
        <TooltippedContent
          ancestorFocused={focused}
          openOnFocus={true}
          tooltip={fileStatus}
          direction={TooltipDirection.NORTH}
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
