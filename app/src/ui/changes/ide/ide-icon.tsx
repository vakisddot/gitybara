import * as React from 'react'

import { encodePathAsUrl } from '../../../lib/path'

const iconUrls = new Map<string, string>()

function getIconUrl(name: string) {
  let url = iconUrls.get(name)

  if (url === undefined) {
    url = encodePathAsUrl(__dirname, `static/ide-icons/${name}.svg`)
    iconUrls.set(name, url)
  }

  return url
}

/** The width of an icon plus the space after it, in pixels. */
export const IdeIconSpace = 22

/** An icon of the IDE view, by the name of its SVG in static/ide-icons. */
export function IdeIcon({ name }: { readonly name: string }) {
  return <img className="ide-icon" src={getIconUrl(name)} alt="" />
}
