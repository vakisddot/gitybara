import assert from 'node:assert/strict'
import { afterEach, describe, it, mock } from 'node:test'
import * as React from 'react'

import { SandboxedMarkdown } from '../../../src/ui/lib/sandboxed-markdown'
import { fireEvent, render, waitFor } from '../../helpers/ui/render'

afterEach(() => mock.restoreAll())

describe('Sandboxed Markdown zoom', () => {
  it('handles wheel events inside the frame and changes zoom without rebuilding its document', async () => {
    // jsdom doesn't fetch data-URL frames. Supply the loaded document below.
    mock.method(
      SandboxedMarkdown.prototype,
      'componentDidMount',
      async () => {}
    )
    const ref = React.createRef<SandboxedMarkdown>()
    const onWheel = mock.fn((event: WheelEvent) => event.preventDefault())
    const props = {
      markdown: '# Document',
      emoji: new Map(),
      underlineLinks: true,
      title: 'Markdown file preview',
      zoomFactor: 1,
      onWheel,
    }
    const view = render(<SandboxedMarkdown {...props} ref={ref} />)
    const component = ref.current
    const frame = view.container.querySelector('iframe')
    assert.ok(component)
    assert.ok(frame)
    Object.assign(component, { getInlineStyleSheet: async () => '' })
    const originalFrame = globalThis.requestAnimationFrame
    const callbacks: FrameRequestCallback[] = []
    globalThis.requestAnimationFrame = callback => {
      callbacks.push(callback)
      return callbacks.length
    }
    try {
      await component.renderMarkdown()
      const doc = frame.contentDocument
      assert.ok(doc)
      doc.open()
      doc.write('<html><body><h1>Document</h1></body></html>')
      doc.close()
      const onFrame = callbacks.shift()
      assert.ok(onFrame)
      onFrame(0)
      await waitFor(() => assert.equal(doc.body.style.zoom, '1'))

      const wheel = new WheelEvent('wheel', {
        ctrlKey: true,
        deltaY: -100,
        bubbles: true,
        cancelable: true,
      })
      fireEvent(doc.body, wheel)
      assert.equal(onWheel.mock.callCount(), 1)
      assert.equal(wheel.defaultPrevented, true)

      const source = frame.src
      const parse = mock.method(component, 'renderMarkdown')
      view.rerender(<SandboxedMarkdown {...props} zoomFactor={1.5} ref={ref} />)
      assert.equal(parse.mock.callCount(), 0)
      assert.equal(frame.src, source)
      assert.equal(frame.contentDocument, doc)
      assert.equal(doc.body.style.zoom, '1.5')
      assert.equal(doc.querySelector('h1')?.textContent, 'Document')
      assert.equal(frame.getAttribute('sandbox'), 'allow-same-origin')
    } finally {
      globalThis.requestAnimationFrame = originalFrame
    }
  })
})
