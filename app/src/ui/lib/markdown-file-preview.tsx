import * as React from 'react'
import * as Path from 'path'

import { shell } from '../../lib/app-shell'
import { Emoji } from '../../lib/emoji'
import { SandboxedMarkdown } from './sandboxed-markdown'
import { onFileContentWheel } from './file-content-zoom'

const NoEmoji = new Map<string, Emoji>()

/** Whether a file can be previewed as Markdown (without executing MDX). */
export function isMarkdownFile(path: string): boolean {
  const extension = Path.extname(path).toLowerCase()
  return extension === '.md' || extension === '.markdown'
}

interface IMarkdownFilePreviewProps {
  readonly markdown: string
  readonly zoomFactor?: number
}

const openLink = (url: string) => {
  shell.openExternal(url)
}

/** A full Markdown document, rendered using the app's isolated renderer. */
export function MarkdownFilePreview({
  markdown,
  zoomFactor,
}: IMarkdownFilePreviewProps) {
  return (
    <div className="markdown-file-preview">
      <SandboxedMarkdown
        markdown={markdown}
        zoomFactor={zoomFactor}
        onWheel={onFileContentWheel}
        emoji={NoEmoji}
        breaks={false}
        underlineLinks={true}
        onMarkdownLinkClicked={openLink}
        title="Markdown file preview"
        customCSS={`
          .markdown-body {
            box-sizing: border-box;
            max-width: 980px;
            margin: 0 auto;
            padding: 24px 32px;
          }
        `}
      />
    </div>
  )
}
