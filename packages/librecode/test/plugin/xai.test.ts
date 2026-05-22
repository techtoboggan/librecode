/**
 * Phase 40 / upstream PR #28557 — tests for the xAI Grok OAuth plugin's
 * pure helpers. The OAuth server + plugin loader path is exercised
 * manually before each release; here we lock in the pieces most likely
 * to regress silently:
 *   - JWT expiry detection (proactive-refresh trigger)
 *   - authorize URL construction (PKCE + state + plan=generic)
 *   - device-code poll loop (authorization_pending → slow_down → success)
 *   - HTML escaping (defense against an xAI error message containing markup)
 *   - normalize positive seconds → ms (guard against NaN/garbage interval)
 */
import { describe, expect, mock, test } from "bun:test"
import {
  accessTokenIsExpiring,
  buildAuthorizeUrl,
  escapeHtml,
  pollDeviceCodeToken,
  positiveSecondsToMs,
  requestDeviceCode,
} from "../../src/plugin/xai"

function makeJwt(claims: Record<string, unknown>): string {
  // header.payload.signature — signature unused in our (unsafe-decode) parser.
  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url")
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url")
  return `${header}.${payload}.sig`
}

describe("accessTokenIsExpiring", () => {
  test("undefined/empty token returns false (conservative — let 401 drive refresh)", () => {
    expect(accessTokenIsExpiring(undefined)).toBe(false)
    expect(accessTokenIsExpiring("")).toBe(false)
  })

  test("opaque (non-JWT) token returns false", () => {
    expect(accessTokenIsExpiring("xai-opaque-token-12345")).toBe(false)
  })

  test("fresh JWT (exp 1h from now) returns false with default 2-minute skew", () => {
    const oneHourFromNow = Math.floor(Date.now() / 1000) + 3600
    const token = makeJwt({ exp: oneHourFromNow })
    expect(accessTokenIsExpiring(token)).toBe(false)
  })

  test("expired JWT returns true", () => {
    const oneHourAgo = Math.floor(Date.now() / 1000) - 3600
    const token = makeJwt({ exp: oneHourAgo })
    expect(accessTokenIsExpiring(token)).toBe(true)
  })

  test("JWT expiring within the skew window returns true", () => {
    // 60 seconds in the future, default skew is 120 seconds — should
    // proactively refresh.
    const sixtySecondsAhead = Math.floor(Date.now() / 1000) + 60
    const token = makeJwt({ exp: sixtySecondsAhead })
    expect(accessTokenIsExpiring(token)).toBe(true)
  })

  test("JWT without exp claim returns false (no info → don't refresh)", () => {
    const token = makeJwt({ sub: "user-1", aud: "xai-api" })
    expect(accessTokenIsExpiring(token)).toBe(false)
  })
})

describe("buildAuthorizeUrl", () => {
  const pkce = { verifier: "ver", challenge: "ch" }

  test("constructs PKCE authorize URL with required xAI params", () => {
    const url = new URL(buildAuthorizeUrl(pkce, "STATE", "NONCE"))
    expect(url.host).toBe("auth.x.ai")
    expect(url.pathname).toBe("/oauth2/authorize")
    expect(url.searchParams.get("response_type")).toBe("code")
    expect(url.searchParams.get("code_challenge")).toBe("ch")
    expect(url.searchParams.get("code_challenge_method")).toBe("S256")
    expect(url.searchParams.get("state")).toBe("STATE")
    expect(url.searchParams.get("nonce")).toBe("NONCE")
    expect(url.searchParams.get("redirect_uri")).toBe("http://127.0.0.1:56121/callback")
    // plan=generic is REQUIRED — without it accounts.x.ai rejects loopback OAuth.
    expect(url.searchParams.get("plan")).toBe("generic")
  })

  test("respects authorizeUrl override (for tests / staging)", () => {
    const url = buildAuthorizeUrl(pkce, "s", "n", { authorizeUrl: "https://staging.x.ai/oauth2/authorize" })
    expect(url.startsWith("https://staging.x.ai/oauth2/authorize?")).toBe(true)
  })

  test("scope includes both api:access and grok-cli:access", () => {
    const url = new URL(buildAuthorizeUrl(pkce, "s", "n"))
    const scope = url.searchParams.get("scope") ?? ""
    expect(scope).toContain("api:access")
    expect(scope).toContain("grok-cli:access")
    expect(scope).toContain("offline_access")
  })
})

