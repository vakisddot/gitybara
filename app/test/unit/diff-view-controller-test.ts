import { describe, it } from 'node:test'
import assert from 'node:assert'

import {
  DiffViewController,
  IDiffView,
  IDiffViewState,
} from '../../src/ui/diff/diff-view-controller'

const collapsed: IDiffViewState = {
  canToggleWholeFile: true,
  isWholeFileExpanded: false,
}

function createView() {
  let toggles = 0
  const view: IDiffView = { toggleWholeFile: () => toggles++ }
  return { view, toggles: () => toggles }
}

describe('DiffViewController', () => {
  it('has no state until a diff attaches, and none after it detaches', () => {
    const controller = new DiffViewController()
    const { view } = createView()
    assert.strictEqual(controller.state, null)

    controller.attach(view, collapsed)
    assert.deepStrictEqual(controller.state, collapsed)

    controller.detach(view)
    assert.strictEqual(controller.state, null)
  })

  it('tells the listeners only when the state changes', () => {
    const controller = new DiffViewController()
    const { view } = createView()
    let calls = 0
    const stop = controller.subscribe(() => calls++)

    controller.attach(view, collapsed)
    controller.update(view, { ...collapsed })
    assert.strictEqual(calls, 1)

    controller.update(view, { ...collapsed, isWholeFileExpanded: true })
    assert.strictEqual(calls, 2)

    stop()
    controller.detach(view)
    assert.strictEqual(calls, 2)
  })

  it('acts on the attached diff and ignores one that was replaced', () => {
    const controller = new DiffViewController()
    const first = createView()
    const second = createView()

    controller.attach(first.view, collapsed)
    controller.attach(second.view, { ...collapsed, canToggleWholeFile: false })

    // The replaced diff says what it can do, or goes away, after the new one
    controller.update(first.view, collapsed)
    controller.detach(first.view)
    assert.deepStrictEqual(controller.state, {
      ...collapsed,
      canToggleWholeFile: false,
    })

    controller.toggleWholeFile()
    assert.strictEqual(first.toggles(), 0)
    assert.strictEqual(second.toggles(), 1)
  })
})
