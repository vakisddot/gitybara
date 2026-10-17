import * as React from 'react'

import { Button } from '../../lib/button'
import {
  Popover,
  PopoverAnchorPosition,
  PopoverDecoration,
} from '../../lib/popover'
import { Octicon } from '../../octicons'
import * as octicons from '../../octicons/octicons.generated'

interface IIdeKeysButtonProps {
  /** Whether the file can be edited, which is where letters are typed */
  readonly canEdit: boolean
  readonly canNavigate?: boolean

  /** Whether unchanged lines are collapsed, which E shows or collapses again */
  readonly canExpandWholeFile?: boolean
}

interface IIdeKeysButtonState {
  readonly isOpen: boolean
}

const Modifier = __DARWIN__ ? 'Cmd' : 'Ctrl'

/** The keys of the file viewer, see ide-shortcuts.ts */
function getShortcuts(
  canEdit: boolean,
  canNavigate: boolean,
  canExpandWholeFile: boolean
) {
  const shortcuts = [
    { keys: ['F'], action: 'Show or hide the previous lines' },
    { keys: ['Hold F'], action: 'Show the previous lines while it’s held' },
    {
      keys: [`${Modifier}+'`],
      action: 'The same as F, also while you edit the file',
    },
    { keys: ['W', 'S'], action: 'Go to the previous or the next change' },
    { keys: [`${Modifier}+F`], action: 'Find in the file' },
  ]
  if (canExpandWholeFile) {
    shortcuts.push({
      keys: ['E'],
      action: 'Show the whole file, or collapse the unchanged lines',
    })
  }
  if (canNavigate) {
    shortcuts.push(
      { keys: ['F12', `${Modifier}+click`], action: 'Go to definition' },
      { keys: ['Shift+F12'], action: 'Find references' },
      { keys: ['Alt+Left', 'Mouse4'], action: 'Go back after navigation' },
      { keys: ['Alt+Right', 'Mouse5'], action: 'Go forward after navigation' }
    )
  }

  return canEdit
    ? [...shortcuts, { keys: [`${Modifier}+S`], action: 'Save the file' }]
    : shortcuts
}

/** A button in the header of the file viewer that lists its keys. */
export class IdeKeysButton extends React.Component<
  IIdeKeysButtonProps,
  IIdeKeysButtonState
> {
  private button: HTMLButtonElement | null = null

  public constructor(props: IIdeKeysButtonProps) {
    super(props)
    this.state = { isOpen: false }
  }

  public render() {
    return (
      <>
        <Button
          className="ide-file-viewer-header-button"
          onClick={this.onToggle}
          onButtonRef={this.onButtonRef}
          ariaExpanded={this.state.isOpen}
          ariaHaspopup="dialog"
          tooltip="Keyboard shortcuts"
          ariaLabel="Keyboard shortcuts"
        >
          <Octicon symbol={octicons.key} />
        </Button>
        {this.state.isOpen && this.renderPopover()}
      </>
    )
  }

  private renderPopover() {
    return (
      <Popover
        className="ide-keys-popover"
        ariaLabelledby="ide-keys-popover-header"
        anchor={this.button}
        anchorPosition={PopoverAnchorPosition.BottomRight}
        decoration={PopoverDecoration.Balloon}
        onMousedownOutside={this.onClose}
        onClickOutside={this.onClose}
      >
        <h3 id="ide-keys-popover-header">Keyboard shortcuts</h3>
        <dl>
          {getShortcuts(
            this.props.canEdit,
            this.props.canNavigate === true,
            this.props.canExpandWholeFile === true
          ).map(({ keys, action }) => (
            <React.Fragment key={action}>
              <dt>
                {keys.map(key => (
                  <kbd key={key}>{key}</kbd>
                ))}
              </dt>
              <dd>{action}</dd>
            </React.Fragment>
          ))}
        </dl>
        {this.props.canEdit && (
          <p className="ide-keys-popover-note">
            F, W and S are typed into the file while you edit it.
          </p>
        )}
      </Popover>
    )
  }

  private onButtonRef = (button: HTMLButtonElement | null) => {
    this.button = button
  }

  private onToggle = () => this.setState(state => ({ isOpen: !state.isOpen }))

  private onClose = () => this.setState({ isOpen: false })
}