describe("escapeHtml", () => {
  test("escapes the six dangerous characters", () => {
    expect(escapeHtml("<script>alert('xss')</script>")).toBe("&lt;script&gt;alert(&#39;xss&#39;)&lt;/script&gt;")
    expect(escapeHtml('Tom & "Jerry"')).toBe("Tom &amp; &quot;Jerry&quot;")
  })

  test("plain text passes through", () => {
    expect(escapeHtml("plain message")).toBe("plain message")
  })
})

describe("positiveSecondsToMs", () => {
  test("converts positive seconds to ms", () => {
    expect(positiveSecondsToMs(5, 1000)).toBe(5000)
  })

  test("falls back to default for NaN / null / non-numeric", () => {
    expect(positiveSecondsToMs(NaN, 1000)).toBe(1000)
    expect(positiveSecondsToMs(null, 1000)).toBe(1000)
    expect(positiveSecondsToMs("garbage", 1000)).toBe(1000)
    expect(positiveSecondsToMs(undefined, 1000)).toBe(1000)
  })

  test("falls back to default for non-positive (0, negative)", () => {
    expect(positiveSecondsToMs(0, 1000)).toBe(1000)
    expect(positiveSecondsToMs(-5, 1000)).toBe(1000)
  })

  test("string-encoded positive seconds works (server returns JSON numbers as strings sometimes)", () => {
    expect(positiveSecondsToMs("5", 1000)).toBe(5000)
  })
})

describe("requestDeviceCode", () => {
  test("returns parsed device-code response on success", async () => {
    const fetchMock = mock(async () =>
      Response.json({
        device_code: "DC123",
        user_code: "ABCD-1234",
        verification_uri: "https://x.ai/device",
        verification_uri_complete: "https://x.ai/device?code=ABCD-1234",
        expires_in: 300,
        interval: 5,
      }),
    )
    const origFetch = globalThis.fetch
    globalThis.fetch = fetchMock as unknown as typeof fetch
    try {
      const result = await requestDeviceCode()
      expect(result.device_code).toBe("DC123")
      expect(result.user_code).toBe("ABCD-1234")
      expect(result.verification_uri).toBe("https://x.ai/device")
    } finally {
      globalThis.fetch = origFetch
    }
  })

  test("throws when xAI omits required fields", async () => {
    const fetchMock = mock(async () => Response.json({ device_code: "DC123" }))
    const origFetch = globalThis.fetch
    globalThis.fetch = fetchMock as unknown as typeof fetch
    try {
      await expect(requestDeviceCode()).rejects.toThrow(/missing/)
    } finally {
      globalThis.fetch = origFetch
    }
  })

  test("throws with status + body detail when xAI returns non-2xx", async () => {
    const fetchMock = mock(async () => new Response("client not allowed", { status: 401 }))
    const origFetch = globalThis.fetch
    globalThis.fetch = fetchMock as unknown as typeof fetch
    try {
      await expect(requestDeviceCode()).rejects.toThrow(/401.*client not allowed/)
    } finally {
      globalThis.fetch = origFetch
    }
  })
})

