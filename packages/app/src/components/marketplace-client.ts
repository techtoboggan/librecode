/**
 * v0.9.64 — client helpers for the LibreCode MCP App marketplace
 * at mcpapps.vip.
 *
 * The client hits a LibreCode-local proxy at `/marketplace/*` rather
 * than mcpapps.vip directly — the server adds caching, swallows
 * CORS, and can fall back to the official MCP registry if the
 * curated marketplace is unreachable. Base URL is env-configurable
 * via `MCPAPPS_REGISTRY_URL` server-side so we can point staging
 * builds at a preview domain.
 *
 * All network responses are shape-validated here rather than at the
 * fetch boundary so a stale/compromised marketplace can't spray
 * bad data into the dialog render tree.
 */

/** Shape of a single marketplace entry returned by `/marketplace/apps`. */
export interface MarketplaceApp {
  id: string
  name: string
  description: string
  author: { name: string; url?: string }
  version: string
  /** Human-readable homepage URL — may be the author's site or a product page. */
  homepage?: string
  repository?: string
  /** Capabilities the app advertises, e.g. "mcp-apps", "tools", "sampling". */
  capabilities: string[]
  /** UI resource URI the app surfaces (if it's a UI-capable server). */
  uri?: string
  /** MCP server name this app is served from. Hosts use this as the connection identifier. */
  server: string
  /** Install manifest the host uses to wire up the MCP server. */
  install: MarketplaceInstall
  /** Aggregate stats shown on the card — optional, marketplaces may omit. */
  stats?: {
    installs?: number
    rating?: number
    reviewCount?: number
  }
  /** Relative or absolute URL of a screenshot / tile image. */
  screenshot?: string
  /** Marketplace-verified authorship signal (curator has reviewed the code). */
  verified?: boolean
}

export type MarketplaceInstall =
  | { type: "npm"; spec: string; command?: string }
  | { type: "pypi"; spec: string; command?: string }
  | { type: "github"; spec: string; command?: string }
  | { type: "remote"; url: string }
  | { type: "manifest"; manifest: Record<string, unknown> }

export interface MarketplaceSearchResult {
  apps: MarketplaceApp[]
  total: number
  /** Cursor for the next page, or undefined when this is the last page. */
  next?: string
}

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

/**
 * Validate a raw JSON value as a MarketplaceApp. Returns `undefined`
 * for malformed entries so the caller can filter them out without
 * blowing up the whole result set — a single bad entry shouldn't
 * take down the grid.
 */
export function parseMarketplaceApp(value: unknown): MarketplaceApp | undefined {
  if (!value || typeof value !== "object") return undefined
  const v = value as Record<string, unknown>
  if (typeof v.id !== "string" || !v.id) return undefined
  if (typeof v.name !== "string" || !v.name) return undefined
  if (typeof v.server !== "string" || !v.server) return undefined
  if (typeof v.description !== "string") return undefined
  if (typeof v.version !== "string") return undefined
  const author = parseAuthor(v.author)
  if (!author) return undefined
  const install = parseInstall(v.install)
  if (!install) return undefined
  const capabilities = Array.isArray(v.capabilities)
    ? v.capabilities.filter((c): c is string => typeof c === "string")
    : []
  return {
    id: v.id,
    name: v.name,
    description: v.description,
    author,
    version: v.version,
    homepage: typeof v.homepage === "string" ? v.homepage : undefined,
    repository: typeof v.repository === "string" ? v.repository : undefined,
    capabilities,
    uri: typeof v.uri === "string" ? v.uri : undefined,
    server: v.server,
    install,
    stats: parseStats(v.stats),
    screenshot: typeof v.screenshot === "string" ? v.screenshot : undefined,
    verified: v.verified === true,
  }
}

function parseAuthor(value: unknown): MarketplaceApp["author"] | undefined {
  if (!value || typeof value !== "object") return undefined
  const v = value as Record<string, unknown>
  if (typeof v.name !== "string" || !v.name) return undefined
  return { name: v.name, url: typeof v.url === "string" ? v.url : undefined }
}

