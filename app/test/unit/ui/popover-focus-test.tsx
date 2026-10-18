import assert from 'node:assert'
import { afterEach, beforeEach, describe, it } from 'node:test'
import * as React from 'react'

import { IdeKeysButton } from '../../../src/ui/changes/ide/ide-keys-button'
import { Popover, PopoverAnchorPosition } from '../../../src/ui/lib/popover'
import { fireEvent, render, screen } from '../../helpers/ui/render'
import {
  advanceTimersBy,
  enableTestTimers,
  resetTestTimers,
} from '../../helpers/ui/timers'

describe('Popover focus', () => {
  beforeEach(() => enableTestTimers(['setTimeout']))
  afterEach(() => resetTestTimers())

  for (const canEdit of [false, true]) {
    it(`opens and dismisses keyboard shortcuts for ${
      canEdit ? 'editable' : 'read-only'
    } files`, () => {
      render(
        <>
          <div>
            <IdeKeysButton canEdit={canEdit} />
          </div>
          <button>Outside</button>
        </>
      )

      const trigger = screen.getByRole('button', { name: 'Keyboard shortcuts' })
      trigger.focus()
      fireEvent.click(trigger)

      const popover = screen.getByRole('dialog', { name: 'Keyboard shortcuts' })
      advanceTimersBy(0)
      assert.ok(document.activeElement === popover)
      assert.ok(screen.getByText('Show or hide the previous lines'))

      for (const shiftKey of [false, true]) {
        fireEvent.keyDown(popover, { key: 'Tab', shiftKey })
        assert.ok(document.activeElement === popover)
      }

      fireEvent.keyDown(popover, { key: 'Escape' })
      assert.ok(screen.queryByRole('dialog') === null)
      assert.ok(document.activeElement === trigger)

      fireEvent.click(trigger)
      const reopened = screen.getByRole('dialog', {
        name: 'Keyboard shortcuts',
      })
      advanceTimersBy(0)
      assert.ok(document.activeElement === reopened)

      fireEvent.mouseDown(screen.getByRole('button', { name: 'Outside' }))
      assert.ok(screen.queryByRole('dialog') === null)
      assert.ok(document.activeElement === trigger)
    })
  }

  it('focuses the first control when one is available', () => {
    render(
      <Popover anchor={null} anchorPosition={PopoverAnchorPosition.Bottom}>
        <button>First action</button>
        <button>Second action</button>
      </Popover>
    )

    advanceTimersBy(0)
    assert.ok(
      document.activeElement ===
        screen.getByRole('button', { name: 'First action' })
    )
  })
})
