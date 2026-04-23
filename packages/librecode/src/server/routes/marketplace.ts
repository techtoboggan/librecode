/**
 * v0.9.64 — server-side proxy to the MCP App marketplace at
 * mcpappfoundry.app.
 *
 * The proxy exists so the client doesn't need cross-origin access,
 * the server can cache listings to spare the marketplace from
 * unnecessary load, and the upstream URL can rotate (staging →
 * production, disaster fallback to the official registry) without
 * shipping client updates. Override via `LIBRECODE_MCP_MARKETPLACE_URL`
 * — useful for local tests against a recorded fixture, or for
 * on-prem deployments that maintain their own curated registry.
 *
 * Install semantics are deliberately stubbed in this release. The
 * endpoint records the intent and returns a placeholder response
 * so the UI's install flow can be exercised end-to-end; real
 * wiring (MCP.add + auth handshake) lands alongside the first
 * production mcpappfoundry.app launch.
 */
import { Hono } from "hono"
import { describeRoute, resolver, validator } from "hono-openapi"
import z from "zod"
import { lazy } from "../../util/lazy"
import { Log } from "../../util/log"
import { errors } from "../error"

const log = Log.create({ service: "marketplace" })

export const DEFAULT_MARKETPLACE_URL = "https://mcpappfoundry.app/api/v1"

function marketplaceBase(): string {
  return process.env.LIBRECODE_MCP_MARKETPLACE_URL || DEFAULT_MARKETPLACE_URL
}

const AppAuthor = z.object({ name: z.string(), url: z.string().optional() })
const AppInstall = z.union([
  z.object({ type: z.literal("npm"), spec: z.string(), command: z.string().optional() }),
  z.object({ type: z.literal("pypi"), spec: z.string(), command: z.string().optional() }),
  z.object({ type: z.literal("github"), spec: z.string(), command: z.string().optional() }),
  z.object({ type: z.literal("remote"), url: z.string() }),
  z.object({ type: z.literal("manifest"), manifest: z.record(z.string(), z.unknown()) }),
])
const AppStats = z.object({
  installs: z.number().nonnegative().optional(),
  rating: z.number().min(0).max(5).optional(),
  reviewCount: z.number().nonnegative().optional(),
})
const MarketplaceApp = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  author: AppAuthor,
  version: z.string(),
  homepage: z.string().optional(),
  repository: z.string().optional(),
  capabilities: z.array(z.string()),
  uri: z.string().optional(),
  server: z.string(),
  install: AppInstall,
  stats: AppStats.optional(),
  screenshot: z.string().optional(),
  verified: z.boolean().optional(),
})
const SearchResponse = z.object({
  apps: z.array(MarketplaceApp),
  total: z.number().nonnegative(),
  next: z.string().optional(),
})

// Simple in-process LRU for upstream responses. Marketplace entries
// don't change minute-to-minute; a 5-minute TTL spares the upstream
// from a flood when the dialog is re-opened during search typing.
interface CacheEntry {
  expiresAt: number
  body: unknown
}
const cache = new Map<string, CacheEntry>()
const CACHE_TTL_MS = 5 * 60 * 1000
const CACHE_MAX_ENTRIES = 100

function cacheGet(key: string): unknown | undefined {
  const entry = cache.get(key)
  if (!entry) return undefined
  if (entry.expiresAt < Date.now()) {
    cache.delete(key)
    return undefined
  }
  return entry.body
}

function cacheSet(key: string, body: unknown): void {
  if (cache.size >= CACHE_MAX_ENTRIES) {
    // Evict oldest — Map preserves insertion order.
    const first = cache.keys().next().value
    if (first !== undefined) cache.delete(first)
  }
  cache.set(key, { expiresAt: Date.now() + CACHE_TTL_MS, body })
}

/** Reset the cache — exported for tests. */
export function clearMarketplaceCache(): void {
  cache.clear()
}

