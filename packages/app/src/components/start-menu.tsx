import { Button } from "@librecode/ui/button"
import { useDialog } from "@librecode/ui/context/dialog"
import { Icon } from "@librecode/ui/icon"
import { createEffect, createResource, createSignal, For, onCleanup, Show, startTransition } from "solid-js"
import { Portal } from "solid-js/web"
import { useServer } from "@/context/server"
import { useGlobalSDK } from "@/context/global-sdk"
import { useLanguage } from "@/context/language"
import { MarketplaceDialog } from "./marketplace-dialog"

type AppEntry = {
  server: string
  name: string
  uri: string
  description?: string
  mimeType?: string
  builtin?: boolean
}

interface StartMenuProps {
  onLaunch: (app: AppEntry) => void
}

export function StartMenu(props: StartMenuProps) {
  const server = useServer()
  const globalSDK = useGlobalSDK()
  const language = useLanguage()
  const dialog = useDialog()
  const [open, setRawOpen] = createSignal(false)
  const [anchor, setAnchor] = createSignal<HTMLButtonElement>()

  // v0.9.70 — open/close inside `startTransition` so the `createResource`
  // that fires when `open()` becomes truthy doesn't bubble its `loading`
  // state to the nearest Suspense boundary (same SessionRoute boundary
  // that caused the blank-screen flashes in v0.9.54 tab switches and
  // v0.9.58 pin-adds). Without this, clicking Start briefly re-renders
  // every pane behind the dropdown.
  const setOpen = (next: boolean) => {
    void startTransition(() => setRawOpen(next))
  }
  // v0.9.62 — Portal-render the panel so the review pane's
  // `will-change: width` stacking context doesn't clip it under the
  // tab strip. Anchor coordinates are recomputed on open + scroll +
  // resize so the panel stays pinned to the Apps button.
  const [coords, setCoords] = createSignal<{ top: number; right: number } | undefined>()

  const baseUrl = () => server.current?.http?.url ?? globalSDK.url

  // v0.9.71 — prefetch the app list at mount instead of on open.
  //
  // v0.9.70 tried to fix the "open-Start flashes the session pane"
  // bug with `startTransition` around `setOpen`, but in practice the
  // fallback still fired. Root cause: the resource's source key was
  // `open() ? baseUrl() : undefined`, so flipping `open` changed
  // the source and kicked `createResource` into `loading`. Solid's
  // transition tracking doesn't reliably defer a Suspense fallback
  // when the triggering signal is a cheap synchronous flip that
  // causes a DOWNSTREAM resource to enter loading — the fallback
  // can commit before the transition settles.
  //
  // Cleanest fix: remove the user-interaction → resource-loading
  // edge entirely. Key the resource only on `baseUrl()` (which is
  // stable for the session) so it fires once at mount. Opening the
  // menu then becomes a pure UI state change with zero resource
  // involvement, which can't touch Suspense at all.
  //
  // The `baseUrl()` dependency means the resource re-runs if the
  // server URL ever rotates (e.g. reconnecting to a different
  // sidecar). That's an acceptable reload — users actively aware
  // they're switching servers expect it.
  const [apps] = createResource(
    () => baseUrl(),
    async (url) => {
      // Use globalSDK.fetch — pre-wired with Basic auth from server.http.password.
      // Plain fetch() 401s in Tauri prod (sidecar ships with a UUID password).
      const res = await globalSDK.fetch(`${url}/mcp/apps`)
      if (!res.ok) return []
      return (await res.json()) as AppEntry[]
    },
  )

  const builtinApps = () => (apps() ?? []).filter((a) => a.builtin)
  const mcpApps = () => (apps() ?? []).filter((a) => !a.builtin)

  const updateCoords = () => {
    const el = anchor()
    if (!el) return
    const rect = el.getBoundingClientRect()
    setCoords({ top: rect.bottom + 4, right: window.innerWidth - rect.right })
  }

  createEffect(() => {
    if (!open()) return
    updateCoords()
    window.addEventListener("resize", updateCoords)
    window.addEventListener("scroll", updateCoords, { capture: true, passive: true })
    // Close on click-away. Use mousedown so the button's own click
    // can still toggle it shut without a race with the document
    // listener swallowing the event.
    const onDocDown = (e: MouseEvent) => {
      const target = e.target as Node | null
      if (!target) return
      if (anchor()?.contains(target)) return
      if (document.getElementById("start-menu-panel")?.contains(target)) return
      setOpen(false)
    }
    document.addEventListener("mousedown", onDocDown)
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false)
    }
    document.addEventListener("keydown", onEsc)
    onCleanup(() => {
      window.removeEventListener("resize", updateCoords)
      window.removeEventListener("scroll", updateCoords, { capture: true })
      document.removeEventListener("mousedown", onDocDown)
      document.removeEventListener("keydown", onEsc)
    })
  })

  return (
    <>
      <Button
        ref={setAnchor}
        type="button"
        variant="ghost"
        class="h-6 px-1.5 text-11-regular gap-1"
        onClick={() => setOpen(!open())}
        aria-haspopup="menu"
        aria-expanded={open()}
      >
        <Icon name="dot-grid" class="size-3.5" />
        {/*
          v0.9.64 — relabeled "Apps" → "Start" to match the
          underlying component name (`StartMenu`) and the agentic-OS
          framing the project has been building toward. The button
          opens a launcher that lists pinned built-ins + connected
          MCP-server apps, with a "Browse marketplace" entry at the
          bottom that searches mcpappfoundry.app.
        */}
        <span class="hidden lg:inline">Start</span>
      </Button>

      <Show when={open() && coords()}>
        {(pos) => (
          <Portal>
            <div
              id="start-menu-panel"
              role="menu"
              // v0.9.69 — `--color-surface-panel` isn't defined in
              // the theme; `bg-surface-panel` rendered transparent
              // and let the Review panel text bleed through the
              // Portal-rendered dropdown. Use `--surface-float-base`
              // which is the theme's defined solid panel colour.
              class="fixed w-[300px] max-h-[400px] overflow-y-auto rounded-md border border-border-weak-base bg-surface-float-base shadow-2xl"
              style={{
                top: `${pos().top}px`,
                right: `${pos().right}px`,
                // Above every other stacking context — the session
                // side panel's `will-change: width` creates its own
                // stacking context that would otherwise trap a
                // sibling-rendered menu below it.
                "z-index": "1000",
              }}
            >
              <div class="p-2">
                <Show when={builtinApps().length > 0}>
                  <div class="px-2 py-1 text-10-regular text-text-weaker uppercase tracking-wider">Built-in</div>
                  <For each={builtinApps()}>
                    {(app) => (
                      <button
                        class="w-full text-left px-2 py-2 rounded-sm hover:bg-surface-raised-base transition-colors cursor-pointer"
                        onClick={() => {
                          setOpen(false)
                          props.onLaunch(app)
                        }}
                      >
                        <div class="text-13-medium text-text-base">{app.name}</div>
                        <Show when={app.description}>
                          <div class="text-11-regular text-text-weak mt-0.5">{app.description}</div>
                        </Show>
                      </button>
                    )}
                  </For>
                </Show>

                <Show when={mcpApps().length > 0}>
                  <div class="px-2 py-1 mt-1 text-10-regular text-text-weaker uppercase tracking-wider">
                    MCP Servers
                  </div>
                  <For each={mcpApps()}>
                    {(app) => (
                      <button
                        class="w-full text-left px-2 py-2 rounded-sm hover:bg-surface-raised-base transition-colors cursor-pointer"
                        onClick={() => {
                          setOpen(false)
                          props.onLaunch(app)
                        }}
                      >
                        <div class="flex items-center gap-2">
                          <span class="text-13-medium text-text-base">{app.name}</span>
                          <span class="text-10-regular text-text-weaker">{app.server}</span>
                        </div>
                        <Show when={app.description}>
                          <div class="text-11-regular text-text-weak mt-0.5">{app.description}</div>
                        </Show>
                      </button>
                    )}
                  </For>
                </Show>

                <Show when={!apps.loading && (apps() ?? []).length === 0}>
                  <div class="px-2 py-4 text-12-regular text-text-weak text-center">
                    {language.t("startmenu.empty") ?? "No apps available. Connect an MCP server with UI resources."}
                  </div>
                </Show>

                <Show when={apps.loading}>
                  <div class="px-2 py-4 text-12-regular text-text-weak text-center animate-pulse">Loading apps...</div>
                </Show>

                {/*
                  v0.9.64 — marketplace entry. Always visible, whether
                  apps are loaded or empty, so the user has a path to
                  discover new apps without first connecting an MCP
                  server locally. Opens a modal that searches
                  mcpappfoundry.app through the host's /marketplace proxy.
                */}
                <div class="mt-1 pt-1 border-t border-border-weak-base">
                  <button
                    class="w-full flex items-center gap-2 px-2 py-2 rounded-sm hover:bg-surface-raised-base transition-colors cursor-pointer"
                    onClick={() => {
                      setOpen(false)
                      dialog.show(() => <MarketplaceDialog onClose={() => dialog.close()} />)
                    }}
                  >
                    <Icon name="magnifying-glass" class="size-3.5 text-text-weaker" />
                    <span class="text-12-medium text-text-base">Browse marketplace</span>
                    <span class="flex-1" />
                    <span class="text-10-regular text-text-weaker">mcpappfoundry.app</span>
                  </button>
                </div>
              </div>
            </div>
          </Portal>
        )}
      </Show>
    </>
  )
}