function parseInstall(value: unknown): MarketplaceInstall | undefined {
  if (!value || typeof value !== "object") return undefined
  const v = value as Record<string, unknown>
  const t = v.type
  if (t === "npm" || t === "pypi" || t === "github") {
    if (typeof v.spec !== "string" || !v.spec) return undefined
    return { type: t, spec: v.spec, command: typeof v.command === "string" ? v.command : undefined }
  }
  if (t === "remote") {
    if (typeof v.url !== "string" || !v.url) return undefined
    return { type: "remote", url: v.url }
  }
  if (t === "manifest") {
    if (!v.manifest || typeof v.manifest !== "object") return undefined
    return { type: "manifest", manifest: v.manifest as Record<string, unknown> }
  }
  return undefined
}

function parseStats(value: unknown): MarketplaceApp["stats"] {
  if (!value || typeof value !== "object") return undefined
  const v = value as Record<string, unknown>
  const out: NonNullable<MarketplaceApp["stats"]> = {}
  if (typeof v.installs === "number" && v.installs >= 0) out.installs = v.installs
  if (typeof v.rating === "number" && v.rating >= 0 && v.rating <= 5) out.rating = v.rating
  if (typeof v.reviewCount === "number" && v.reviewCount >= 0) out.reviewCount = v.reviewCount
  return Object.keys(out).length === 0 ? undefined : out
}

/**
 * Pure: compact an install manifest into a human-readable one-liner
 * for the card footer ("npm: @acme/weather", "github: acme/weather-mcp").
 */
export function describeInstall(install: MarketplaceInstall): string {
  switch (install.type) {
    case "npm":
      return `npm · ${install.spec}`
    case "pypi":
      return `pypi · ${install.spec}`
    case "github":
      return `github · ${install.spec}`
    case "remote":
      return `remote · ${install.url}`
    case "manifest":
      return "manifest"
  }
}

/** Format a install count for the footer: 1.2k, 12k, 1.2M, … */
export function formatInstalls(n: number | undefined): string | undefined {
  if (!n || n <= 0) return undefined
  if (n < 1000) return `${n}`
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`
  return `${(n / 1_000_000).toFixed(n < 10_000_000 ? 1 : 0)}M`
}

/**
 * Search the marketplace. `query` empty = "list popular/featured".
 * Returns an empty result on network failure so the dialog can show
 * a friendly empty state — never throws.
 */
export async function searchMarketplace(
  fetchFn: FetchLike,
  baseUrl: string,
  query: string,
  options: { limit?: number; cursor?: string } = {},
): Promise<MarketplaceSearchResult> {
  const url = new URL(`${baseUrl}/marketplace/apps`)
  if (query) url.searchParams.set("q", query)
  if (options.limit) url.searchParams.set("limit", String(options.limit))
  if (options.cursor) url.searchParams.set("cursor", options.cursor)
  try {
    const res = await fetchFn(url.toString())
    if (!res.ok) return { apps: [], total: 0 }
    const body = (await res.json()) as { apps?: unknown[]; total?: number; next?: string }
    const apps: MarketplaceApp[] = []
    for (const raw of body.apps ?? []) {
      const parsed = parseMarketplaceApp(raw)
      if (parsed) apps.push(parsed)
    }
    return {
      apps,
      total: typeof body.total === "number" && body.total >= 0 ? body.total : apps.length,
      next: typeof body.next === "string" ? body.next : undefined,
    }
  } catch {
    return { apps: [], total: 0 }
  }
}

/**
 * Pin an installed app to the user's Start menu. The server endpoint
 * returns the install manifest actually wired up (MCP server config,
 * pinned entries); the caller is responsible for refreshing any local
 * app-list resources afterwards.
 *
 * v0.9.64 scaffold — actual install wiring lives server-side behind
 * `POST /marketplace/install`. The stub implementation stores the
 * intent and returns a success response; real MCP-add flow wires up
 * in the follow-up that lands alongside the first production mcpapps.vip
 * launch.
 */
export async function installFromMarketplace(
  fetchFn: FetchLike,
  baseUrl: string,
  appID: string,
): Promise<{ ok: true; server: string; uri?: string } | { ok: false; error: string }> {
  try {
    const res = await fetchFn(`${baseUrl}/marketplace/install`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: appID }),
    })
    if (!res.ok) {
      const error = await res.text().catch(() => `HTTP ${res.status}`)
      return { ok: false, error }
    }
    const body = (await res.json()) as { ok?: boolean; server?: string; uri?: string; error?: string }
    if (!body.ok || typeof body.server !== "string") {
      return { ok: false, error: body.error ?? "Marketplace install returned no server identifier" }
    }
    return { ok: true, server: body.server, uri: typeof body.uri === "string" ? body.uri : undefined }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}
