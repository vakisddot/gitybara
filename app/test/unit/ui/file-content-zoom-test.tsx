import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, it } from 'node:test'
import * as React from 'react'

import { FileContentZoom } from '../../../src/ui/lib/file-content-zoom'
import { fireEvent, render, within } from '../../helpers/ui/render'

beforeEach(() => localStorage.removeItem('file-content-zoom'))
afterEach(() => localStorage.removeItem('file-content-zoom'))

function Content() {
  return (
    <FileContentZoom>
      {factor => <div data-testid="content">{factor}</div>}
    </FileContentZoom>
  )
}

describe('File content zoom', () => {
  it('zooms with buttons, shares the value between viewers, and remembers it after remounting', async () => {
    const view = render(
      <div>
        <Content />
        <Content />
      </div>
    )
    const viewers =
      view.container.querySelectorAll<HTMLElement>('.file-content-zoom')
    fireEvent.click(
      within(viewers[0]).getByRole('button', { name: 'Zoom in file content' })
    )
    assert.deepEqual(
      view.getAllByTestId('content').map(e => e.textContent),
      ['1.1', '1.1']
    )
    assert.equal(localStorage.getItem('file-content-zoom'), '110')
    assert.equal(viewers[0].getAttribute('style'), '--file-content-zoom: 1.1;')

    view.unmount()
    const remounted = render(<Content />)
    assert.equal(remounted.getByTestId('content').textContent, '1.1')
    fireEvent.click(
      remounted.getByRole('button', { name: 'Zoom out file content' })
    )
    assert.equal(remounted.getByTestId('content').textContent, '1')
    fireEvent.click(
      remounted.getByRole('button', { name: 'Zoom in file content' })
    )
    fireEvent.click(
      remounted.getByRole('button', { name: 'Reset file content zoom' })
    )
    assert.equal(remounted.getByTestId('content').textContent, '1')
  })

  it('handles Ctrl+wheel inside the viewer, cancels browser zoom, and leaves normal scrolling alone', async () => {
    const view = render(<Content />)
    const content = view.getByTestId('content')
    const wheel = (deltaY: number, ctrlKey: boolean) => {
      const event = new WheelEvent('wheel', {
        deltaY,
        ctrlKey,
        bubbles: true,
        cancelable: true,
      })
      fireEvent(content, event)
      return event
    }
    assert.equal(wheel(-100, true).defaultPrevented, true)
    assert.equal(content.textContent, '1.1')
    assert.equal(wheel(100, true).defaultPrevented, true)
    assert.equal(content.textContent, '1')
    assert.equal(wheel(100, false).defaultPrevented, false)
    assert.equal(wheel(0, true).defaultPrevented, false)
    assert.equal(content.textContent, '1')

    const outside = new WheelEvent('wheel', {
      deltaY: -100,
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    })
    fireEvent(document.body, outside)
    assert.equal(outside.defaultPrevented, false)
    assert.equal(content.textContent, '1')
  })

  it('bounds zoom from 50% to 300% and still cancels Ctrl+wheel at the limits', async () => {
    localStorage.setItem('file-content-zoom', '300')
    const view = render(<Content />)
    const content = view.getByTestId('content')
    assert.equal(
      view
        .getByRole('button', { name: 'Zoom in file content' })
        .getAttribute('aria-disabled'),
      'true'
    )
    const event = new WheelEvent('wheel', {
      deltaY: -100,
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    })
    fireEvent(content, event)
    assert.equal(event.defaultPrevented, true)
    assert.equal(content.textContent, '3')
    for (let i = 0; i < 30; i++) {
      fireEvent.wheel(content, { deltaY: 100, ctrlKey: true, cancelable: true })
    }
    assert.equal(content.textContent, '0.5')
    assert.equal(
      view
        .getByRole('button', { name: 'Zoom out file content' })
        .getAttribute('aria-disabled'),
      'true'
    )
  })
})
