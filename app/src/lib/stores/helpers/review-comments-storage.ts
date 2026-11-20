import { Repository } from '../../../models/repository'
import { IReviewComment } from '../../../models/review-comment'
import { getObject, setObject } from '../../local-storage'

function getReviewCommentsKey(repository: Repository) {
  return `review-comments-${repository.id}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isReviewComment(value: unknown): value is IReviewComment {
  if (!isRecord(value)) {
    return false
  }

  const { id, path, side, line, lineText, body, commitSha } = value

  return (
    typeof id === 'string' &&
    typeof path === 'string' &&
    (side === 'new' || side === 'old') &&
    typeof line === 'number' &&
    Number.isInteger(line) &&
    line > 0 &&
    typeof lineText === 'string' &&
    typeof body === 'string' &&
    (commitSha === null || typeof commitSha === 'string')
  )
}

/** The review comments kept for the repository, if any. */
export function getStoredReviewComments(
  repository: Repository
): ReadonlyArray<IReviewComment> {
  const stored = getObject<unknown>(getReviewCommentsKey(repository))
  return Array.isArray(stored) ? stored.filter(isReviewComment) : []
}

/** Keep the review comments of the repository, so they survive a restart. */
export function storeReviewComments(
  repository: Repository,
  comments: ReadonlyArray<IReviewComment>
) {
  if (comments.length === 0) {
    clearStoredReviewComments(repository)
  } else {
    setObject(getReviewCommentsKey(repository), comments)
  }
}

/** Forget the review comments kept for the repository. */
export function clearStoredReviewComments(repository: Repository) {
  localStorage.removeItem(getReviewCommentsKey(repository))
}
