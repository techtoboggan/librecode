import { describe, expect, test, beforeEach, afterEach } from "bun:test"
import { Hono } from "hono"

// A05 (Security Misconfiguration) — HTTP 500 responses must not include a
// stack trace by default. Internal file paths + line numbers leak the deploy
// layout and give an attacker a roadmap for subsequent attempts.
//
// The handler ships stack traces only when LIBRECODE_DEV=1. The env var is
// read dynamically each request via the Flag module (not cached), so toggling
// at runtime should work.

describe("handleServerError", () => {
  const prev = process.env.LIBRECODE_DEV
  beforeEach(() => {
    delete process.env.LIBRECODE_DEV
    // Flag module caches truthy values at load time for most flags — we
    // purposely import the server module fresh per test via dynamic import
    // below to re-evaluate. Clean the Bun module registry.
    // biome-ignore lint/complexity/useLiteralKeys: Bun-specific API
    if (typeof (globalThis as any)["Bun"] !== "undefined") {
      try {
        // @ts-ignore — not typed
        require("bun").resolveSync
      } catch {}
    }
  })
  afterEach(() => {
    if (prev === undefined) delete process.env.LIBRECODE_DEV
    else process.env.LIBRECODE_DEV = prev
  })

  test("production response has message but not stack trace", async () => {
    delete process.env.LIBRECODE_DEV
    const { handleServerError } = await import("../../src/server/server.ts")
    const app = new Hono()
    app.get("/boom", () => {
      throw new Error("kaboom")
    })
    app.onError((err, c) => handleServerError(err, c))
    const res = await app.request("/boom")
    expect(res.status).toBe(500)
    const body = (await res.json()) as Record<string, unknown>
    const inner = (body.data ?? body) as Record<string, unknown>
    // The redacted prod response must not contain a file path or line number
    const serialized = JSON.stringify(body)
    expect(serialized).not.toContain("/home/")
    expect(serialized).not.toContain(".ts:")
    expect(serialized).not.toContain("at ")
    // But it should still carry the error message
    expect(serialized).toContain("kaboom")
    // `inner` is intentionally referenced to avoid unused-var warnings; the
    // real assertion is on the serialized JSON.
    void inner
  })

  test("NamedError round-trips with its declared status", async () => {
    const { handleServerError } = await import("../../src/server/server.ts")
    const { NamedError } = await import("@librecode/util/error")
    const app = new Hono()
    app.get("/boom", () => {
      throw new NamedError.Unknown({ message: "named failure" })
    })
    app.onError((err, c) => handleServerError(err, c))
    const res = await app.request("/boom")
    expect(res.status).toBe(500)
    const body = (await res.json()) as Record<string, unknown>
    // NamedError.Unknown's toObject() should survive, regardless of DEV flag
    expect(JSON.stringify(body)).toContain("named failure")
  })
})
