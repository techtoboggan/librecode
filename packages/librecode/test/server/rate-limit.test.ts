import { describe, expect, test } from "bun:test"
import { createRateLimiter } from "../../src/server/rate-limit.ts"

// A07 (Identification and Authentication Failures) — without rate
// limiting, a LAN attacker can brute-force LIBRECODE_SERVER_PASSWORD as
// fast as they can send HTTP requests (basic-auth has no inherent rate
// or lockout). Token-bucket per source IP fixes that.

describe("rateLimiter", () => {
  test("permits up to maxAttempts per window", () => {
    const limiter = createRateLimiter({ maxAttempts: 10, windowMs: 60_000 })
    for (let i = 0; i < 10; i++) {
      expect(limiter.check("1.2.3.4").allowed).toBe(true)
    }
  })

  test("rejects the 11th attempt in the same window", () => {
    const limiter = createRateLimiter({ maxAttempts: 10, windowMs: 60_000 })
    for (let i = 0; i < 10; i++) limiter.check("1.2.3.4")
    const blocked = limiter.check("1.2.3.4")
    expect(blocked.allowed).toBe(false)
    expect(blocked.retryAfterSec).toBeGreaterThan(0)
  })

  test("isolates buckets per IP", () => {
    const limiter = createRateLimiter({ maxAttempts: 3, windowMs: 60_000 })
    for (let i = 0; i < 3; i++) limiter.check("1.1.1.1")
    // 1.1.1.1 exhausted, 2.2.2.2 should still have full bucket
    expect(limiter.check("1.1.1.1").allowed).toBe(false)
    expect(limiter.check("2.2.2.2").allowed).toBe(true)
  })

  test("bucket resets after window elapses", () => {
    const limiter = createRateLimiter({
      maxAttempts: 2,
      windowMs: 100, // tiny window for fast test
    })
    limiter.check("9.9.9.9")
    limiter.check("9.9.9.9")
    expect(limiter.check("9.9.9.9").allowed).toBe(false)
    // Wait longer than window
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        expect(limiter.check("9.9.9.9").allowed).toBe(true)
        resolve()
      }, 150)
    })
  })

  test("success() clears the bucket (post-auth reset)", () => {
    const limiter = createRateLimiter({ maxAttempts: 3, windowMs: 60_000 })
    limiter.check("1.2.3.4")
    limiter.check("1.2.3.4")
    limiter.success("1.2.3.4")
    // After success, back to full allowance
    for (let i = 0; i < 3; i++) {
      expect(limiter.check("1.2.3.4").allowed).toBe(true)
    }
  })

  test("cleanup() removes expired entries", () => {
    const limiter = createRateLimiter({ maxAttempts: 3, windowMs: 50 })
    limiter.check("5.5.5.5")
    expect(limiter.size()).toBe(1)
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        limiter.cleanup()
        expect(limiter.size()).toBe(0)
        resolve()
      }, 100)
    })
  })

  test("redactIp masks the last octet for v4", () => {
    const { redactIp } = require("../../src/server/rate-limit.ts")
    expect(redactIp("192.168.1.100")).toBe("192.168.1.*")
    expect(redactIp("8.8.8.8")).toBe("8.8.8.*")
  })

  test("redactIp masks the last segment for v6", () => {
    const { redactIp } = require("../../src/server/rate-limit.ts")
    // lastIndexOf(':') gives the colon just before the final segment
    expect(redactIp("2001:db8:abcd:1234::1")).toBe("2001:db8:abcd:1234::*")
    expect(redactIp("::1")).toBe("::*")
  })
})
