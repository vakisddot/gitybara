import type { IReviewComment } from '../../models/review-comment'

/** Quoted lines longer than this are cut short. */
const maxQuotedLineLength = 200

export interface IReviewPromptOptions {
  /** The branch that was reviewed, if known. */
  readonly branch: string | null

  /** A general note added after the line comments. */
  readonly note?: string
}

interface ICommentGroup {
  readonly commitSha: string | null
  readonly comments: ReadonlyArray<IReviewComment>
}

/**
 * The comments grouped by commit, in the order the commits were first
 * commented on, with the uncommitted changes last.
 */
function groupByCommit(
  comments: ReadonlyArray<IReviewComment>
): ReadonlyArray<ICommentGroup> {
  const groups = new Map<string | null, IReviewComment[]>()
  for (const comment of comments) {
    const group = groups.get(comment.commitSha)
    if (group === undefined) {
      groups.set(comment.commitSha, [comment])
    } else {
      group.push(comment)
    }
  }

  const all = [...groups].map(([commitSha, group]) => ({
    commitSha,
    comments: group,
  }))
  return [
    ...all.filter(g => g.commitSha !== null),
    ...all.filter(g => g.commitSha === null),
  ]
}

function compareComments(a: IReviewComment, b: IReviewComment) {
  if (a.path !== b.path) {
    return a.path < b.path ? -1 : 1
  }
  if (a.line !== b.line) {
    return a.line - b.line
  }
  if (a.side !== b.side) {
    return a.side === 'old' ? -1 : 1
  }
  return 0
}

function indent(text: string) {
  return text
    .split(/\r?\n/)
    .map(line => (line.trim() === '' ? '' : `  ${line}`))
    .join('\n')
}

function quote(lineText: string) {
  const text = lineText.trim()
  if (text === '') {
    return '> (empty line)'
  }
  return text.length > maxQuotedLineLength
    ? `> ${text.slice(0, maxQuotedLineLength)}…`
    : `> ${text}`
}

function formatComment(comment: IReviewComment) {
  const line =
    comment.side === 'old'
      ? `deleted line ${comment.line}`
      : `line ${comment.line}`
  return [
    `- ${comment.path}, ${line}:`,
    indent(quote(comment.lineText)),
    indent(comment.body.trim()),
  ].join('\n')
}

function formatGroup(group: ICommentGroup) {
  const title =
    group.commitSha === null
      ? 'In the uncommitted changes:'
      : `In commit ${group.commitSha.slice(0, 9)}:`
  const comments = [...group.comments].sort(compareComments).map(formatComment)
  return [title, ...comments].join('\n')
}

/**
 * The text of a review for Claude Code: each comment with its file, line and
 * the code it is about, grouped by commit, then the general note.
 */
export function formatReviewPrompt(
  comments: ReadonlyArray<IReviewComment>,
  options: IReviewPromptOptions
) {
  const branch = options.branch === null ? '' : ` of branch ${options.branch}`
  const note = options.note?.trim() ?? ''

  const intro =
    comments.length > 0
      ? `Review from Gitybara${branch}. Please address these comments.`
      : `Review from Gitybara${branch}.`
  const groups = groupByCommit(comments).map(formatGroup)
  const outro =
    note === '' ? [] : [comments.length > 0 ? `Also: ${note}` : note]

  return [intro, ...groups, ...outro].join('\n\n')
}
