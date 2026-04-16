/**
 * PortPreviewTab — embedded preview for a localhost dev server.
 *
 * Renders a full-height iframe pointing at http://localhost:{port}.
 * No sandbox attribute: localhost is a trusted development origin and apps
 * need cookies, IndexedDB, and inline scripts to work correctly.
 */

import type { JSX } from "solid-js"

export interface PortPreviewTabProps {
  port: number
}

export function PortPreviewTab(props: PortPreviewTabProps): JSX.Element {
  const src = () => `http://localhost:${props.port}`

  return (
    <div class="w-full h-full flex flex-col overflow-hidden" data-component="port-preview-tab">
      <div class="shrink-0 px-3 py-1.5 border-b border-border-weaker-base flex items-center gap-2">
        <span class="text-11-regular text-text-weaker select-none">Preview</span>
        <a
          href={src()}
          target="_blank"
          rel="noopener noreferrer"
          class="text-11-regular text-text-weak hover:text-text-base font-mono transition-colors"
        >
          localhost:{props.port} ↗
        </a>
      </div>
      <iframe
        src={src()}
        class="w-full flex-1 border-none bg-background-base"
        title={`Preview localhost:${props.port}`}
        aria-label={`Port preview: localhost:${props.port}`}
      />
    </div>
  )
}
