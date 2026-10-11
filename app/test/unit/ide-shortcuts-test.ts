import { afterEach, describe, it } from 'node:test'
import assert from 'node:assert'

import {
  getIdeShortcut,
  IdeShortcut,
} from '../../src/ui/changes/ide/ide-shortcuts'

const attached = new Array<Element>()

function create<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  parent: Element = document.body
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag)
  parent.appendChild(element)
  attached.push(element)
  return element
}

/** What a key that is pressed with the target focused asks for. */
function press(
  target: Element,
  key: string,
  init: KeyboardEventInit = {},
  isEditorReadOnly = false
): IdeShortcut | null {
  let shortcut: IdeShortcut | null = null
  const listener = (event: Event) => {
    shortcut = getIdeShortcut(event as KeyboardEvent, isEditorReadOnly)
  }

  document.addEventListener('keydown', listener)
  target.dispatchEvent(
    new KeyboardEvent('keydown', { key, bubbles: true, ...init })
  )
  document.removeEventListener('keydown', listener)

  return shortcut
}

afterEach(() => {
  attached.splice(0).forEach(element => element.remove())
})

describe('getIdeShortcut', () => {
  it('goes to the previous change with W and the next one with S', () => {
    assert.strictEqual(press(document.body, 'w'), 'previous-change')
    assert.strictEqual(press(document.body, 's'), 'next-change')
    assert.strictEqual(press(document.body, 'W'), 'previous-change')
  })

  it('leaves other keys alone', () => {
    assert.strictEqual(press(document.body, 'a'), null)
    assert.strictEqual(press(document.body, 'Enter'), null)
  })

  it('leaves the keys alone when they are part of another shortcut', () => {
    for (const init of [
      { ctrlKey: true },
      { metaKey: true },
      { altKey: true },
      { shiftKey: true },
    ]) {
      assert.strictEqual(press(document.body, 'w', init), null)
      assert.strictEqual(press(document.body, 's', init), null)
    }
  })

  it('leaves the keys alone while text is typed in a field', () => {
    assert.strictEqual(press(create('input'), 's'), null)
    assert.strictEqual(press(create('textarea'), 'w'), null)

    const search = create('input')
    search.type = 'search'
    assert.strictEqual(press(search, 'w'), null)
  })

  it('goes on to the changes from inputs that take no text', () => {
    const slider = create('input')
    slider.type = 'range'
    assert.strictEqual(press(slider, 's'), 'next-change')

    const checkbox = create('input')
    checkbox.type = 'checkbox'
    assert.strictEqual(press(checkbox, 'w'), 'previous-change')

    assert.strictEqual(press(create('button'), 's'), 'next-change')
  })

  it('leaves the keys alone inside a dialog', () => {
    const popover = create('div')
    popover.setAttribute('role', 'dialog')

    assert.strictEqual(press(create('button', popover), 's'), null)
  })

  it('leaves the keys to the editor when it can be edited', () => {
    const editor = create('div')
    editor.className = 'ide-code-editor'
    const input = create('textarea', editor)

    assert.strictEqual(press(input, 's', {}, false), null)
    assert.strictEqual(press(input, 'w', {}, false), null)
  })

  it('goes to the changes from an editor that can not be edited', () => {
    const editor = create('div')
    editor.className = 'ide-code-editor'
    const input = create('textarea', editor)

    assert.strictEqual(press(input, 's', {}, true), 'next-change')
    assert.strictEqual(press(input, 'w', {}, true), 'previous-change')
  })

  it('ignores a key that was already handled', () => {
    const listener = (event: Event) => event.preventDefault()
    document.addEventListener('keydown', listener, { capture: true })

    try {
      assert.strictEqual(press(document.body, 's', { cancelable: true }), null)
    } finally {
      document.removeEventListener('keydown', listener, { capture: true })
    }
  })

  it('finds with Ctrl+F, or Cmd+F on macOS, wherever the focus is', () => {
    const modifier = __DARWIN__ ? { metaKey: true } : { ctrlKey: true }
    const other = __DARWIN__ ? { ctrlKey: true } : { metaKey: true }

    assert.strictEqual(press(document.body, 'f', modifier), 'find')
    assert.strictEqual(press(create('input'), 'f', modifier), 'find')
    assert.strictEqual(press(document.body, 'F', modifier), 'find')

    assert.strictEqual(press(document.body, 'f', other), null)
    assert.strictEqual(press(document.body, 'f', {}), null)
    assert.strictEqual(
      press(document.body, 'f', { ...modifier, shiftKey: true }),
      null
    )
  })
})
