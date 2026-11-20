import * as React from 'react'
import classNames from 'classnames'

import { IReviewComment } from '../../../models/review-comment'
import { Button } from '../../lib/button'
import { Octicon } from '../../octicons'
import * as octicons from '../../octicons/octicons.generated'
import { getLineLabel, IReviewTarget } from './ide-review-comments'

interface IReviewCommentBoxProps {
  /** The comment, or null for one that is being written. */
  readonly comment: IReviewComment | null

  /** The line the comment is on. */
  readonly target: IReviewTarget

  readonly onAdd: (target: IReviewTarget, body: string) => void
  readonly onUpdate: (id: string, body: string) => void
  readonly onRemove: (id: string) => void

  /** Called to stop writing a new comment. */
  readonly onCancel: () => void
}

interface IReviewCommentBoxState {
  readonly isEditing: boolean
  readonly text: string
}

/**
 * A comment for Claude Code under a line of the IDE view, or the box to write
 * one. Ctrl+Enter (Cmd+Enter on macOS) saves it and Escape stops editing.
 */
export class ReviewCommentBox extends React.Component<
  IReviewCommentBoxProps,
  IReviewCommentBoxState
> {
  public constructor(props: IReviewCommentBoxProps) {
    super(props)
    this.state = {
      isEditing: props.comment === null,
      text: props.comment?.body ?? '',
    }
  }

  private onTextChange = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    this.setState({ text: event.currentTarget.value })
  }

  private onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const isCmdOrCtrl = __DARWIN__ ? event.metaKey : event.ctrlKey
    if (event.key === 'Enter' && isCmdOrCtrl) {
      event.preventDefault()
      this.save()
    } else if (event.key === 'Escape') {
      event.preventDefault()
      this.cancel()
    }
  }

  private save = () => {
    const { comment, target } = this.props
    const text = this.state.text.trim()
    if (text === '') {
      return
    }

    if (comment === null) {
      this.props.onAdd(target, text)
    } else {
      this.props.onUpdate(comment.id, text)
      this.setState({ isEditing: false })
    }
  }

  private cancel = () => {
    const { comment } = this.props
    if (comment === null) {
      this.props.onCancel()
    } else {
      this.setState({ isEditing: false, text: comment.body })
    }
  }

  private onEdit = () => {
    this.setState({ isEditing: true, text: this.props.comment?.body ?? '' })
  }

  private onRemove = () => {
    const { comment } = this.props
    if (comment !== null) {
      this.props.onRemove(comment.id)
    }
  }

  private renderEditor() {
    const { comment, target } = this.props
    const { text } = this.state

    return (
      <>
        <textarea
          className="ide-review-comment-input"
          // It's opened by a click to write in it
          // eslint-disable-next-line jsx-a11y/no-autofocus
          autoFocus={true}
          rows={3}
          value={text}
          placeholder="What should Claude change here?"
          aria-label={`Comment on ${getLineLabel(target)} for Claude`}
          onChange={this.onTextChange}
          onKeyDown={this.onKeyDown}
        />
        <div className="ide-review-comment-actions">
          <Button
            type="submit"
            size="small"
            onClick={this.save}
            disabled={text.trim() === ''}
          >
            {comment === null ? 'Add comment' : 'Save'}
          </Button>
          <Button size="small" onClick={this.cancel}>
            Cancel
          </Button>
        </div>
      </>
    )
  }

  public render() {
    const { comment, target } = this.props
    const { isEditing } = this.state

    return (
      <div className={classNames('ide-review-comment', { editing: isEditing })}>
        <div className="ide-review-comment-header">
          <Octicon symbol={octicons.comment} />
          <span className="ide-review-comment-title">
            For Claude, on {getLineLabel(target)}
          </span>
          {!isEditing && comment !== null && (
            <>
              <Button
                className="ide-review-comment-button"
                size="small"
                ariaLabel="Edit the comment"
                tooltip="Edit"
                onClick={this.onEdit}
              >
                <Octicon symbol={octicons.pencil} />
              </Button>
              <Button
                className="ide-review-comment-button"
                size="small"
                ariaLabel="Delete the comment"
                tooltip="Delete"
                onClick={this.onRemove}
              >
                <Octicon symbol={octicons.trash} />
              </Button>
            </>
          )}
        </div>
        {isEditing || comment === null ? (
          this.renderEditor()
        ) : (
          <div className="ide-review-comment-body">{comment.body}</div>
        )}
      </div>
    )
  }
}
