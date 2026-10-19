import * as React from 'react'

import { clamp } from '../../lib/clamp'
import { getNumber, setNumber } from '../../lib/local-storage'
import { Button } from './button'
import { Octicon } from '../octicons'
import * as octicons from '../octicons/octicons.generated'

const ZoomKey = 'file-content-zoom'
const MinZoom = 50
const MaxZoom = 300
const ZoomStep = 10
const listeners = new Set<() => void>()

function getZoom(): number {
  return clamp(getNumber(ZoomKey, 100), MinZoom, MaxZoom)
}

function setZoom(percent: number) {
  const next = clamp(percent, MinZoom, MaxZoom)
  if (next !== getZoom()) {
    setNumber(ZoomKey, next)
    listeners.forEach(listener => listener())
  }
}

const zoomIn = () => setZoom(getZoom() + ZoomStep)
const zoomOut = () => setZoom(getZoom() - ZoomStep)
const resetZoom = () => setZoom(100)

/** Also attached inside Markdown iframes, whose wheel events don't bubble out. */
export function onFileContentWheel(event: WheelEvent) {
  if (
    !event.ctrlKey ||
    event.altKey ||
    event.metaKey ||
    event.deltaY === 0 ||
    event.defaultPrevented
  ) {
    return
  }

  // Cancel Chromium's window zoom and the editor's normal wheel scrolling.
  event.preventDefault()
  event.stopPropagation()
  if (event.deltaY < 0) {
    zoomIn()
  } else {
    zoomOut()
  }
}

interface IFileContentZoomProps {
  readonly children: (zoomFactor: number) => React.ReactNode
}

/** Shared, persisted zoom for file content, with controls outside the content. */
export function FileContentZoom({ children }: IFileContentZoomProps) {
  const [percent, setPercent] = React.useState(getZoom)
  const ref = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    const onChanged = () => setPercent(getZoom())
    listeners.add(onChanged)
    onChanged()
    return () => {
      listeners.delete(onChanged)
    }
  }, [])

  React.useEffect(() => {
    const element = ref.current
    element?.addEventListener('wheel', onFileContentWheel, {
      passive: false,
      capture: true,
    })
    return () => element?.removeEventListener('wheel', onFileContentWheel, true)
  }, [])

  return (
    <div
      className="file-content-zoom"
      ref={ref}
      style={{ '--file-content-zoom': percent / 100 } as React.CSSProperties}
    >
      <div
        className="file-content-zoom-controls"
        role="group"
        aria-label="File content zoom"
      >
        <Button
          onClick={zoomOut}
          disabled={percent === MinZoom}
          ariaLabel="Zoom out file content"
          tooltip="Zoom out (Ctrl+mouse wheel)"
        >
          <Octicon symbol={octicons.zoomOut} />
        </Button>
        <Button
          onClick={resetZoom}
          ariaLabel="Reset file content zoom"
          tooltip="Reset to 100%"
        >
          {percent}%
        </Button>
        <Button
          onClick={zoomIn}
          disabled={percent === MaxZoom}
          ariaLabel="Zoom in file content"
          tooltip="Zoom in (Ctrl+mouse wheel)"
        >
          <Octicon symbol={octicons.zoomIn} />
        </Button>
      </div>
      {children(percent / 100)}
    </div>
  )
}
