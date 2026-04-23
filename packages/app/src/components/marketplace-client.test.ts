/**
 * v0.9.64 — tests for the MCP App marketplace client.
 *
 * The network boundary is exercised with a fake `fetchFn` rather
 * than a full mock server — the client is shape-validation heavy
 * (parseMarketplaceApp does most of the work) so unit tests get
 * the best coverage per line of test code.
 */
import { describe, expect, test } from "bun:test"
import {
  describeInstall,
  formatInstalls,
  installFromMarketplace,
  type MarketplaceApp,
  type MarketplaceInstall,
  parseMarketplaceApp,
  searchMarketplace,
} from "./marketplace-client"

const goodApp = {
  id: "acme-weather",
  name: "Weather",
  description: "Show the forecast as a ui:// resource.",
  author: { name: "Acme Labs", url: "https://acme.example" },
  version: "1.0.0",
  homepage: "https://acme.example/weather",
  capabilities: ["mcp-apps", "tools"],
  uri: "ui://acme/weather",
  server: "acme-weather",
  install: { type: "npm", spec: "@acme/weather-mcp", command: "npx @acme/weather-mcp" },
  stats: { installs: 12500, rating: 4.7, reviewCount: 42 },
  verified: true,
}

describe("parseMarketplaceApp", () => {
  test("accepts a canonical entry with every optional field populated", () => {
    const parsed = parseMarketplaceApp(goodApp)
    expect(parsed).toBeDefined()
    expect(parsed?.id).toBe("acme-weather")
    expect(parsed?.author.url).toBe("https://acme.example")
    expect(parsed?.stats?.installs).toBe(12500)
    expect(parsed?.verified).toBe(true)
  })

  test("rejects entries missing required scalars", () => {
    expect(parseMarketplaceApp({ ...goodApp, id: "" })).toBeUndefined()
    expect(parseMarketplaceApp({ ...goodApp, name: 42 })).toBeUndefined()
    expect(parseMarketplaceApp({ ...goodApp, description: null })).toBeUndefined()
    expect(parseMarketplaceApp({ ...goodApp, server: undefined })).toBeUndefined()
    expect(parseMarketplaceApp({ ...goodApp, version: 1 })).toBeUndefined()
  })

  test("rejects entries with a malformed author block", () => {
    expect(parseMarketplaceApp({ ...goodApp, author: "Acme" })).toBeUndefined()
    expect(parseMarketplaceApp({ ...goodApp, author: { name: "" } })).toBeUndefined()
  })

  test("rejects entries with a malformed install block", () => {
    expect(parseMarketplaceApp({ ...goodApp, install: { type: "npm" } })).toBeUndefined()
    expect(parseMarketplaceApp({ ...goodApp, install: { type: "remote" } })).toBeUndefined()
    expect(parseMarketplaceApp({ ...goodApp, install: { type: "unknown", spec: "x" } })).toBeUndefined()
  })

  test("accepts each install-manifest shape", () => {
    for (const install of [
      { type: "npm" as const, spec: "@acme/x" },
      { type: "pypi" as const, spec: "acme-x" },
      { type: "github" as const, spec: "acme/x" },
      { type: "remote" as const, url: "https://acme.example/mcp" },
      { type: "manifest" as const, manifest: { command: ["npx", "acme"] } },
    ]) {
      expect(parseMarketplaceApp({ ...goodApp, install })?.install).toEqual(install as MarketplaceInstall)
    }
  })

  test("drops malformed capabilities but keeps the rest", () => {
    const parsed = parseMarketplaceApp({ ...goodApp, capabilities: ["mcp-apps", 42, "tools"] })
    expect(parsed?.capabilities).toEqual(["mcp-apps", "tools"])
  })

  test("clamps stats to sensible ranges — 10-star ratings are dropped", () => {
    const parsed = parseMarketplaceApp({ ...goodApp, stats: { installs: -5, rating: 10, reviewCount: 3 } })
    expect(parsed?.stats?.installs).toBeUndefined()
    expect(parsed?.stats?.rating).toBeUndefined()
    expect(parsed?.stats?.reviewCount).toBe(3)
  })

  test("returns undefined for non-object input (defensive against garbage)", () => {
    expect(parseMarketplaceApp(null)).toBeUndefined()
    expect(parseMarketplaceApp(undefined)).toBeUndefined()
    expect(parseMarketplaceApp("string")).toBeUndefined()
    expect(parseMarketplaceApp(42)).toBeUndefined()
    expect(parseMarketplaceApp([])).toBeUndefined()
  })
})

