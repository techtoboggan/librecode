/**
 * Confirmation dialog shown when an MCP app issues `ui/download-file`.
 * Lists the items + filenames + sizes (when known) and asks the user
 * to approve before any bytes hit disk or any link opens.
 *
 * The dialog calls `onDecide(true|false)` exactly once; the handler in
 * mcp-app-panel.tsx owns the actual delivery (Blob → anchor click;
 * ResourceLink → window.open) and the bridge response shape.
 */
import { Button } from "@librecode/ui/button"
import { For, type JSX } from "solid-js"
import { type DownloadItem, downloadItemFilename } from "./mcp-app-panel"

export interface McpAppDownloadDialogProps {
  appName: string
  items: DownloadItem[]
  onDecide: (approve: boolean) => void
}

export function McpAppDownloadDialog(props: McpAppDownloadDialogProps): JSX.Element {
  const summary = () => {
    const n = props.items.length
    return n === 1 ? "a file" : `${n} files`
  }

  return (
    <div data-component="mcp-app-download-dialog" class="flex flex-col gap-3 p-4 max-w-md">
      <div class="text-14-medium text-text-strong">Download from {props.appName}?</div>
      <div class="text-12-regular text-text-weak">
        <span class="text-text-strong">{props.appName}</span> wants to download {summary()}:
      </div>

      <ul class="flex flex-col gap-1.5 max-h-48 overflow-y-auto rounded border border-border-weak-base bg-background-stronger p-2">
        <For each={props.items}>
          {(item) => (
            <li class="flex items-baseline gap-2 text-12-regular">
              <code class="font-mono text-text-strong">{downloadItemFilename(item)}</code>
              {item.type === "resource_link" ? (
                <span class="text-text-weaker text-11-regular truncate">{item.uri}</span>
              ) : (
                <span class="text-text-weaker text-11-regular">
                  {item.resource.mimeType ?? "application/octet-stream"}
                </span>
              )}
            </li>
          )}
        </For>
      </ul>

      <div class="flex gap-2 justify-end">
        <Button variant="ghost" size="small" onClick={() => props.onDecide(false)}>
          Cancel
        </Button>
        <Button variant="primary" size="small" onClick={() => props.onDecide(true)}>
          Download
        </Button>
      </div>
    </div>
  )
}
