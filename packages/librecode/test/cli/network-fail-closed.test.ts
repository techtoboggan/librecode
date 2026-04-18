import { describe, expect, test } from "bun:test"
import { isLoopbackHostname, requirePasswordForNonLoopback } from "../../src/cli/network.ts"

// A05 (Security Misconfiguration) — Binding to 0.0.0.0 / a public IP /
// mDNS without a password exposes the full LibreCode API (session
// control, shell/tool execution, credential storage) to anyone on the
// LAN. A console warning is not enough — fail-closed at the CLI layer.

describe("isLoopbackHostname", () => {
  test("recognizes IPv4 loopback", () => {
    expect(isLoopbackHostname("127.0.0.1")).toBe(true)
    expect(isLoopbackHostname("127.1.2.3")).toBe(true) // entire 127/8 is loopback
  })
  test("recognizes IPv6 loopback", () => {
    expect(isLoopbackHostname("::1")).toBe(true)
    expect(isLoopbackHostname("[::1]")).toBe(true)
  })
  test("recognizes 'localhost'", () => {
    expect(isLoopbackHostname("localhost")).toBe(true)
  })
  test("rejects 0.0.0.0 and public IPs", () => {
    expect(isLoopbackHostname("0.0.0.0")).toBe(false)
    expect(isLoopbackHostname("192.168.1.100")).toBe(false)
    expect(isLoopbackHostname("10.0.0.5")).toBe(false)
    expect(isLoopbackHostname("8.8.8.8")).toBe(false)
  })
  test("rejects wildcard IPv6", () => {
    expect(isLoopbackHostname("::")).toBe(false)
  })
  test("rejects empty", () => {
    expect(isLoopbackHostname("")).toBe(false)
  })
})

describe("requirePasswordForNonLoopback", () => {
  test("permits loopback + no password", () => {
    expect(() =>
      requirePasswordForNonLoopback({ hostname: "127.0.0.1", password: undefined, bypass: false }),
    ).not.toThrow()
    expect(() =>
      requirePasswordForNonLoopback({ hostname: "localhost", password: undefined, bypass: false }),
    ).not.toThrow()
  })

  test("permits non-loopback + password set", () => {
    expect(() =>
      requirePasswordForNonLoopback({ hostname: "0.0.0.0", password: "secret", bypass: false }),
    ).not.toThrow()
  })

  test("rejects non-loopback without password", () => {
    expect(() => requirePasswordForNonLoopback({ hostname: "0.0.0.0", password: undefined, bypass: false })).toThrow(
      /LIBRECODE_SERVER_PASSWORD/,
    )
    expect(() =>
      requirePasswordForNonLoopback({ hostname: "192.168.1.5", password: undefined, bypass: false }),
    ).toThrow()
  })

  test("bypass flag permits non-loopback without password (escape hatch)", () => {
    expect(() =>
      requirePasswordForNonLoopback({ hostname: "0.0.0.0", password: undefined, bypass: true }),
    ).not.toThrow()
  })

  test("empty-string password counts as unset", () => {
    expect(() => requirePasswordForNonLoopback({ hostname: "0.0.0.0", password: "", bypass: false })).toThrow()
  })
})