describe("pollDeviceCodeToken", () => {
  function makeDevice(overrides: Partial<Parameters<typeof pollDeviceCodeToken>[0]> = {}) {
    return {
      device_code: "DC",
      user_code: "ABCD-1234",
      verification_uri: "https://x.ai/device",
      expires_in: 60,
      interval: 1,
      ...overrides,
    }
  }

  test("resolves when xAI returns 200 with tokens (the happy path)", async () => {
    const fetchMock = mock(async () => Response.json({ access_token: "AT", refresh_token: "RT", expires_in: 3600 }))
    const origFetch = globalThis.fetch
    globalThis.fetch = fetchMock as unknown as typeof fetch
    try {
      const tokens = await pollDeviceCodeToken(makeDevice())
      expect(tokens.access_token).toBe("AT")
      expect(tokens.refresh_token).toBe("RT")
    } finally {
      globalThis.fetch = origFetch
    }
  })

  test("backs off on authorization_pending then succeeds (RFC 8628 §3.5)", async () => {
    let calls = 0
    const fetchMock = mock(async () => {
      calls += 1
      if (calls === 1) return Response.json({ error: "authorization_pending" }, { status: 400 })
      return Response.json({ access_token: "AT", refresh_token: "RT" })
    })
    const origFetch = globalThis.fetch
    globalThis.fetch = fetchMock as unknown as typeof fetch
    try {
      const sleeps: number[] = []
      const tokens = await pollDeviceCodeToken(makeDevice(), {
        sleep: async (ms) => {
          sleeps.push(ms)
        },
      })
      expect(tokens.access_token).toBe("AT")
      expect(calls).toBe(2)
      // The pending-branch should have slept ≥ interval(1s) + safety margin.
      expect(sleeps.length).toBe(1)
    } finally {
      globalThis.fetch = origFetch
    }
  })

  test("bumps interval on slow_down before retrying (RFC 8628 §3.5)", async () => {
    let calls = 0
    const fetchMock = mock(async () => {
      calls += 1
      if (calls === 1) return Response.json({ error: "slow_down" }, { status: 400 })
      return Response.json({ access_token: "AT", refresh_token: "RT" })
    })
    const origFetch = globalThis.fetch
    globalThis.fetch = fetchMock as unknown as typeof fetch
    try {
      const sleeps: number[] = []
      await pollDeviceCodeToken(makeDevice({ interval: 1 }), {
        sleep: async (ms) => {
          sleeps.push(ms)
        },
      })
      // slow_down adds DEVICE_CODE_SLOW_DOWN_INCREMENT_MS (5_000) to interval.
      // Initial interval was 1_000ms; after slow_down 6_000ms; plus 3_000ms safety margin = 9_000ms.
      expect(sleeps[0]).toBeGreaterThanOrEqual(6_000)
    } finally {
      globalThis.fetch = origFetch
    }
  })

  test("rejects on access_denied with a clear message", async () => {
    const fetchMock = mock(async () => Response.json({ error: "access_denied" }, { status: 400 }))
    const origFetch = globalThis.fetch
    globalThis.fetch = fetchMock as unknown as typeof fetch
    try {
      await expect(pollDeviceCodeToken(makeDevice())).rejects.toThrow(/denied/)
    } finally {
      globalThis.fetch = origFetch
    }
  })

  test("rejects on expired_token with a clear message", async () => {
    const fetchMock = mock(async () => Response.json({ error: "expired_token" }, { status: 400 }))
    const origFetch = globalThis.fetch
    globalThis.fetch = fetchMock as unknown as typeof fetch
    try {
      await expect(pollDeviceCodeToken(makeDevice())).rejects.toThrow(/expired/)
    } finally {
      globalThis.fetch = origFetch
    }
  })

  test("times out when xAI's expires_in elapses without success", async () => {
    let nowMs = 0
    const fetchMock = mock(async () => Response.json({ error: "authorization_pending" }, { status: 400 }))
    const origFetch = globalThis.fetch
    globalThis.fetch = fetchMock as unknown as typeof fetch
    try {
      // Sleep advances the simulated clock past the device deadline so the
      // loop's `while (now() < deadline)` exits cleanly.
      await expect(
        pollDeviceCodeToken(makeDevice({ expires_in: 1 }), {
          now: () => nowMs,
          sleep: async (ms) => {
            nowMs += ms + 1000
          },
        }),
      ).rejects.toThrow(/timed out/)
    } finally {
      globalThis.fetch = origFetch
    }
  })
})
