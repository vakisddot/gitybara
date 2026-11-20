import { Repository } from '../../../models/repository'
import { IReviewComment } from '../../../models/review-comment'
import { PopupType } from '../../../models/popup'
import { Dispatcher } from '../../dispatcher'
import { IIdeFileViewerReview } from './ide-file-viewer'

/**
 * The review of a repository for the Gitybara view: its comments, kept in the
 * app's state, and the dialog that sends them to Claude Code.
 */
export function getFileViewerReview(
  dispatcher: Dispatcher,
  repository: Repository,
  comments: ReadonlyArray<IReviewComment>
): IIdeFileViewerReview {
  return {
    comments,
    onAdd: comment => dispatcher.addReviewComment(repository, comment),
    onUpdate: (id, body) =>
      dispatcher.updateReviewComment(repository, id, body),
    onRemove: id => dispatcher.removeReviewComment(repository, id),
    onSend: () =>
      dispatcher.showPopup({ type: PopupType.SendReviewToClaude, repository }),
  }
}
