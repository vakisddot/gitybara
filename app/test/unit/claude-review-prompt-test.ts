import { describe, it } from 'node:test'
import assert from 'node:assert'
import { formatReviewPrompt } from '../../src/lib/claude-code/review-prompt'
import type { IReviewComment } from '../../src/models/review-comment'

const comment = (fields: Partial<IReviewComment>): IReviewComment => ({
  id: 'id',
  path: 'src/app.ts',
  side: 'new',
  line: 1,
  lineText: 'const a = 1',
  body: 'A comment',
  commitSha: null,
  ...fields,
})

describe('formatReviewPrompt', () => {
  it('groups comments by commit, with the uncommitted changes last', () => {
    const text = formatReviewPrompt(
      [
        comment({ path: 'b.ts', line: 3, body: 'Uncommitted' }),
        comment({
          path: 'z.ts',
          line: 9,
          body: 'Later in the file',
          commitSha: '1234567890abcdef',
        }),
        comment({
          path: 'a.ts',
          line: 2,
          side: 'old',
          lineText: '  removed()',
          body: 'Why was this removed?',
          commitSha: '1234567890abcdef',
        }),
      ],
      { branch: 'feature/x' }
    )

    assert.equal(
      text,
      [
        'Review from Gitybara of branch feature/x. Please address these comments.',
        '',
        'In commit 123456789:',
        '- a.ts, deleted line 2:',
        '  > removed()',
        '  Why was this removed?',
        '- z.ts, line 9:',
        '  > const a = 1',
        '  Later in the file',
        '',
        'In the uncommitted changes:',
        '- b.ts, line 3:',
        '  > const a = 1',
        '  Uncommitted',
      ].join('\n')
    )
  })

  it('indents comments of several lines and quotes empty lines', () => {
    const text = formatReviewPrompt(
      [comment({ lineText: '   ', body: 'First line\n\nSecond line\r\n' })],
      { branch: null }
    )

    assert.equal(
      text,
      [
        'Review from Gitybara. Please address these comments.',
        '',
        'In the uncommitted changes:',
        '- src/app.ts, line 1:',
        '  > (empty line)',
        '  First line',
        '',
        '  Second line',
      ].join('\n')
    )
  })

  it('cuts long lines short', () => {
    const text = formatReviewPrompt([comment({ lineText: 'x'.repeat(250) })], {
      branch: null,
    })

    assert.ok(text.includes(`> ${'x'.repeat(200)}…\n`))
  })

  it('adds the note at the end', () => {
    assert.ok(
      formatReviewPrompt([comment({})], {
        branch: null,
        note: '  Add a test too. ',
      }).endsWith('\n\nAlso: Add a test too.')
    )
    assert.equal(
      formatReviewPrompt([], { branch: 'main', note: 'Only a note' }),
      'Review from Gitybara of branch main.\n\nOnly a note'
    )
  })
})
