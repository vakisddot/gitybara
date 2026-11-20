import * as React from 'react'
import {
  Dialog,
  DialogContent,
  DialogError,
  DialogFooter,
  OkCancelButtonGroup,
} from '../dialog'
import { Dispatcher } from '../dispatcher'
import { Repository } from '../../models/repository'
import { IReviewComment } from '../../models/review-comment'
import { describeSession, IClaudeSession } from '../../lib/claude-code/sessions'
import {
  SendToClaudeError,
  SendToClaudeFailure,
} from '../../lib/claude-code/send-message'
import { Button } from '../lib/button'
import { Row } from '../lib/row'
import { Select } from '../lib/select'
import { TextArea } from '../lib/text-area'
import { writeClipboardText } from '../main-process-proxy'

interface ISendReviewDialogProps {
  readonly dispatcher: Dispatcher
  readonly repository: Repository

  /** The comments of the review. */
  readonly comments: ReadonlyArray<IReviewComment>
  readonly onDismissed: () => void
}

interface ISendReviewDialogState {
  /** The chats that can take the review, null while they are looked for. */
  readonly sessions: ReadonlyArray<IClaudeSession> | null
  readonly selectedSessionId: string | null
  readonly note: string
  readonly isSending: boolean
  readonly isCopied: boolean
  readonly error: string | null
}

function describeFailure(failure: SendToClaudeFailure) {
  switch (failure) {
    case 'not-running':
      return 'The chat is no longer running. Pick another one, or copy the review.'
    case 'no-key':
      return 'The chat has no inbox. It may have just closed, or its Claude Code may be too old to take messages.'
    case 'timeout':
      return 'The chat didn’t answer in time.'
    case 'failed':
      return 'The review couldn’t be sent.'
  }
}

/** Where the comments are, like "3 comments on 2 files". */
function summarize(comments: ReadonlyArray<IReviewComment>) {
  const files = new Set(comments.map(c => c.path)).size
  return `${comments.length} ${
    comments.length === 1 ? 'comment' : 'comments'
  } on ${files} ${files === 1 ? 'file' : 'files'}`
}

/**
 * Sends the review comments of a repository to a Claude Code chat that runs in
 * it, like the chat that made the changes, as a message it works on.
 */
export class SendReviewDialog extends React.Component<
  ISendReviewDialogProps,
  ISendReviewDialogState
> {
  private unmounted = false

  public constructor(props: ISendReviewDialogProps) {
    super(props)
    this.state = {
      sessions: null,
      selectedSessionId: null,
      note: '',
      isSending: false,
      isCopied: false,
      error: null,
    }
  }

  public async componentDidMount() {
    try {
      const { sessions, suggested } =
        await this.props.dispatcher.findClaudeSessions(this.props.repository)
      if (!this.unmounted) {
        this.setState({
          sessions,
          selectedSessionId: suggested?.sessionId ?? null,
        })
      }
    } catch (e) {
      log.error('Could not look for Claude Code chats', e)
      if (!this.unmounted) {
        this.setState({ sessions: [] })
      }
    }
  }

  public componentWillUnmount() {
    this.unmounted = true
  }

  private getSelectedSession() {
    const { sessions, selectedSessionId } = this.state
    return sessions?.find(s => s.sessionId === selectedSessionId) ?? null
  }

  private onSessionChanged = (event: React.FormEvent<HTMLSelectElement>) => {
    this.setState({ selectedSessionId: event.currentTarget.value, error: null })
  }

  private onNoteChanged = (note: string) => {
    this.setState({ note, isCopied: false })
  }

  private onSend = async () => {
    const session = this.getSelectedSession()
    if (session === null) {
      return
    }

    this.setState({ isSending: true, error: null })
    try {
      await this.props.dispatcher.sendReviewToClaude(
        this.props.repository,
        session,
        this.state.note
      )
      this.props.onDismissed()
    } catch (e) {
      log.error('Could not send the review to Claude Code', e)
      if (!this.unmounted) {
        this.setState({
          isSending: false,
          error:
            e instanceof SendToClaudeError
              ? describeFailure(e.failure)
              : 'The review couldn’t be sent.',
        })
      }
    }
  }

  private onCopy = () => {
    const { dispatcher, repository } = this.props
    writeClipboardText(dispatcher.getReviewPrompt(repository, this.state.note))
    this.setState({ isCopied: true })
  }

  private onDiscard = () => {
    this.props.dispatcher.clearReviewComments(this.props.repository)
    this.props.onDismissed()
  }

  private renderSessions() {
    const { sessions, selectedSessionId } = this.state

    if (sessions === null) {
      return <p>Looking for Claude Code chats…</p>
    }

    if (sessions.length === 0) {
      return (
        <p>
          No Claude Code chat is running in this repository. Start one here, or
          copy the review and paste it into a chat.
        </p>
      )
    }

    return (
      <Select
        label="Claude Code chat"
        value={selectedSessionId ?? undefined}
        onChange={this.onSessionChanged}
      >
        {sessions.map(session => (
          <option key={session.sessionId} value={session.sessionId}>
            {describeSession(session)}
          </option>
        ))}
      </Select>
    )
  }

  public render() {
    const { comments } = this.props
    const { isSending, isCopied, error, note } = this.state
    const session = this.getSelectedSession()

    return (
      <Dialog
        id="send-review-to-claude"
        title="Send review to Claude"
        loading={isSending}
        dismissDisabled={isSending}
        onSubmit={this.onSend}
        onDismissed={this.props.onDismissed}
      >
        {error !== null && <DialogError>{error}</DialogError>}
        <DialogContent>
          <p>
            {summarize(comments)}. The chat gets them as a message and starts
            working on them.
          </p>
          <ul className="send-review-comments">
            {comments.map(comment => (
              <li key={comment.id}>
                <span className="send-review-comment-where">
                  {comment.path}, {comment.side === 'old' ? 'old line' : 'line'}{' '}
                  {comment.line}
                </span>
                <span className="send-review-comment-body">{comment.body}</span>
              </li>
            ))}
          </ul>
          <Row>{this.renderSessions()}</Row>
          <Row>
            <TextArea
              label="Note (optional)"
              placeholder="Anything else for Claude, for the whole review"
              rows={2}
              value={note}
              onValueChanged={this.onNoteChanged}
            />
          </Row>
          <p className="send-review-hint">
            Claude Code takes messages from other apps without asking only when
            its settings have <code>"crossSessionInbound": "accept"</code>.
          </p>
        </DialogContent>
        <DialogFooter>
          <div className="send-review-secondary-buttons">
            <Button onClick={this.onCopy} disabled={isSending}>
              {isCopied ? 'Copied' : 'Copy as prompt'}
            </Button>
            <Button onClick={this.onDiscard} disabled={isSending}>
              Discard review
            </Button>
          </div>
          <OkCancelButtonGroup
            okButtonText="Send"
            okButtonDisabled={session === null || isSending}
            onCancelButtonClick={this.props.onDismissed}
          />
        </DialogFooter>
      </Dialog>
    )
  }
}
