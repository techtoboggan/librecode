import { describe, expect, test } from "bun:test"
import { isBlockedIP, isBlockedHost, validateFetchURL } from "../../src/util/ssrf.ts"

// A10 (Server-Side Request Forgery) — a tool or endpoint that fetches
// arbitrary URLs must reject hosts that resolve to the local host, a
// private LAN, or cloud-metadata services. Otherwise a prompt-injected
// agent (or a legit-but-careless user approving a webfetch) can
// exfiltrate cloud credentials or scan internal infrastructure.

describe("isBlockedIP", () => {
  test("blocks IPv4 loopback (127.0.0.0/8)", () => {
    expect(isBlockedIP("127.0.0.1")).toBe(true)
    expect(isBlockedIP("127.255.255.254")).toBe(true)
  })

  test("blocks IPv4 wildcard", () => {
    expect(isBlockedIP("0.0.0.0")).toBe(true)
  })

  test("blocks RFC1918 private ranges", () => {
    expect(isBlockedIP("10.0.0.1")).toBe(true)
    expect(isBlockedIP("10.255.255.255")).toBe(true)
    expect(isBlockedIP("172.16.0.1")).toBe(true)
    expect(isBlockedIP("172.31.255.254")).toBe(true)
    expect(isBlockedIP("192.168.0.1")).toBe(true)
    expect(isBlockedIP("192.168.255.254")).toBe(true)
  })

  test("blocks link-local (169.254.x.y) — cloud metadata", () => {
    expect(isBlockedIP("169.254.169.254")).toBe(true) // AWS/Azure/GCP metadata
    expect(isBlockedIP("169.254.1.1")).toBe(true)
  })

  test("blocks CGNAT (100.64.0.0/10)", () => {
    expect(isBlockedIP("100.64.0.1")).toBe(true)
    expect(isBlockedIP("100.127.255.254")).toBe(true)
  })

  test("blocks IPv6 loopback and link-local", () => {
    expect(isBlockedIP("::1")).toBe(true)
    expect(isBlockedIP("fe80::1")).toBe(true) // link-local
    expect(isBlockedIP("fc00::1")).toBe(true) // unique-local
    expect(isBlockedIP("fd12:3456:789a::1")).toBe(true)
  })

  test("blocks IPv6 wildcard", () => {
    expect(isBlockedIP("::")).toBe(true)
  })

  test("permits public IPv4", () => {
    expect(isBlockedIP("8.8.8.8")).toBe(false)
    expect(isBlockedIP("1.1.1.1")).toBe(false)
    expect(isBlockedIP("151.101.1.140")).toBe(false)
  })

  test("permits public IPv6", () => {
    expect(isBlockedIP("2606:4700:4700::1111")).toBe(false) // Cloudflare
    expect(isBlockedIP("2001:4860:4860::8888")).toBe(false) // Google
  })

  test("172.x edge case: 172.15.x.x is public, 172.32.x.x is public", () => {
    expect(isBlockedIP("172.15.0.1")).toBe(false)
    expect(isBlockedIP("172.32.0.1")).toBe(false)
  })

  test("100.x edge case: 100.63.x.x is public, 100.128.x.x is public", () => {
    expect(isBlockedIP("100.63.255.254")).toBe(false)
    expect(isBlockedIP("100.128.0.1")).toBe(false)
  })
})

describe("isBlockedHost (hostname-only, no DNS)", () => {
  test("blocks literal localhost variants", () => {
    expect(isBlockedHost("localhost")).toBe(true)
    expect(isBlockedHost("LOCALHOST")).toBe(true)
    expect(isBlockedHost("metadata.google.internal")).toBe(true)
    expect(isBlockedHost("metadata")).toBe(true)
  })

  test("delegates to isBlockedIP when input parses as an IP", () => {
    expect(isBlockedHost("127.0.0.1")).toBe(true)
    expect(isBlockedHost("8.8.8.8")).toBe(false)
  })
})

describe("validateFetchURL", () => {
  test("accepts public hosts with http/https", async () => {
    await expect(validateFetchURL("https://example.com/page")).resolves.toBeUndefined()
  })

  test("rejects file://, javascript:, data:", async () => {
    await expect(validateFetchURL("file:///etc/passwd")).rejects.toThrow(/scheme/i)
    await expect(validateFetchURL("javascript:alert(1)")).rejects.toThrow(/scheme/i)
    await expect(validateFetchURL("data:text/html,<script>alert(1)</script>")).rejects.toThrow(/scheme/i)
  })

  test("rejects private IPs directly", async () => {
    await expect(validateFetchURL("http://169.254.169.254/latest/meta-data/")).rejects.toThrow(/blocked/i)
    await expect(validateFetchURL("http://192.168.1.1/")).rejects.toThrow(/blocked/i)
    await expect(validateFetchURL("http://10.0.0.5/")).rejects.toThrow(/blocked/i)
  })

  test("rejects localhost variants", async () => {
    await expect(validateFetchURL("http://localhost/")).rejects.toThrow(/blocked/i)
    await expect(validateFetchURL("http://127.0.0.1/")).rejects.toThrow(/blocked/i)
    await expect(validateFetchURL("http://[::1]/")).rejects.toThrow(/blocked/i)
  })

  test("rejects cloud metadata hostnames", async () => {
    await expect(validateFetchURL("http://metadata.google.internal/")).rejects.toThrow(/blocked/i)
  })

  test("rejects malformed URLs", async () => {
    await expect(validateFetchURL("not-a-url")).rejects.toThrow()
    await expect(validateFetchURL("")).rejects.toThrow()
  })

  test("rejects URLs with userinfo (smuggling)", async () => {
    // `http://example.com@169.254.169.254/` — userinfo trick; real host is metadata server
    await expect(validateFetchURL("http://example.com@169.254.169.254/")).rejects.toThrow(/userinfo|blocked/i)
  })
})
