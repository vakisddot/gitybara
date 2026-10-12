import { describe, it } from 'node:test'
import assert from 'node:assert'
import { planImport } from '../../src/lib/github-desktop-import'

const repo = (path: string, alias: string | null = null) => ({ path, alias })

describe('planImport', () => {
  it('adds repositories that are not in the app yet', () => {
    const plan = planImport([repo('/code/one')], [repo('/code/two', 'Two')])

    assert.deepStrictEqual(plan.toAdd, [repo('/code/two', 'Two')])
    assert.equal(plan.alreadyAdded, 0)
    assert.deepStrictEqual(plan.aliasUpdates, [])
  })

  it('leaves repositories that are already in the app', () => {
    const plan = planImport([repo('/code/one')], [repo('/code/one')])

    assert.deepStrictEqual(plan.toAdd, [])
    assert.equal(plan.alreadyAdded, 1)
    assert.deepStrictEqual(plan.aliasUpdates, [])
  })

  it('adopts an alias only when the app repository has none', () => {
    const noAlias = repo('/code/one')
    const hasAlias = repo('/code/two', 'Mine')

    const plan = planImport(
      [noAlias, hasAlias],
      [repo('/code/one', 'One'), repo('/code/two', 'Theirs')]
    )

    assert.equal(plan.alreadyAdded, 2)
    assert.deepStrictEqual(plan.aliasUpdates, [
      { repository: noAlias, alias: 'One' },
    ])
  })

  it('ignores an incoming repository with no alias', () => {
    const plan = planImport([repo('/code/one')], [repo('/code/one', null)])

    assert.deepStrictEqual(plan.aliasUpdates, [])
  })

  it('counts a path that appears twice once', () => {
    const plan = planImport(
      [repo('/code/one')],
      [repo('/code/one'), repo('/code/two'), repo('/code/two')]
    )

    assert.equal(plan.alreadyAdded, 1)
    assert.deepStrictEqual(plan.toAdd, [repo('/code/two')])
  })

  it('matches paths that differ only by dot segments', () => {
    const plan = planImport([repo('/code/one')], [repo('/code/./one')])

    assert.deepStrictEqual(plan.toAdd, [])
    assert.equal(plan.alreadyAdded, 1)
  })
})
