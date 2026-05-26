/**
 * Phase 50b Sub-B — iframe pool tests.
 *
 * Uses happy-dom (preloaded via bunfig.toml) for DOM operations.
 * Tests exercise the pool's TTL, LRU eviction, hit/miss accounting,
 * and cleanup callback semantics.
 *
 * Each test creates a fresh pool via createIframePool() to prevent
 * state from leaking between tests. The module singleton (getIframePool)
 * is tested separately.
 */
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"
import { createIframePool, getIframePool } from "./iframe-pool"

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeIframe(): HTMLIFrameElement {
  return document.createElement("iframe")
}

// ── Cleanup guard ─────────────────────────────────────────────────────────────
// Remove the pool host element after each test so the DOM is clean.

afterEach(() => {
  const host = document.getElementById("librecode-iframe-pool")
  host?.parentNode?.removeChild(host)
})

// ── Core park / has / claim / size ────────────────────────────────────────────

describe("IframePool — park and has", () => {
  test("park adds an entry; has returns true", () => {
    const pool = createIframePool()
    const iframe = makeIframe()
    pool.park("server:ui://app", iframe, () => {})
    expect(pool.has("server:ui://app")).toBe(true)
    expect(pool.size()).toBe(1)
    pool.dispose()
  })

  test("has returns false for an unknown key", () => {
    const pool = createIframePool()
    expect(pool.has("server:ui://missing")).toBe(false)
    pool.dispose()
  })

  test("park then claim returns the iframe and removes from pool", () => {
    const pool = createIframePool()
    const iframe = makeIframe()
    pool.park("s:uri", iframe, () => {})
    const claimed = pool.claim("s:uri")
    expect(claimed).toBe(iframe)
    expect(pool.has("s:uri")).toBe(false)
    expect(pool.size()).toBe(0)
    pool.dispose()
  })

  test("claim on a missing key returns undefined", () => {
    const pool = createIframePool()
    expect(pool.claim("s:missing")).toBeUndefined()
    pool.dispose()
  })

  test("claim removes the entry; subsequent has returns false", () => {
    const pool = createIframePool()
    const iframe = makeIframe()
    pool.park("s:uri", iframe, () => {})
    pool.claim("s:uri")
    expect(pool.has("s:uri")).toBe(false)
    pool.dispose()
  })
})

// ── LRU eviction ──────────────────────────────────────────────────────────────

describe("IframePool — LRU eviction (max 3 entries)", () => {
  test("park beyond POOL_MAX_SIZE (3) evicts the oldest entry", () => {
    let evictedCleanup = false
    const pool = createIframePool()

    pool.park("s:a", makeIframe(), () => {
      evictedCleanup = true
    })
    pool.park("s:b", makeIframe(), () => {})
    pool.park("s:c", makeIframe(), () => {})
    // Fourth entry: "s:a" is oldest and must be evicted
    pool.park("s:d", makeIframe(), () => {})

    expect(pool.size()).toBe(3)
    expect(pool.has("s:a")).toBe(false) // evicted
    expect(pool.has("s:b")).toBe(true)
    expect(pool.has("s:c")).toBe(true)
    expect(pool.has("s:d")).toBe(true)
    expect(evictedCleanup).toBe(true) // cleanup was called
    pool.dispose()
  })

  test("park-then-park the same key replaces and disposes the original", () => {
    let originalCleanupCalls = 0
    const pool = createIframePool()
    const original = makeIframe()
    const replacement = makeIframe()

    pool.park("s:uri", original, () => {
      originalCleanupCalls++
    })
    pool.park("s:uri", replacement, () => {})

    expect(pool.size()).toBe(1)
    expect(originalCleanupCalls).toBe(1)
    const claimed = pool.claim("s:uri")
    expect(claimed).toBe(replacement)
    pool.dispose()
  })
})

// ── Cleanup callback ───────────────────────────────────────────────────────────

describe("IframePool — cleanup callback semantics", () => {
  test("eviction calls the cleanup callback", () => {
    const cb = mock<() => void>()
    const pool = createIframePool()
    pool.park("s:a", makeIframe(), cb)
    pool.park("s:b", makeIframe(), () => {})
    pool.park("s:c", makeIframe(), () => {})
    pool.park("s:d", makeIframe(), () => {}) // triggers eviction of s:a

    expect(cb).toHaveBeenCalledTimes(1)
    pool.dispose()
  })

  test("cleanup throwing does not prevent eviction from completing", () => {
    const pool = createIframePool()
    pool.park("s:a", makeIframe(), () => {
      throw new Error("cleanup error")
    })
    // Trigger eviction via LRU
    pool.park("s:b", makeIframe(), () => {})
    pool.park("s:c", makeIframe(), () => {})
    expect(() => pool.park("s:d", makeIframe(), () => {})).not.toThrow()
    expect(pool.has("s:a")).toBe(false)
    pool.dispose()
  })

  test("dispose calls cleanup for all remaining entries", () => {
    let calls = 0
    const pool = createIframePool()
    pool.park("s:a", makeIframe(), () => {
      calls++
    })
    pool.park("s:b", makeIframe(), () => {
      calls++
    })
    pool.dispose()
    expect(calls).toBe(2)
    expect(pool.size()).toBe(0)
  })
})

