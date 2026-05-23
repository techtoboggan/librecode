/**
 * Phase 40.4 — corporate HTTP proxy support audit & lock-in.
 *
 * Tests the detector for all four env-var spellings. The actual
 * proxying is done by Bun's native fetch() + subprocess env
 * inheritance — those don't need our tests, but locking in the
 * detection prevents a future contributor from breaking the
 * `bun install --no-cache` workaround that depends on it.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { proxied } from "../../src/util/proxied"

const KEYS = ["HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy"] as const
const saved: Partial<Record<(typeof KEYS)[number], string | undefined>> = {}

beforeEach(() => {
  for (const k of KEYS) {
    saved[k] = process.env[k]
    delete process.env[k]
  }
})

afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
})

describe("proxied", () => {
  test("returns false when no proxy env vars are set", () => {
    expect(proxied()).toBe(false)
  })

  test.each([...KEYS])("returns true when %s is set", (key) => {
    ;(process.env as Record<string, string>)[key] = "http://proxy.corp.example:8080"
    expect(proxied()).toBe(true)
  })

  test("empty string is not 'set' enough to count (it's falsy)", () => {
    process.env.HTTP_PROXY = ""
    expect(proxied()).toBe(false)
  })

  test("any one of the four flavors flips the result — case both ways", () => {
    process.env.https_proxy = "http://proxy.corp.example:8080"
    expect(proxied()).toBe(true)
    delete process.env.https_proxy
    process.env.HTTPS_PROXY = "http://proxy.corp.example:8080"
    expect(proxied()).toBe(true)
  })
})
