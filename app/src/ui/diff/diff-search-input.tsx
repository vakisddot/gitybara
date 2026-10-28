import * as React from 'react'
import { TextBox } from '../lib/text-box'
import { Button } from '../lib/button'
import { Octicon } from '../octicons'
import * as octicons from '../octicons/octicons.generated'

interface IDiffSearchInputProps {
  /**
   * Called when the user indicated that they either want to initiate a search
   * or want to advance to the next hit (typically done by hitting `Enter`).
   */
  readonly onSearch: (query: string, direction: 'next' | 'previous') => void

  /**
   * Called when the user indicates that they want to abort the search,
   * either by clicking outside of the component or by hitting `Escape`.
   */
  readonly onClose: () => void

  /** The number of matches, or undefined before a query is entered. */
  readonly resultCount: number | undefined

  /** The zero-based index of the selected match. */
  readonly selectedResult: number | undefined
}

interface IDiffSearchInputState {
  readonly value: string
}

export class DiffSearchInput extends React.Component<
  IDiffSearchInputProps,
  IDiffSearchInputState
> {
  private inputRef = React.createRef<TextBox>()

  public constructor(props: IDiffSearchInputProps) {
    super(props)
    this.state = { value: '' }
  }

  public render() {
    const { resultCount, selectedResult } = this.props

    return (
      <div
        className="diff-search"
        role="search"
        aria-label="Find in diff"
        onBlur={this.onBlur}
      >
        <TextBox
          ref={this.inputRef}
          ariaLabel="Find in diff"
          placeholder="Search…"
          displayClearButton={true}
          autoFocus={true}
          onValueChanged={this.onChange}
          onKeyDown={this.onKeyDown}
          value={this.state.value}
        />
        <span className="diff-search-count">
          {resultCount === undefined
            ? ''
            : resultCount === 0
            ? 'No results'
            : `${(selectedResult ?? 0) + 1} of ${resultCount}`}
        </span>
        <Button
          size="small"
          ariaLabel="Previous match"
          tooltip="Previous match (Shift+Enter or Shift+F3)"
          disabled={!resultCount}
          onClick={this.onPrevious}
          onKeyDown={this.onKeyDown}
        >
          <Octicon symbol={octicons.chevronLeft} />
        </Button>
        <Button
          size="small"
          ariaLabel="Next match"
          tooltip="Next match (Enter or F3)"
          disabled={!resultCount}
          onClick={this.onNext}
          onKeyDown={this.onKeyDown}
        >
          <Octicon symbol={octicons.chevronRight} />
        </Button>
        <Button
          size="small"
          ariaLabel="Close search"
          tooltip="Close search (Escape)"
          onClick={this.props.onClose}
          onKeyDown={this.onKeyDown}
        >
          <Octicon symbol={octicons.x} />
        </Button>
      </div>
    )
  }

  private onChange = (value: string) => {
    this.setState({ value })
    this.props.onSearch(value, 'next')
  }

  /** Move keyboard focus back to the query when Find is invoked again. */
  public focus() {
    this.inputRef.current?.focus()
  }

  private onPrevious = () => this.props.onSearch(this.state.value, 'previous')
  private onNext = () => this.props.onSearch(this.state.value, 'next')

  private onBlur = (event: React.FocusEvent<HTMLDivElement>) => {
    if (
      !(event.relatedTarget instanceof Node) ||
      !event.currentTarget.contains(event.relatedTarget)
    ) {
      this.props.onClose()
    }
  }

  private onKeyDown = (evt: React.KeyboardEvent<HTMLElement>) => {
    if (evt.key === 'Escape' && !evt.defaultPrevented) {
      evt.preventDefault()
      this.props.onClose()
    } else if (
      !evt.defaultPrevented &&
      !evt.altKey &&
      !evt.ctrlKey &&
      !evt.metaKey &&
      !evt.nativeEvent.isComposing &&
      (evt.key === 'F3' ||
        (evt.key === 'Enter' && evt.target instanceof HTMLInputElement))
    ) {
      evt.preventDefault()
      this.props.onSearch(this.state.value, evt.shiftKey ? 'previous' : 'next')
    }
  }
}