// ── TTL eviction ──────────────────────────────────────────────────────────────

describe("IframePool — TTL eviction (5 minutes)", () => {
  let fakeNow = 0

  beforeEach(() => {
    fakeNow = 1_000_000
  })

  test("entry parked within TTL is still available", () => {
    const pool = createIframePool(() => fakeNow)
    pool.park("s:app", makeIframe(), () => {})
    // Advance 4 minutes — still within TTL
    fakeNow += 4 * 60 * 1000
    expect(pool.has("s:app")).toBe(true)
    pool.dispose()
  })

  test("cleanup interval evicts entries older than 5 minutes", async () => {
    // Use a fake now that we control; use a very short interval for testing.
    let fakeTime = 1_000_000
    let intervalCallback: (() => void) | undefined
    let originalSetInterval: typeof setInterval
    let originalClearInterval: typeof clearInterval

    // Patch setInterval to capture the callback.
    originalSetInterval = globalThis.setInterval
    originalClearInterval = globalThis.clearInterval
    // Cast through unknown to satisfy strict typeof setInterval (which includes
    // Node.js __promisify__ etc.). The mock only needs the call-site signature.
    ;(globalThis as unknown as Record<string, unknown>).setInterval = (fn: () => void, _delay: number) => {
      intervalCallback = fn
      return 999
    }
    ;(globalThis as unknown as Record<string, unknown>).clearInterval = (_id: unknown) => {}

    const pool = createIframePool(() => fakeTime)
    pool.park("s:app", makeIframe(), () => {})
    expect(pool.has("s:app")).toBe(true)

    // Advance past TTL (5 minutes + 1ms)
    fakeTime += 5 * 60 * 1000 + 1
    // Manually fire the interval callback
    intervalCallback?.()
    expect(pool.has("s:app")).toBe(false)

    pool.dispose()
    // Restore globals
    globalThis.setInterval = originalSetInterval
    globalThis.clearInterval = originalClearInterval
  })
})

// ── Dispose and host element ───────────────────────────────────────────────────

describe("IframePool — dispose and host element", () => {
  test("dispose clears all entries and removes host from DOM", () => {
    const pool = createIframePool()
    pool.park("s:a", makeIframe(), () => {})
    pool.park("s:b", makeIframe(), () => {})

    pool.dispose()

    expect(pool.size()).toBe(0)
    expect(document.getElementById("librecode-iframe-pool")).toBeNull()
  })
})

// ── Module singleton ──────────────────────────────────────────────────────────

describe("IframePool — getIframePool singleton", () => {
  test("getIframePool() returns the same instance across multiple calls", () => {
    const a = getIframePool()
    const b = getIframePool()
    expect(a).toBe(b)
  })
})

// ── Phase 50c — claim-side semantics ─────────────────────────────────────────
//
// Phase 50c adds the claim side of the iframe pool: PaneIframeBody checks the
// pool at render time and passes a `cachedIframe` to McpAppPanel when there is
// a hit, skipping `fetchAppHtml` and the cold-start bridge handshake.
//
// Key invariant: `claim()` must NOT call `entry.cleanup`. The old bridge is
// already closed by McpAppPanel.onCleanup (Solid disposes children before
// parents, so the bridge closes before DockPane.onCleanup calls park).
// Calling cleanup again would fire the HTTP POST that drops the app's session
// permission grants — destroying permissions for an app we're about to
// immediately re-show (Pitfall 10c from the Phase 50b spec).

describe("IframePool — Phase 50c claim-side semantics", () => {
  test("claim returns the iframe without calling the cleanup callback", () => {
    let cleanupCalled = false
    const pool = createIframePool()
    const iframe = makeIframe()
    pool.park("s:ui://s/app", iframe, () => {
      cleanupCalled = true
    })
    const claimed = pool.claim("s:ui://s/app")
    expect(claimed).toBe(iframe)
    // Cleanup is NOT invoked on claim — old bridge already closed by
    // McpAppPanel.onCleanup; calling again would drop session grants.
    expect(cleanupCalled).toBe(false)
    pool.dispose()
  })

  test("claimed iframe is removed from the pool (one-shot consumption)", () => {
    const pool = createIframePool()
    pool.park("s:uri", makeIframe(), () => {})
    pool.claim("s:uri")
    // Second claim attempt: miss
    const second = pool.claim("s:uri")
    expect(second).toBeUndefined()
    expect(pool.has("s:uri")).toBe(false)
    pool.dispose()
  })

  test("pool key is server:uri — cross-server miss (different servers, same uri)", () => {
    const pool = createIframePool()
    const iframe = makeIframe()
    pool.park("server-a:ui://shared/app", iframe, () => {})
    // Looking up with a different server → miss
    expect(pool.claim("server-b:ui://shared/app")).toBeUndefined()
    // Original entry still there
    expect(pool.has("server-a:ui://shared/app")).toBe(true)
    pool.dispose()
  })

  test("pool-miss on empty pool returns undefined (cold-start path taken)", () => {
    const pool = createIframePool()
    expect(pool.claim("nonexistent:key")).toBeUndefined()
    pool.dispose()
  })
})
