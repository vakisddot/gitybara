import * as React from 'react'
import { AutoSizer } from 'react-virtualized'

interface IZoomableImageDiffProps {
  readonly zoomFactor: number
  readonly children: React.ReactNode
}

/** Fit images at 100%, then magnify that canvas without fitting them again. */
export function ZoomableImageDiff({
  zoomFactor,
  children,
}: IZoomableImageDiffProps) {
  return (
    <div className="file-image-zoom">
      <AutoSizer>
        {({ width, height }) => (
          <div className="file-image-zoom-scroll" style={{ width, height }}>
            <div
              className="file-image-zoom-canvas"
              style={{ width, height, zoom: zoomFactor }}
            >
              {children}
            </div>
          </div>
        )}
      </AutoSizer>
    </div>
  )
}
