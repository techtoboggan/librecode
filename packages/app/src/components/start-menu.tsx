import { Button } from "@librecode/ui/button"
import { Icon } from "@librecode/ui/icon"
import { createResource, createSignal, For, Show } from "solid-js"
import { useServer } from "@/context/server"
import { useGlobalSDK } from "@/context/global-sdk"
import { useLanguage } from "@/context/language"

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
  const [open, setOpen] = createSignal(false)

  const baseUrl = () => server.current?.http?.url ?? globalSDK.url

  const [apps] = createResource(
    () => (open() ? baseUrl() : undefined),
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

  return (
    <div class="relative">
      <Button type="button" variant="ghost" class="h-6 px-1.5 text-11-regular gap-1" onClick={() => setOpen(!open())}>
        <Icon name="dot-grid" class="size-3.5" />
        <span class="hidden lg:inline">Apps</span>
      </Button>

      <Show when={open()}>
        <div class="absolute top-full right-0 mt-1 w-[300px] max-h-[400px] overflow-y-auto z-50 rounded-md border border-border-weak-base bg-surface-panel shadow-lg">
          <div class="p-2">
            <Show when={builtinApps().length > 0}>
              <div class="px-2 py-1 text-10-regular text-text-weaker uppercase tracking-wider">Built-in</div>
              <For each={builtinApps()}>
                {(app) => (
                  <button
                    class="w-full text-left px-2 py-2 rounded-sm hover:bg-surface-raised-base transition-colors cursor-pointer"
                    onClick={() => {
                      props.onLaunch(app)
                      setOpen(false)
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
              <div class="px-2 py-1 mt-1 text-10-regular text-text-weaker uppercase tracking-wider">MCP Servers</div>
              <For each={mcpApps()}>
                {(app) => (
                  <button
                    class="w-full text-left px-2 py-2 rounded-sm hover:bg-surface-raised-base transition-colors cursor-pointer"
                    onClick={() => {
                      props.onLaunch(app)
                      setOpen(false)
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
                No apps available. Connect an MCP server with UI resources.
              </div>
            </Show>

            <Show when={apps.loading}>
              <div class="px-2 py-4 text-12-regular text-text-weak text-center animate-pulse">Loading apps...</div>
            </Show>
          </div>
        </div>
      </Show>
    </div>
  )
}
