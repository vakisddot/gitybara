import { describe, it } from 'node:test'
import assert from 'node:assert'

import { getReviewAnchor } from '../../src/ui/changes/ide/ide-review-comments'
import { IPreviousLineBlock } from '../../src/ui/changes/ide/ide-line-changes'

const block = (
  line: number,
  oldLineNumber: number,
  count: number
): IPreviousLineBlock => ({
  line,
  oldLineNumber,
  lines: new Array(count).fill('old'),
  inlineChanges: [],
})

describe('getReviewAnchor', () => {
  it('puts a comment on a line of the file under it', () => {
    assert.deepStrictEqual(getReviewAnchor({ side: 'new', line: 1 }, 3, []), {
      line: 0,
      above: false,
    })
    assert.deepStrictEqual(getReviewAnchor({ side: 'new', line: 3 }, 3, []), {
      line: 2,
      above: false,
    })
  })

  it('leaves out lines the file does not have', () => {
    assert.equal(getReviewAnchor({ side: 'new', line: 4 }, 3, []), null)
    assert.equal(getReviewAnchor({ side: 'new', line: 0 }, 3, []), null)
    assert.equal(getReviewAnchor({ side: 'new', line: 1 }, 0, []), null)
    assert.equal(getReviewAnchor({ side: 'old', line: 9 }, 3, []), null)
  })

  it('puts a comment on an old line with the old lines it is one of', () => {
    const blocks = [block(1, 2, 2), block(3, 5, 1)]

    assert.deepStrictEqual(
      getReviewAnchor({ side: 'old', line: 3 }, 3, blocks),
      {
        line: 1,
        above: true,
      }
    )
    // Removed after the last line, so shown under it
    assert.deepStrictEqual(
      getReviewAnchor({ side: 'old', line: 5 }, 3, blocks),
      {
        line: 2,
        above: false,
      }
    )
    assert.equal(getReviewAnchor({ side: 'old', line: 4 }, 3, blocks), null)
  })
})
