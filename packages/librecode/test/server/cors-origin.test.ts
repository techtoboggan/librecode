import { describe, expect, test } from "bun:test"
import { resolveCorsOrigin } from "../../src/server/server.ts"

// A05 (Security Misconfiguration) — CORS must not trust the entire localhost
// port space. Only known LibreCode dev ports (or ports the caller explicitly
// allows via `opts.cors`) should pass; other localhost origins are rejected.

describe("resolveCorsOrigin", () => {
  test("accepts known LibreCode dev ports on localhost", () => {
    expect(resolveCorsOrigin("http://localhost:1420", undefined)).toBe("http://localhost:1420") // Tauri
    expect(resolveCorsOrigin("http://localhost:3000", undefined)).toBe("http://localhost:3000") // App dev
  })

  test("accepts known LibreCode dev ports on 127.0.0.1", () => {
    expect(resolveCorsOrigin("http://127.0.0.1:1420", undefined)).toBe("http://127.0.0.1:1420")
    expect(resolveCorsOrigin("http://127.0.0.1:3000", undefined)).toBe("http://127.0.0.1:3000")
  })

  test("rejects unknown localhost ports", () => {
    expect(resolveCorsOrigin("http://localhost:9999", undefined)).toBeUndefined()
    expect(resolveCorsOrigin("http://localhost:8080", undefined)).toBeUndefined()
    expect(resolveCorsOrigin("http://127.0.0.1:5173", undefined)).toBeUndefined()
  })

  test("accepts Tauri app scheme", () => {
    expect(resolveCorsOrigin("tauri://localhost", undefined)).toBe("tauri://localhost")
    expect(resolveCorsOrigin("http://tauri.localhost", undefined)).toBe("http://tauri.localhost")
    expect(resolveCorsOrigin("https://tauri.localhost", undefined)).toBe("https://tauri.localhost")
  })

  test("accepts librecode.ai and subdomains", () => {
    expect(resolveCorsOrigin("https://librecode.ai", undefined)).toBe("https://librecode.ai")
    expect(resolveCorsOrigin("https://app.librecode.ai", undefined)).toBe("https://app.librecode.ai")
    expect(resolveCorsOrigin("https://beta.app.librecode.ai", undefined)).toBe("https://beta.app.librecode.ai")
  })

  test("rejects typosquats and homograph attacks on librecode.ai", () => {
    expect(resolveCorsOrigin("https://librecode.ai.evil.com", undefined)).toBeUndefined()
    expect(resolveCorsOrigin("https://librecode-ai.com", undefined)).toBeUndefined()
    // subdomain must be a-z0-9-, not arbitrary UTF-8 or uppercase
    expect(resolveCorsOrigin("https://LIBRECODE.AI", undefined)).toBeUndefined()
  })

  test("accepts explicit allow-list entries", () => {
    const allowed = ["http://localhost:9999", "https://custom.example.com"]
    expect(resolveCorsOrigin("http://localhost:9999", allowed)).toBe("http://localhost:9999")
    expect(resolveCorsOrigin("https://custom.example.com", allowed)).toBe("https://custom.example.com")
  })

  test("rejects empty / null input", () => {
    expect(resolveCorsOrigin(null, undefined)).toBeUndefined()
    expect(resolveCorsOrigin(undefined, undefined)).toBeUndefined()
    expect(resolveCorsOrigin("", undefined)).toBeUndefined()
  })

  test("rejects file:// and javascript: schemes", () => {
    expect(resolveCorsOrigin("file:///etc/passwd", undefined)).toBeUndefined()
    expect(resolveCorsOrigin("javascript:alert(1)", undefined)).toBeUndefined()
    expect(resolveCorsOrigin("data:text/html,<script>alert(1)</script>", undefined)).toBeUndefined()
  })

  test("rejects RFC1918 private IPs even with 'localhost' in URL", () => {
    expect(resolveCorsOrigin("http://192.168.1.1:3000", undefined)).toBeUndefined()
    expect(resolveCorsOrigin("http://10.0.0.1:1420", undefined)).toBeUndefined()
    expect(resolveCorsOrigin("http://172.16.0.1:3000", undefined)).toBeUndefined()
  })

  test("rejects origin-smuggling attempts", () => {
    // `http://localhost:1420.evil.com` — looks like localhost but isn't
    expect(resolveCorsOrigin("http://localhost:1420.evil.com", undefined)).toBeUndefined()
    // port-after-userinfo trick
    expect(resolveCorsOrigin("http://localhost@evil.com:1420", undefined)).toBeUndefined()
  })
})
