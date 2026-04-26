/**
 * v0.9.74 — Agentic Control Panel API client + pure formatters.
 *
 * The four list endpoints (`/control-panel/{agents,skills,plugins,tools}`)
 * each return a small typed payload the dialog renders directly. The
 * import flow has its own POST + DELETE endpoints; we use a tiny
 * fetch wrapper that swallows network failures into structured
 * results so the dialog can show a friendly empty state instead of
 * crashing the whole settings panel.
 */

export interface AgentEntry {
  name: string
  description?: string
  mode: "subagent" | "primary" | "all"
  native: boolean
  hidden: boolean
  model?: { providerID: string; modelID: string }
  hasPrompt: boolean
  promptPreview?: string
}

export interface SkillEntry {
  name: string
  description: string
  location: string
  preview: string
}

export interface PluginEntry {
  index: number
  hooks: string[]
}

export interface ToolEntry {
  id: string
  description: string
}

export interface ImportSourceEntry {
  id: string
  name: string
  repo: string
  description: string
  license: string
  author: string
  homepage: string
  contents: { skills?: string; agents?: string }
}

export interface ImportRunResult {
  ok: true
  source: { id: string; name: string; repo: string }
  imported: { skills: Array<{ name: string; path: string }>; agents: Array<{ name: string; path: string }> }
}

export interface ImportRunError {
  ok: false
  error: string
  step?: "lookup" | "clone" | "copy"
}

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

async function getJson<T>(fetchFn: FetchLike, baseUrl: string, path: string, fallback: T): Promise<T> {
  try {
    const res = await fetchFn(`${baseUrl}${path}`)
    if (!res.ok) return fallback
    return (await res.json()) as T
  } catch {
    return fallback
  }
}

export async function fetchAgents(fetchFn: FetchLike, baseUrl: string): Promise<AgentEntry[]> {
  const body = await getJson<{ agents?: AgentEntry[] }>(fetchFn, baseUrl, "/control-panel/agents", { agents: [] })
  return body.agents ?? []
}

export async function fetchSkills(fetchFn: FetchLike, baseUrl: string): Promise<SkillEntry[]> {
  const body = await getJson<{ skills?: SkillEntry[] }>(fetchFn, baseUrl, "/control-panel/skills", { skills: [] })
  return body.skills ?? []
}

export async function fetchPlugins(fetchFn: FetchLike, baseUrl: string): Promise<PluginEntry[]> {
  const body = await getJson<{ plugins?: PluginEntry[] }>(fetchFn, baseUrl, "/control-panel/plugins", { plugins: [] })
  return body.plugins ?? []
}

export async function fetchTools(fetchFn: FetchLike, baseUrl: string): Promise<ToolEntry[]> {
  const body = await getJson<{ tools?: ToolEntry[] }>(fetchFn, baseUrl, "/control-panel/tools", { tools: [] })
  return body.tools ?? []
}

export async function fetchImportSources(fetchFn: FetchLike, baseUrl: string): Promise<ImportSourceEntry[]> {
  const body = await getJson<{ sources?: ImportSourceEntry[] }>(fetchFn, baseUrl, "/control-panel/import-sources", {
    sources: [],
  })
  return body.sources ?? []
}

export async function runImport(
  fetchFn: FetchLike,
  baseUrl: string,
  id: string,
): Promise<ImportRunResult | ImportRunError> {
  try {
    const res = await fetchFn(`${baseUrl}/control-panel/import`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id }),
    })
    // The endpoint returns either ImportRunResult or ImportRunError
    // depending on success — model both as separate optional shapes so
    // we can read the failure-side fields without TS narrowing them
    // away on a successful response.
    const body = (await res.json().catch(() => ({}))) as {
      ok?: boolean
      error?: string
      step?: ImportRunError["step"]
      source?: ImportRunResult["source"]
      imported?: ImportRunResult["imported"]
    }
    if (!res.ok || body.ok === false) {
      return {
        ok: false,
        error: body.error ?? `Import failed (HTTP ${res.status})`,
        step: body.step,
      }
    }
    return body as unknown as ImportRunResult
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

export async function removeImport(fetchFn: FetchLike, baseUrl: string, id: string): Promise<boolean> {
  try {
    const res = await fetchFn(`${baseUrl}/control-panel/import`, {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id }),
    })
    if (!res.ok) return false
    const body = (await res.json()) as { removed?: boolean }
    return Boolean(body.removed)
  } catch {
    return false
  }
}

// ─── Pure formatters used by the dialog ──────────────────────────────────────

/** Compact a discovered skill location into a short, human-scannable label. */
export function formatSkillLocation(location: string): string {
  // Trim noise prefixes so the user sees `imported/superpowers/brainstorming/SKILL.md`
  // instead of `/home/<user>/.config/librecode/skills/imported/...`.
  const markers = ["/skills/", "/.claude/skills/", "/.agents/skills/"]
  for (const marker of markers) {
    const idx = location.indexOf(marker)
    if (idx >= 0) return location.slice(idx + 1)
  }
  return location
}

/** Pluralise the count summary shown in the import-result toast. */
export function summariseImport(result: ImportRunResult): string {
  const s = result.imported.skills.length
  const a = result.imported.agents.length
  const parts: string[] = []
  if (s > 0) parts.push(`${s} skill${s === 1 ? "" : "s"}`)
  if (a > 0) parts.push(`${a} agent${a === 1 ? "" : "s"}`)
  if (parts.length === 0) return `Nothing imported from ${result.source.name} (source had no matching files)`
  return `Imported ${parts.join(" + ")} from ${result.source.name}`
}

/**
 * Group + sort agents for display. Native (built-in) agents first,
 * then file/config-defined ones, with hidden agents excluded — they
 * exist but aren't user-facing (compaction, title, summary helpers).
 */
export function groupAgents(agents: AgentEntry[]): { native: AgentEntry[]; user: AgentEntry[] } {
  const native: AgentEntry[] = []
  const user: AgentEntry[] = []
  for (const a of agents) {
    if (a.hidden) continue
    if (a.native) native.push(a)
    else user.push(a)
  }
  const cmp = (a: AgentEntry, b: AgentEntry) => a.name.localeCompare(b.name)
  return { native: native.sort(cmp), user: user.sort(cmp) }
}
