import { type JSX, Show, createMemo } from "solid-js"
import { useParams, useSearchParams } from "@solidjs/router"
import { McpAppPanel } from "@/components/mcp-app-panel"
import { usePlatform } from "@/context/platform"
import { SDKProvider } from "@/context/sdk"
import { SyncProvider } from "@/context/sync"

/**
 * Detached app shell — Phase 49.
 *
 * Renders a single `<McpAppPanel>` in a standalone Tauri window with
 * a slim header bar (app name + ↩ button for Re-attach / Close).
 *
 * URL: `/detached/:server/:uri?dir=<encoded-dir>` where `:uri` is
 * URL-encoded and `dir` is the workspace directory passed by the main
 * window when opening the detached window.
 *
 * ADR-006 N/A: no createResource at this layer. McpAppPanel is the
 * resource-bearing child and already audited. SDKProvider/SyncProvider
 * added to supply the required context missing from the detached route
 * (which sits outside the /:dir layout that normally provides them).
 */
export function DetachedAppShell(): JSX.Element {
  const params = useParams<{ server: string; uri: string }>()
  const [searchParams] = useSearchParams<{ dir?: string }>()
  const platform = usePlatform()

  const server = createMemo(() => decodeURIComponent(params.server))
  const uri = createMemo(() => decodeURIComponent(params.uri))
  const dir = createMemo(() => decodeURIComponent(searchParams.dir ?? ""))

  const onReattach = async (): Promise<void> => {
    // Emit IPC event back to all windows. The main window's dock
    // state listener calls reattach(uri), which un-marks `detached`
    // and re-mounts the iframe inline.
    if (platform.invokeTauriEvent) {
      await platform.invokeTauriEvent("dock.reattach", { uri: uri() })
    }
    // Then close this window. Re-attach via main does NOT
    // close us; we close ourselves to keep the contract clean.
    if (platform.closeDetachedWindow) {
      await platform.closeDetachedWindow({ server: server(), uri: uri() })
    }
  }

  return (
    <div data-component="detached-app-shell" class="w-screen h-screen flex flex-col overflow-hidden">
      <DetachedHeader appName={server()} onReattach={onReattach} />
      <div class="flex-1 min-h-0">
        <Show when={server() && uri() && dir()}>
          <SDKProvider directory={dir}>
            <SyncProvider>
              <McpAppPanel server={server()} uri={uri()} class="w-full h-full" />
            </SyncProvider>
          </SDKProvider>
        </Show>
      </div>
    </div>
  )
}

function DetachedHeader(props: { appName: string; onReattach: () => void }): JSX.Element {
  return (
    <div
      class="flex items-center justify-between px-3 py-2 shrink-0 border-b border-border-weak-base bg-background-base"
      data-testid="detached-header"
    >
      <span class="text-12-medium text-text-strong truncate">{props.appName}</span>
      <button
        type="button"
        data-testid="detached-reattach"
        class="text-11-regular text-text-weak hover:text-text-base transition-colors"
        onClick={() => props.onReattach()}
        title="Re-attach this app to the main window's dock"
      >
        ↩ Re-attach to dock
      </button>
    </div>
  )
}
