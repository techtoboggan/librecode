/**
 * v0.9.63 — per-app persistent state store. Covers the key
 * sanitisation, round-trip load-after-save, atomicity via .tmp rename,
 * size cap, and the `undefined` clear-path.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { promises as fs } from "node:fs"
import os from "node:os"
import path from "node:path"
import { clearState, loadState, MAX_STATE_BYTES, saveState, stateKey, stateRoot } from "../../src/mcp/app-state"

let tmp: string
const envBackup = { ...process.env }

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "librecode-app-state-test-"))
  process.env.LIBRECODE_MCP_APPS_STATE_DIR = tmp
})

afterEach(async () => {
  process.env = { ...envBackup }
  await fs.rm(tmp, { recursive: true, force: true })
})

describe("stateKey", () => {
  test("slugs server names to a filesystem-safe dir", () => {
    const k = stateKey("acme/weather", "ui://acme/weather")
    expect(k.dir).toBe("acme-weather")
  })

  test("hashes the uri into a stable, short filename", () => {
    const a = stateKey("acme", "ui://acme/a")
    const b = stateKey("acme", "ui://acme/b")
    expect(a.file).not.toBe(b.file)
    expect(a.file).toMatch(/^[0-9a-f]{16}\.json$/)
    // Same input → same key
    expect(stateKey("acme", "ui://acme/a").file).toBe(a.file)
  })

  test("falls back to 'unknown' for an empty server name (the `|| 'unknown'` path)", () => {
    expect(stateKey("", "ui://x").dir).toBe("unknown")
  })

  test("special characters in server name are replaced with dashes (still inside the server's own subtree)", () => {
    expect(stateKey("***", "ui://x").dir).toBe("---")
  })
})

describe("stateRoot", () => {
  test("honours the LIBRECODE_MCP_APPS_STATE_DIR override", () => {
    process.env.LIBRECODE_MCP_APPS_STATE_DIR = "/tmp/custom"
    expect(stateRoot()).toBe("/tmp/custom")
  })

  test("defaults to ~/.local/librecode-mcp-apps when unset", () => {
    delete process.env.LIBRECODE_MCP_APPS_STATE_DIR
    expect(stateRoot()).toBe(path.join(os.homedir(), ".local", "librecode-mcp-apps"))
  })
})

describe("save + load round-trip", () => {
  test("saving then loading the same (server, uri) returns the state verbatim", async () => {
    const server = "acme"
    const uri = "ui://acme/weather"
    const state = { tokensView: "avg-rate", favorites: ["a", "b"], last: 42 }
    const saved = await saveState(server, uri, state)
    expect(saved.ok).toBe(true)
    const loaded = await loadState(server, uri)
    expect(loaded).toEqual(state)
  })

  test("loading an app that has never been saved returns undefined", async () => {
    expect(await loadState("never", "ui://never/x")).toBeUndefined()
  })

  test("two different apps have independent state", async () => {
    await saveState("a", "ui://a/x", { tag: "a" })
    await saveState("b", "ui://b/x", { tag: "b" })
    expect(await loadState("a", "ui://a/x")).toEqual({ tag: "a" })
    expect(await loadState("b", "ui://b/x")).toEqual({ tag: "b" })
  })

  test("saving again overwrites — the store isn't history-preserving", async () => {
    await saveState("acme", "ui://acme/x", { v: 1 })
    await saveState("acme", "ui://acme/x", { v: 2 })
    expect(await loadState("acme", "ui://acme/x")).toEqual({ v: 2 })
  })
})

describe("save enforcement", () => {
  test("state larger than MAX_STATE_BYTES is rejected with reason=too_large", async () => {
    const bigPayload = { data: "x".repeat(MAX_STATE_BYTES + 10) }
    const result = await saveState("acme", "ui://acme/big", bigPayload)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toBe("too_large")
      expect(result.message).toContain("cap")
    }
  })

  test("non-JSON-serialisable payloads are rejected", async () => {
    const circular: Record<string, unknown> = {}
    circular.self = circular
    const result = await saveState("acme", "ui://acme/circ", circular)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe("io_error")
  })

  test("save is atomic — no .tmp leftover on success", async () => {
    await saveState("acme", "ui://acme/x", { v: 1 })
    const serverDir = path.join(tmp, "acme")
    const files = await fs.readdir(serverDir)
    expect(files.some((f) => f.endsWith(".tmp"))).toBe(false)
    expect(files.some((f) => f.endsWith(".json"))).toBe(true)
  })
})

describe("clear", () => {
  test("clearState removes a previously-saved record and returns true", async () => {
    await saveState("acme", "ui://acme/x", { v: 1 })
    expect(await clearState("acme", "ui://acme/x")).toBe(true)
    expect(await loadState("acme", "ui://acme/x")).toBeUndefined()
  })

  test("clearState on a never-saved app returns false (no error)", async () => {
    expect(await clearState("ghost", "ui://ghost/x")).toBe(false)
  })

  test("saving `undefined` also clears", async () => {
    await saveState("acme", "ui://acme/x", { v: 1 })
    const result = await saveState("acme", "ui://acme/x", undefined)
    expect(result.ok).toBe(true)
    expect(await loadState("acme", "ui://acme/x")).toBeUndefined()
  })
})
