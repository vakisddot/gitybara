import * as React from 'react'
import { Button } from '../lib/button'
import { Octicon } from '../octicons'
import * as octicons from '../octicons/octicons.generated'
import { DiffViewController, IDiffViewState } from './diff-view-controller'

interface IDiffViewControlsProps {
  readonly controller: DiffViewController
}

interface IDiffViewControlsState {
  readonly viewState: IDiffViewState | null
}

/**
 * The controls in the header of a unified or split diff that act on the diff,
 * which look like those of the Gitybara view.
 */
export class DiffViewControls extends React.Component<
  IDiffViewControlsProps,
  IDiffViewControlsState
> {
  private unsubscribe: (() => void) | null = null

  public constructor(props: IDiffViewControlsProps) {
    super(props)
    this.state = { viewState: props.controller.state }
  }

  public componentDidMount() {
    this.unsubscribe = this.props.controller.subscribe(this.onViewStateChanged)
    this.onViewStateChanged()
  }

  public componentWillUnmount() {
    this.unsubscribe?.()
  }

  private onViewStateChanged = () => {
    this.setState({ viewState: this.props.controller.state })
  }

  private onToggleWholeFile = () => this.props.controller.toggleWholeFile()

  public render() {
    const { viewState } = this.state

    if (viewState === null) {
      return null
    }

    const { isWholeFileExpanded } = viewState
    const wholeFileLabel = isWholeFileExpanded
      ? 'Collapse expanded lines'
      : 'Expand whole file'

    return (
      <div className="ide-file-viewer-header-buttons">
        <Button
          className="ide-file-viewer-header-button"
          onClick={this.onToggleWholeFile}
          disabled={!viewState.canToggleWholeFile}
          tooltip={`${wholeFileLabel} (E)`}
          ariaLabel={wholeFileLabel}
        >
          <Octicon
            symbol={isWholeFileExpanded ? octicons.fold : octicons.unfold}
          />
        </Button>
      </div>
    )
  }
}
