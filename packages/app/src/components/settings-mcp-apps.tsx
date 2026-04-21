/**
 * v0.9.48 — Settings → MCP Apps pane.
 *
 * Lists discovered MCP apps (built-ins + connected external servers)
 * grouped by server. For each app, surfaces:
 *   * Server, app name, app uri
 *   * Per-app `ui/message` char-limit override (empty = use the
 *     default DEFAULT_MCP_MESSAGE_CHAR_LIMIT). Stored in
 *     localStorage via useMcpAppSettings — not session-scoped, lives
 *     across sessions for this install.
 *
 * Future (out of scope for v0.9.48):
 *   * "Always allow" / "Always deny" toggles per (server, tool) —
 *     needs a server-side persistent-rule edit API which doesn't
 *     exist yet (s.approved is in-memory after load).
 *   * "Last used" timestamp + "Calls this session" counter — needs
 *     audit-log integration (per the original v0.9.48 plan).
 *   * Per-app cost cap for sampling/createMessage — wired in v0.9.49.
 */
import { Component, createMemo, createResource, For, Show } from "solid-js"
import { Button } from "@librecode/ui/button"
import { useMcpAppSettings } from "@/context/mcp-app-settings"
import { useGlobalSDK } from "@/context/global-sdk"
import { useSDK } from "@/context/sdk"
import { DEFAULT_MCP_MESSAGE_CHAR_LIMIT } from "@/components/mcp-app-message"
import type { McpAppResource } from "@/components/mcp-app-panel"

async function fetchAppList(
  fetchFn: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
  baseUrl: string,
  directory: string,
): Promise<McpAppResource[]> {
  const url = new URL(`${baseUrl}/mcp/apps`)
  url.searchParams.set("directory", directory)
  const res = await fetchFn(url.toString())
  if (!res.ok) return []
  return (await res.json()) as McpAppResource[]
}

/** Group apps by server name for display. Exported for tests. */
export function groupByServer(apps: McpAppResource[]): Map<string, McpAppResource[]> {
  const out = new Map<string, McpAppResource[]>()
  for (const app of apps) {
    const list = out.get(app.server) ?? []
    list.push(app)
    out.set(app.server, list)
  }
  return out
}

export const SettingsMcpApps: Component = () => {
  const sdk = useSDK()
  const globalSDK = useGlobalSDK()
  const settings = useMcpAppSettings()

  const [apps] = createResource(() => fetchAppList(globalSDK.fetch, sdk.url, sdk.directory))

  const grouped = createMemo(() => {
    const list = apps()
    if (!list) return new Map<string, McpAppResource[]>()
    return groupByServer(list)
  })

  return (
    <div class="flex flex-col gap-6 p-6 max-w-3xl" data-component="settings-mcp-apps">
      <header>
        <h2 class="text-16-medium text-text-strong">MCP Apps</h2>
        <p class="text-12-regular text-text-weak mt-1">
          Per-app settings for MCP UI resources advertised by your connected MCP servers. Char-limit overrides are
          stored locally; they don't sync across machines.
        </p>
      </header>

      <Show when={apps.loading}>
        <div class="text-12-regular text-text-weak animate-pulse">Loading apps…</div>
      </Show>

      <Show when={!apps.loading && grouped().size === 0}>
        <div class="text-12-regular text-text-weak">No MCP apps connected.</div>
      </Show>

      <For each={Array.from(grouped().entries())}>
        {([server, serverApps]) => {
          const limitFor = settings.messageCharLimit(server)
          return (
            <section class="rounded-md border border-border-weak-base bg-surface-panel p-4 flex flex-col gap-3">
              <div>
                <div class="text-13-medium text-text-strong">{server}</div>
                <div class="text-11-regular text-text-weaker mt-0.5">
                  {serverApps.length} app{serverApps.length === 1 ? "" : "s"}
                </div>
              </div>

              <ul class="text-12-regular text-text-weak flex flex-col gap-1">
                <For each={serverApps}>
                  {(app) => (
                    <li class="flex items-baseline gap-2">
                      <span class="text-text-strong">{app.name}</span>
                      <code class="text-11-regular text-text-weaker font-mono truncate">{app.uri}</code>
                    </li>
                  )}
                </For>
              </ul>

              <div class="flex items-center gap-3 pt-2 border-t border-border-weaker-base">
                <label class="text-12-regular text-text-weak shrink-0" for={`mcl-${server}`}>
                  ui/message char limit
                </label>
                <input
                  id={`mcl-${server}`}
                  type="number"
                  min="0"
                  step="100"
                  class="px-2 py-1 rounded border border-border-weak-base bg-background-stronger text-text-base text-12-regular w-32"
                  placeholder={String(DEFAULT_MCP_MESSAGE_CHAR_LIMIT)}
                  value={limitFor() ?? ""}
                  onInput={(e) => {
                    const raw = e.currentTarget.value.trim()
                    if (raw === "") {
                      settings.setMessageCharLimit(server, undefined)
                      return
                    }
                    const n = Number(raw)
                    if (!Number.isFinite(n) || n < 0) return
                    settings.setMessageCharLimit(server, Math.floor(n))
                  }}
                />
                <span class="text-11-regular text-text-weaker">
                  default {DEFAULT_MCP_MESSAGE_CHAR_LIMIT.toLocaleString()}; 0 disables the cap
                </span>
                <span class="flex-1" />
                <Show when={limitFor() !== undefined}>
                  <Button
                    variant="ghost"
                    size="small"
                    onClick={() => settings.setMessageCharLimit(server, undefined)}
                    title="Reset this server's char limit to the default"
                  >
                    Reset
                  </Button>
                </Show>
              </div>
            </section>
          )
        }}
      </For>
    </div>
  )
}
