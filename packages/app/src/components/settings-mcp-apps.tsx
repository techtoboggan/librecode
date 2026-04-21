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
 * v0.9.51: Adds per-server "Activity this session" telemetry when
 *   Settings is opened inside a session (calls + last-used).
 * v0.9.52: Adds a persisted-rules list per server with a Remove
 *   action. Before v0.9.52, "Always allow" only stuck in-memory — it
 *   now round-trips through PermissionTable so rules survive restart.
 */
import { useParams } from "@solidjs/router"
import { Component, createMemo, createResource, For, Show } from "solid-js"
import { Button } from "@librecode/ui/button"
import { useMcpAppSettings } from "@/context/mcp-app-settings"
import { useGlobalSDK } from "@/context/global-sdk"
import { useSDK } from "@/context/sdk"
import { DEFAULT_MCP_MESSAGE_CHAR_LIMIT } from "@/components/mcp-app-message"
import type { McpAppResource } from "@/components/mcp-app-panel"
import { DEFAULT_SAMPLING_HOURLY_USD_CAP } from "@/components/mcp-app-sampling"

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

// Pure helpers live in ./settings-mcp-apps-helpers.ts so the test
// file can import them without pulling the router bundle this
// component depends on (useParams).
export {
  type UsageEntry,
  type PermissionRule,
  formatLastUsed,
  groupByServer,
  latestLastUsed,
  rulesForServer,
  toolFromPermission,
  totalCalls,
} from "./settings-mcp-apps-helpers"
import {
  type UsageEntry,
  type PermissionRule,
  formatLastUsed,
  groupByServer,
  latestLastUsed,
  rulesForServer,
  toolFromPermission,
  totalCalls,
} from "./settings-mcp-apps-helpers"

async function fetchUsage(
  fetchFn: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
  baseUrl: string,
  sessionID: string | undefined,
): Promise<UsageEntry[]> {
  if (!sessionID) return []
  const url = `${baseUrl}/session/${sessionID}/mcp-apps/usage`
  const res = await fetchFn(url)
  if (!res.ok) return []
  const body = (await res.json()) as { entries?: UsageEntry[] }
  return body.entries ?? []
}

// v0.9.52 — persisted "Always allow/deny" rules. The ruleset API lives
// under /permission/rules; see permission-routes + ADR-005.
async function fetchRules(
  fetchFn: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
  baseUrl: string,
): Promise<PermissionRule[]> {
  const res = await fetchFn(`${baseUrl}/permission/rules`)
  if (!res.ok) return []
  return (await res.json()) as PermissionRule[]
}

async function deleteRule(
  fetchFn: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
  baseUrl: string,
  rule: { permission: string; pattern: string },
): Promise<PermissionRule[]> {
  const res = await fetchFn(`${baseUrl}/permission/rules`, {
    method: "DELETE",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(rule),
  })
  if (!res.ok) return []
  return (await res.json()) as PermissionRule[]
}

