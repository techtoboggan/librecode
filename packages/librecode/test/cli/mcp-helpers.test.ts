/**
 * v0.9.73 — non-interactive CLI path tests for `librecode mcp`.
 *
 * The tests exercise the pure builders (flag → Config.Mcp) and the
 * atomic config writers (`addMcpToConfig`, `removeMcpFromConfig`,
 * `setMcpEnabled`) against a real temp JSONC file. Both round-trip
 * jsonc-parser-preserved comments, so we assert the comments survive
 * writes — that's the whole point of using jsonc-parser over a plain
 * stringify.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { promises as fs } from "node:fs"
import os from "node:os"
import path from "node:path"
import { buildLocalConfig, buildRemoteConfig } from "../../src/cli/cmd/mcp"
import { addMcpToConfig, removeMcpFromConfig, setMcpEnabled } from "../../src/cli/cmd/mcp/helpers"

let tmp: string
let configPath: string

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "librecode-mcp-test-"))
  configPath = path.join(tmp, "librecode.jsonc")
})

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true })
})

async function writeSeed(text: string): Promise<void> {
  await fs.writeFile(configPath, text, "utf8")
}

async function readText(): Promise<string> {
  return await fs.readFile(configPath, "utf8")
}

describe("buildLocalConfig", () => {
  test("splits command on whitespace so --local 'a b c' produces ['a','b','c']", () => {
    const cfg = buildLocalConfig("bun x @acme/mcp")
    expect(cfg).toEqual({ type: "local", command: ["bun", "x", "@acme/mcp"] })
  })

  test("single command with no args is preserved as a 1-element array", () => {
    expect(buildLocalConfig("/usr/local/bin/openwebgoggles")).toEqual({
      type: "local",
      command: ["/usr/local/bin/openwebgoggles"],
    })
  })

  test("collapses multiple spaces without producing empty entries", () => {
    expect(buildLocalConfig("  bun    x   @acme/mcp  ")).toEqual({
      type: "local",
      command: ["bun", "x", "@acme/mcp"],
    })
  })

  test("throws on an empty command (caller passed --local '')", () => {
    expect(() => buildLocalConfig("")).toThrow(/empty/i)
    expect(() => buildLocalConfig("   ")).toThrow(/empty/i)
  })

  test("disabled=true adds enabled:false to the config", () => {
    const cfg = buildLocalConfig("bun x @acme/mcp", true)
    expect((cfg as { enabled?: boolean }).enabled).toBe(false)
  })
})

describe("buildRemoteConfig", () => {
  test("bare remote with just a URL", () => {
    expect(buildRemoteConfig("https://mcp.example.com", {})).toEqual({
      type: "remote",
      url: "https://mcp.example.com",
    })
  })

  test("rejects a malformed URL so typos don't land in config", () => {
    expect(() => buildRemoteConfig("not a url", {})).toThrow(/valid URL/i)
  })

  test("parses --header KEY=VALUE into a headers object, repeatable", () => {
    const cfg = buildRemoteConfig("https://mcp.example.com", {
      headers: ["Authorization=Bearer xyz", "X-Trace=1"],
    })
    expect(cfg).toEqual({
      type: "remote",
      url: "https://mcp.example.com",
      headers: { Authorization: "Bearer xyz", "X-Trace": "1" },
    })
  })

  test("header without '=' is rejected", () => {
    expect(() => buildRemoteConfig("https://mcp.example.com", { headers: ["oops"] })).toThrow(/KEY=VALUE/i)
  })

  test("header with empty key is rejected (idx=0 means no key)", () => {
    expect(() => buildRemoteConfig("https://mcp.example.com", { headers: ["=value"] })).toThrow(/KEY=VALUE/i)
  })

  test("--oauth + credentials produce an oauth block", () => {
    const cfg = buildRemoteConfig("https://mcp.example.com", {
      oauth: true,
      clientId: "id-123",
      clientSecret: "secret-xyz",
    })
    expect(cfg).toEqual({
      type: "remote",
      url: "https://mcp.example.com",
      oauth: { clientId: "id-123", clientSecret: "secret-xyz" },
    })
  })

  test("--oauth without creds produces an empty oauth object (signals dynamic registration)", () => {
    expect(buildRemoteConfig("https://mcp.example.com", { oauth: true })).toEqual({
      type: "remote",
      url: "https://mcp.example.com",
      oauth: {},
    })
  })

  test("disabled=true sets enabled:false", () => {
    const cfg = buildRemoteConfig("https://mcp.example.com", { disabled: true })
    expect((cfg as { enabled?: boolean }).enabled).toBe(false)
  })
})

describe("addMcpToConfig", () => {
  test("creates the mcp block when the config has none yet", async () => {
    await writeSeed("{}\n")
    await addMcpToConfig("foo", { type: "local", command: ["bar"] }, configPath)
    const text = await readText()
    const parsed = JSON.parse(text)
    expect(parsed.mcp.foo).toEqual({ type: "local", command: ["bar"] })
  })

  test("preserves existing comments in the file (the whole point of jsonc-parser)", async () => {
    await writeSeed(`{
  // keep me!
  "$schema": "x",
  "provider": {
    /* and me */
    "p": {}
  }
}
`)
    await addMcpToConfig("foo", { type: "local", command: ["bar"] }, configPath)
    const text = await readText()
    expect(text).toContain("// keep me!")
    expect(text).toContain("/* and me */")
    expect(text).toContain('"foo"')
  })

  test("overwrites an existing entry with the same name", async () => {
    await writeSeed(`{"mcp": {"foo": {"type": "local", "command": ["old"]}}}`)
    await addMcpToConfig("foo", { type: "local", command: ["new"] }, configPath)
    const parsed = JSON.parse(await readText())
    expect(parsed.mcp.foo.command).toEqual(["new"])
  })

  test("creates the config file if it doesn't exist yet", async () => {
    // configPath is inside tmp but no file written — addMcpToConfig
    // should create it from empty {}.
    await addMcpToConfig("foo", { type: "local", command: ["bar"] }, configPath)
    const parsed = JSON.parse(await readText())
    expect(parsed.mcp.foo).toEqual({ type: "local", command: ["bar"] })
  })
})

describe("removeMcpFromConfig", () => {
  test("returns true + removes the entry when it exists", async () => {
    await writeSeed(`{"mcp": {"foo": {"type": "local", "command": ["bar"]}}}`)
    const removed = await removeMcpFromConfig("foo", configPath)
    expect(removed).toBe(true)
    const parsed = JSON.parse(await readText())
    expect(parsed.mcp?.foo).toBeUndefined()
  })

  test("returns false when the entry doesn't exist (idempotent)", async () => {
    await writeSeed(`{"mcp": {"other": {"type": "local", "command": ["x"]}}}`)
    expect(await removeMcpFromConfig("foo", configPath)).toBe(false)
  })

  test("returns false when the config file doesn't exist at all", async () => {
    expect(await removeMcpFromConfig("foo", configPath)).toBe(false)
  })

  test("leaves sibling entries intact", async () => {
    await writeSeed(`{"mcp": {"foo": {"type": "local", "command": ["1"]}, "bar": {"type": "local", "command": ["2"]}}}`)
    await removeMcpFromConfig("foo", configPath)
    const parsed = JSON.parse(await readText())
    expect(parsed.mcp.foo).toBeUndefined()
    expect(parsed.mcp.bar).toEqual({ type: "local", command: ["2"] })
  })
})

describe("setMcpEnabled", () => {
  test("toggles enabled=false on an existing entry", async () => {
    await writeSeed(`{"mcp": {"foo": {"type": "local", "command": ["bar"]}}}`)
    await setMcpEnabled("foo", false, configPath)
    const parsed = JSON.parse(await readText())
    expect(parsed.mcp.foo.enabled).toBe(false)
  })

  test("toggles enabled=true to re-enable a disabled entry", async () => {
    await writeSeed(`{"mcp": {"foo": {"type": "local", "command": ["bar"], "enabled": false}}}`)
    await setMcpEnabled("foo", true, configPath)
    const parsed = JSON.parse(await readText())
    expect(parsed.mcp.foo.enabled).toBe(true)
  })

  test("throws for an unknown server — enable/disable assumes the entry exists", async () => {
    await writeSeed(`{"mcp": {"other": {"type": "local", "command": ["x"]}}}`)
    await expect(setMcpEnabled("nope", false, configPath)).rejects.toThrow(/not found/i)
  })

  test("throws for a missing config file — can't toggle what isn't there", async () => {
    await expect(setMcpEnabled("foo", true, configPath)).rejects.toThrow(/not found/i)
  })
})