describe("describeInstall", () => {
  test("compacts each install type into a prefixed one-liner", () => {
    expect(describeInstall({ type: "npm", spec: "@acme/x" })).toBe("npm · @acme/x")
    expect(describeInstall({ type: "pypi", spec: "acme-x" })).toBe("pypi · acme-x")
    expect(describeInstall({ type: "github", spec: "acme/x" })).toBe("github · acme/x")
    expect(describeInstall({ type: "remote", url: "https://x.example" })).toBe("remote · https://x.example")
    expect(describeInstall({ type: "manifest", manifest: {} })).toBe("manifest")
  })
})

describe("formatInstalls", () => {
  test("suppresses zero and undefined", () => {
    expect(formatInstalls(undefined)).toBeUndefined()
    expect(formatInstalls(0)).toBeUndefined()
    expect(formatInstalls(-5)).toBeUndefined()
  })

  test("raw count under 1000", () => {
    expect(formatInstalls(1)).toBe("1")
    expect(formatInstalls(999)).toBe("999")
  })

  test("k-scale — one decimal under 10k, rounded over", () => {
    expect(formatInstalls(1200)).toBe("1.2k")
    expect(formatInstalls(12500)).toBe("13k")
  })

  test("M-scale — one decimal under 10M, rounded over", () => {
    expect(formatInstalls(2_400_000)).toBe("2.4M")
    expect(formatInstalls(15_000_000)).toBe("15M")
  })
})

describe("searchMarketplace", () => {
  test("returns parsed apps on 200", async () => {
    const fetchFn = async (_input: RequestInfo | URL) =>
      new Response(JSON.stringify({ apps: [goodApp], total: 1 }), { status: 200 })
    const res = await searchMarketplace(fetchFn, "http://host.example", "weather")
    expect(res.apps.length).toBe(1)
    expect(res.total).toBe(1)
    expect(res.apps[0].id).toBe("acme-weather")
  })

  test("filters out malformed entries without rejecting the page", async () => {
    const fetchFn = async () =>
      new Response(JSON.stringify({ apps: [goodApp, { id: "", name: "bad" }, null], total: 3 }), { status: 200 })
    const res = await searchMarketplace(fetchFn, "http://host.example", "")
    expect(res.apps.length).toBe(1)
    expect(res.total).toBe(3)
  })

  test("returns empty on non-ok status — never throws", async () => {
    const fetchFn = async () => new Response("oops", { status: 500 })
    const res = await searchMarketplace(fetchFn, "http://host.example", "")
    expect(res.apps).toEqual([])
    expect(res.total).toBe(0)
  })

  test("returns empty on network failure", async () => {
    const fetchFn = async () => {
      throw new Error("ECONNREFUSED")
    }
    const res = await searchMarketplace(fetchFn, "http://host.example", "")
    expect(res.apps).toEqual([])
  })

  test("passes query, limit, and cursor through the URL", async () => {
    let captured: string | undefined
    const fetchFn = async (input: RequestInfo | URL) => {
      captured = input.toString()
      return new Response(JSON.stringify({ apps: [], total: 0 }), { status: 200 })
    }
    await searchMarketplace(fetchFn, "http://host.example", "graph", { limit: 12, cursor: "abc" })
    expect(captured).toContain("q=graph")
    expect(captured).toContain("limit=12")
    expect(captured).toContain("cursor=abc")
  })
})

describe("installFromMarketplace", () => {
  test("POSTs the app id and unwraps the success response", async () => {
    let method = ""
    let body: string | undefined
    const fetchFn = async (_input: RequestInfo | URL, init?: RequestInit) => {
      method = init?.method ?? ""
      body = typeof init?.body === "string" ? init.body : undefined
      return new Response(JSON.stringify({ ok: true, server: "acme-weather" }), { status: 200 })
    }
    const res = await installFromMarketplace(fetchFn, "http://host.example", "acme-weather")
    expect(method).toBe("POST")
    expect(body).toContain("acme-weather")
    expect(res.ok).toBe(true)
    if (res.ok) expect(res.server).toBe("acme-weather")
  })

  test("reports a server-side error via the ok:false branch", async () => {
    const fetchFn = async () => new Response(JSON.stringify({ ok: false, error: "not found" }), { status: 200 })
    const res = await installFromMarketplace(fetchFn, "http://host.example", "nope")
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toBe("not found")
  })

  test("wraps a transport failure", async () => {
    const fetchFn = async () => {
      throw new Error("offline")
    }
    const res = await installFromMarketplace(fetchFn, "http://host.example", "x")
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toContain("offline")
  })
})

// Sanity check: the exported type is reachable so the tests won't
// drift from the type definition if someone renames the interface.
const _assignable: MarketplaceApp = parseMarketplaceApp(goodApp) as MarketplaceApp
void _assignable
