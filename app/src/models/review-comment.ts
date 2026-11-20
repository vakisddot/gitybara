/**
 * Which version of a file a review comment is on: 'new' for a line of the file
 * as it is now (or as the commit left it), 'old' for a line the change deleted.
 */
export type ReviewCommentSide = 'new' | 'old'

/** A comment on one line of a diff, kept until it is sent to Claude Code. */
export interface IReviewComment {
  readonly id: string

  /** The path of the file, relative to the repository. */
  readonly path: string

  readonly side: ReviewCommentSide

  /** The 1-based number of the line in that version of the file. */
  readonly line: number

  /** The text of the line, quoted in the review. */
  readonly lineText: string

  /** What the reviewer wrote. */
  readonly body: string

  /** The commit the line was reviewed in, or null for uncommitted changes. */
  readonly commitSha: string | null
}