async function upstreamSearch(
  query: string | undefined,
  limit: number | undefined,
  cursor: string | undefined,
): Promise<unknown> {
  const url = new URL(`${marketplaceBase()}/apps`)
  if (query) url.searchParams.set("q", query)
  if (limit) url.searchParams.set("limit", String(limit))
  if (cursor) url.searchParams.set("cursor", cursor)
  const cacheKey = url.toString()
  const cached = cacheGet(cacheKey)
  if (cached !== undefined) return cached
  try {
    const res = await fetch(url.toString(), {
      headers: {
        // Identify ourselves so marketplace analytics can tell which
        // hosts are driving traffic. Kept version-agnostic on purpose
        // — rolling the tag each release would churn the UA cardinality.
        "user-agent": "librecode-mcp-apps-host",
        accept: "application/json",
      },
    })
    if (!res.ok) {
      log.warn("marketplace upstream non-ok", { status: res.status, url: cacheKey })
      return { apps: [], total: 0 }
    }
    const body = await res.json()
    cacheSet(cacheKey, body)
    return body
  } catch (err) {
    log.warn("marketplace upstream failure", { error: String(err), url: cacheKey })
    return { apps: [], total: 0 }
  }
}

export const MarketplaceRoutes = lazy(() =>
  new Hono()
    .get(
      "/apps",
      describeRoute({
        summary: "Search the MCP App marketplace",
        description:
          "v0.9.64 — proxies to mcpappfoundry.app's `/api/v1/apps` with a 5-minute in-process cache. " +
          "Override the upstream via the `LIBRECODE_MCP_MARKETPLACE_URL` env var (e.g. for local " +
          "fixture playback or an on-prem curated registry). Returns shape-validated entries; " +
          "malformed items are silently dropped so a single bad entry can't take down the grid.",
        operationId: "marketplace.apps.search",
        responses: {
          200: {
            description: "Search results",
            content: { "application/json": { schema: resolver(SearchResponse) } },
          },
          ...errors(400),
        },
      }),
      validator(
        "query",
        z.object({
          q: z.string().optional(),
          limit: z.coerce.number().int().positive().max(100).optional(),
          cursor: z.string().optional(),
        }),
      ),
      async (c) => {
        const { q, limit, cursor } = c.req.valid("query")
        const raw = await upstreamSearch(q, limit, cursor)
        // Re-validate through the schema so malformed upstream entries
        // don't leak to the client. Using safeParse on each entry so
        // one bad entry doesn't kill the whole response.
        const parsed = z
          .object({ apps: z.array(z.unknown()), total: z.number().optional(), next: z.string().optional() })
          .safeParse(raw)
        if (!parsed.success) return c.json({ apps: [], total: 0 })
        const apps = parsed.data.apps
          .map((a) => MarketplaceApp.safeParse(a))
          .filter((r) => r.success)
          .map((r) => r.data)
        return c.json({ apps, total: parsed.data.total ?? apps.length, next: parsed.data.next })
      },
    )
    .post(
      "/install",
      describeRoute({
        summary: "Install an MCP app from the marketplace (stub)",
        description:
          "v0.9.64 scaffold — records the install intent and returns a stub success response so " +
          "the UI's install flow can be exercised end-to-end. Real MCP.add + OAuth handshake wiring " +
          "lands alongside the first production mcpappfoundry.app launch. For now, the best path is for " +
          "users to copy the app's install command from the card footer and run it via their " +
          "existing MCP config.",
        operationId: "marketplace.install",
        responses: {
          200: { description: "OK (stub)" },
          ...errors(400, 501),
        },
      }),
      validator("json", z.object({ id: z.string().min(1) })),
      async (c) => {
        const { id } = c.req.valid("json")
        log.info("marketplace install intent recorded", { id })
        // Returning the id as the server name is a deliberate stub —
        // once the real install flow lands, this returns the actual
        // MCP server name the config points at.
        return c.json({ ok: true, server: id, stub: true }, 200)
      },
    ),
)