export const SettingsMcpApps: Component = () => {
  const sdk = useSDK()
  const globalSDK = useGlobalSDK()
  const settings = useMcpAppSettings()
  const params = useParams<{ id?: string }>()

  const [apps] = createResource(() => fetchAppList(globalSDK.fetch, sdk.url, sdk.directory))

  // v0.9.51 telemetry: fetch usage entries for the current session
  // if Settings was opened inside a session. Mapped by server so each
  // pane can look up its own stats without re-filtering.
  const [usage] = createResource(
    () => params.id,
    (sessionID) => fetchUsage(globalSDK.fetch, sdk.url, sessionID),
  )

  // v0.9.52 — project-wide persisted ruleset ("Always allow/deny").
  // Held as a SolidJS signal so inline edits (delete a rule) rebuild
  // the per-server lists without a full refetch.
  const [rules, { mutate: mutateRules }] = createResource(() => fetchRules(globalSDK.fetch, sdk.url))

  async function onDeleteRule(rule: PermissionRule) {
    const next = await deleteRule(globalSDK.fetch, sdk.url, { permission: rule.permission, pattern: rule.pattern })
    mutateRules(next)
  }

  const usageByServer = createMemo(() => {
    const out = new Map<string, UsageEntry[]>()
    for (const entry of usage() ?? []) {
      const list = out.get(entry.server) ?? []
      list.push(entry)
      out.set(entry.server, list)
    }
    return out
  })

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
          const capFor = settings.samplingHourlyUsdCap(server)
          const serverUsage = createMemo(() => usageByServer().get(server) ?? [])
          const lastUsedMs = createMemo(() => latestLastUsed(serverUsage()))
          const serverRules = createMemo(() => rulesForServer(rules() ?? [], server))
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

              <Show when={params.id}>
                <div
                  class="pt-2 border-t border-border-weaker-base flex items-baseline gap-3 text-11-regular"
                  data-slot="mcp-apps-activity"
                >
                  <span class="text-text-weak">Activity this session:</span>
                  <Show when={serverUsage().length > 0} fallback={<span class="text-text-weaker">no calls yet</span>}>
                    <span class="text-text-strong">{totalCalls(serverUsage())} calls</span>
                    <Show when={lastUsedMs()}>
                      {(ms) => <span class="text-text-weaker">· last used {formatLastUsed(ms())}</span>}
                    </Show>
                  </Show>
                </div>
              </Show>

              <div
                class="pt-2 border-t border-border-weaker-base flex flex-col gap-1"
                data-slot="mcp-apps-rules"
              >
                <div class="flex items-baseline gap-2">
                  <span class="text-12-regular text-text-weak">Persisted rules</span>
                  <Show
                    when={serverRules().length > 0}
                    fallback={<span class="text-11-regular text-text-weaker">none — prompts every session</span>}
                  >
                    <span class="text-11-regular text-text-weaker">
                      {serverRules().length} rule{serverRules().length === 1 ? "" : "s"}
                    </span>
                  </Show>
                </div>
                <Show when={serverRules().length > 0}>
                  <ul class="flex flex-col gap-1">
                    <For each={serverRules()}>
                      {(rule) => (
                        <li
                          class="flex items-baseline gap-2 text-11-regular"
                          data-slot="mcp-apps-rule"
                          data-action={rule.action}
                        >
                          <span
                            class="px-1.5 py-0.5 rounded text-10-medium shrink-0"
                            classList={{
                              "bg-success-surface text-success-text": rule.action === "allow",
                              "bg-danger-surface text-danger-text": rule.action === "deny",
                              "bg-background-stronger text-text-weak": rule.action === "ask",
                            }}
                          >
                            {rule.action}
                          </span>
                          <code class="font-mono text-text-strong truncate">{toolFromPermission(rule.permission)}</code>
                          <code class="font-mono text-text-weaker truncate">{rule.pattern}</code>
                          <span class="flex-1" />
                          <Button
                            variant="ghost"
                            size="small"
                            onClick={() => onDeleteRule(rule)}
                            title="Remove this rule — the next call will prompt again"
                          >
                            Remove
                          </Button>
                        </li>
                      )}
                    </For>
                  </ul>
                </Show>
              </div>

              <div class="flex items-center gap-3 pt-2 border-t border-border-weaker-base">
                <label class="text-12-regular text-text-weak shrink-0 w-44" for={`mcl-${server}`}>
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

              <div class="flex items-center gap-3 border-t border-border-weaker-base pt-2">
                <label class="text-12-regular text-text-weak shrink-0 w-44" for={`scap-${server}`}>
                  sampling cap (USD/hr)
                </label>
                <input
                  id={`scap-${server}`}
                  type="number"
                  min="0"
                  step="0.01"
                  class="px-2 py-1 rounded border border-border-weak-base bg-background-stronger text-text-base text-12-regular w-32"
                  placeholder={DEFAULT_SAMPLING_HOURLY_USD_CAP.toFixed(2)}
                  value={capFor() ?? ""}
                  onInput={(e) => {
                    const raw = e.currentTarget.value.trim()
                    if (raw === "") {
                      settings.setSamplingHourlyUsdCap(server, undefined)
                      return
                    }
                    const n = Number(raw)
                    if (!Number.isFinite(n) || n < 0) return
                    settings.setSamplingHourlyUsdCap(server, n)
                  }}
                />
                <span class="text-11-regular text-text-weaker">
                  default ${DEFAULT_SAMPLING_HOURLY_USD_CAP.toFixed(2)}/hr; 0 disables sampling for this app
                </span>
                <span class="flex-1" />
                <Show when={capFor() !== undefined}>
                  <Button
                    variant="ghost"
                    size="small"
                    onClick={() => settings.setSamplingHourlyUsdCap(server, undefined)}
                    title="Reset this server's sampling cap to the default"
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
