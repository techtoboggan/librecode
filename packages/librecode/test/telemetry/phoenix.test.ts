/**
 * v0.9.76 — Phoenix Arize telemetry pipeline tests.
 *
 * Covers the pure helpers (`healthzUrlFor`) + the side-effecting
 * `checkPhoenixHealth` against a fake fetchFn. The full
 * `initPhoenix` SDK wire-up isn't unit-tested directly because it
 * spawns a NodeTracerProvider with a real OTLP exporter — the
 * smoke-test for that path is integration via the LLM-call site,
 * which is exercised manually before each Phoenix-related release.
 */
import { afterEach, describe, expect, test } from "bun:test"
import { checkPhoenixHealth, healthzUrlFor, resetPhoenixRuntime } from "../../src/telemetry/phoenix"

afterEach(async () => {
  await resetPhoenixRuntime()
})

describe("healthzUrlFor", () => {
  test("strips /v1/traces and points at /healthz", () => {
    expect(healthzUrlFor("http://localhost:6006/v1/traces")).toBe("http://localhost:6006/healthz")
  })

  test("strips trailing slashes from a bare host", () => {
    expect(healthzUrlFor("http://localhost:6006/")).toBe("http://localhost:6006/healthz")
  })

  test("handles a host without trailing slash", () => {
    expect(healthzUrlFor("http://localhost:6006")).toBe("http://localhost:6006/healthz")
  })

  test("clears query strings the user might've left in (e.g. ?api-key=…)", () => {
    expect(healthzUrlFor("http://localhost:6006/v1/traces?key=secret")).toBe("http://localhost:6006/healthz")
  })

  test("preserves non-default ports + hosts", () => {
    expect(healthzUrlFor("https://phoenix.example.com:8443/v1/traces")).toBe("https://phoenix.example.com:8443/healthz")
  })

  test("falls through cleanly on a malformed URL string", () => {
    // URL constructor throws on bare strings without a scheme — the
    // fallback path appends /healthz so the user still gets a
    // somewhat-useful endpoint to display in the error.
    expect(healthzUrlFor("not a url")).toBe("not a url/healthz")
  })
})

describe("checkPhoenixHealth", () => {
  test("returns ok=true on a 200", async () => {
    const fetchFn = async () => new Response("OK", { status: 200 })
    const result = await checkPhoenixHealth(
      { enabled: true, endpoint: "http://localhost:6006/v1/traces" },
      { fetchFn: fetchFn as unknown as typeof fetch },
    )
    expect(result.ok).toBe(true)
    expect(result.endpoint).toBe("http://localhost:6006/healthz")
    expect(result.status).toBe(200)
    expect(result.latencyMs).toBeGreaterThanOrEqual(0)
    expect(result.error).toBeUndefined()
  })

  test("returns ok=false with status when Phoenix replies non-2xx", async () => {
    const fetchFn = async () => new Response("internal error", { status: 503 })
    const result = await checkPhoenixHealth(
      { enabled: true, endpoint: "http://localhost:6006/v1/traces" },
      { fetchFn: fetchFn as unknown as typeof fetch },
    )
    expect(result.ok).toBe(false)
    expect(result.status).toBe(503)
    expect(result.error).toBe("HTTP 503")
  })

  test("returns ok=false with the error message on transport failure", async () => {
    const fetchFn = async () => {
      throw new Error("ECONNREFUSED")
    }
    const result = await checkPhoenixHealth(
      { enabled: true, endpoint: "http://localhost:6006/v1/traces" },
      { fetchFn: fetchFn as unknown as typeof fetch },
    )
    expect(result.ok).toBe(false)
    expect(result.status).toBeUndefined()
    expect(result.error).toContain("ECONNREFUSED")
  })

  test("falls back to DEFAULT_PHOENIX_ENDPOINT when no endpoint is provided", async () => {
    let calledUrl = ""
    const fetchFn = async (input: RequestInfo | URL) => {
      calledUrl = input.toString()
      return new Response("OK", { status: 200 })
    }
    await checkPhoenixHealth({ enabled: true }, { fetchFn: fetchFn as unknown as typeof fetch })
    expect(calledUrl).toBe("http://localhost:6006/healthz")
  })

  test("aborts after the configured timeout (defends against a Phoenix that accepts but never responds)", async () => {
    const fetchFn = async (_input: RequestInfo | URL, init?: RequestInit) => {
      // Never resolve; rely on signal abort to reject the promise.
      return new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted")))
      })
    }
    const result = await checkPhoenixHealth(
      { enabled: true, endpoint: "http://localhost:6006/v1/traces" },
      { fetchFn: fetchFn as unknown as typeof fetch, timeoutMs: 50 },
    )
    expect(result.ok).toBe(false)
    expect(result.error).toBeTruthy()
  })
})
