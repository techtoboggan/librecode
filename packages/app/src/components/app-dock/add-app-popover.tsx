import { createResource, For, Show, type JSX } from "solid-js"
import { Popover as Kobalte } from "@kobalte/core/popover"
import { useGlobalSDK } from "@/context/global-sdk"
import { useSDK } from "@/context/sdk"
import { fetchAppList } from "@/components/mcp-app-panel/fetch"
import { useAppDockState } from "./use-dock-state"

/**
 * "+ Add app to dock" trigger + popover.
 *
 * Fetches the available MCP app list once at mount (keyed on sdk.url,
 * which is mount-time stable — ADR-006 compliant). Already-docked apps
 * are shown as disabled with an "in dock" label.
 *
 * IMPORTANT: Render this component OUTSIDE the DragDropProvider's DOM
 * subtree so the Kobalte Portal's click events are not intercepted by
 * the drag context (Pitfall #3 from phase-43-spec.md).
 */
export function AddAppPopover(): JSX.Element {
  const dock = useAppDockState()
  const sdk = useSDK()
  const globalSDK = useGlobalSDK()

  // adr-006: keyed on sdk.url which is mount-time stable (set from the
  // SDK context at initialisation, never written by a user interaction).
  // Fires once when AddAppPopover mounts. NOT keyed on dock state so
  // adding/removing entries never re-fetches.
  const [apps] = createResource(
    () => sdk.url,
    (url) => fetchAppList(globalSDK.fetch, url, sdk.directory),
  )

  const isInDock = (uri: string) => dock.state().entries.some((e) => e.uri === uri)

  return (
    <Kobalte placement="top-start" gutter={4}>
      <Kobalte.Trigger
        data-testid="dock-add-trigger"
        class="flex w-full items-center gap-2 px-3 py-2 text-12-regular text-text-weak hover:text-text-base hover:bg-surface-raised-base-hover"
      >
        + Add app to dock
      </Kobalte.Trigger>
      <Kobalte.Portal>
        <Kobalte.Content class="z-50 min-w-48 rounded-md border border-border-base bg-surface-panel shadow-lg">
          <Show when={apps()} fallback={<div class="p-3 text-12-regular text-text-weak">Loading apps…</div>}>
            {(list) => (
              <Show
                when={list().length > 0}
                fallback={
                  <div class="p-3 text-12-regular text-text-weak">
                    No MCP apps available. Configure an MCP server first.
                  </div>
                }
              >
                <div class="py-1">
                  <For each={list()}>
                    {(app) => (
                      <button
                        data-testid={`dock-add-${app.uri}`}
                        type="button"
                        disabled={isInDock(app.uri)}
                        class="flex w-full items-center justify-between gap-2 px-3 py-2 text-12-regular hover:bg-surface-raised-base-hover disabled:opacity-40 disabled:cursor-not-allowed"
                        onClick={() => {
                          dock.add(app)
                        }}
                      >
                        <span class="text-text-base truncate">{app.name}</span>
                        <Show when={isInDock(app.uri)}>
                          <span class="text-text-weaker text-11-regular shrink-0">in dock</span>
                        </Show>
                      </button>
                    )}
                  </For>
                </div>
              </Show>
            )}
          </Show>
        </Kobalte.Content>
      </Kobalte.Portal>
    </Kobalte>
  )
}
