/**
 * Phase 50b Sub-B — iframe pool.
 *
 * When a DockPane is removed (not collapsed — that's lazy mount's job),
 * its iframe + AppBridge cleanup are parked here for up to 5 minutes so
 * a subsequent re-pin reuses them without a cold-start handshake.
 *
 * Implementation notes:
 * - Pooled iframes live in an off-screen host element appended to
 *   `document.body`. This keeps them outside Solid's reactive `<For>`
 *   boundaries.
 * - LRU eviction: max 3 entries. Adding a 4th evicts the oldest.
 * - TTL: 5 minutes. A cleanup interval evicts stale entries.
 * - On park: move iframe DOM node from its dock pane to the host;
 *   pause any in-flight bridge work via the cleanup callback.
 * - On hit: move iframe back into the new dock pane's body (appendChild
 *   moves, not clones — keeps the AppBridge connection alive).
 * - On miss: caller does fresh mount.
 *
 * Pool key is `${server}:${uri}` to prevent cross-server hits (Pitfall 5).
 *
 * **Crucial**: this module manipulates the DOM directly. Callers MUST NOT
 * recreate the iframe element themselves — `claim()` returns the existing
 * element for the caller to insert.
 *
 * This file is vendored-pattern code exempt from the strict 500-line limit
 * per CLAUDE.md exception 3 (tightly-shared private state). The pool
 * singleton + factory share `entries`, `host`, and `intervalId`.
 */

const POOL_TTL_MS = 5 * 60 * 1000
const POOL_MAX_SIZE = 3
const HOST_ID = "librecode-iframe-pool"

export interface PooledEntry {
  iframe: HTMLIFrameElement
  parkedAt: number
  /** Cleanup callback — invoked on eviction so bridge listeners detach. */
  cleanup: () => void
}

export interface IframePool {
  /** Park an iframe in the pool under the given key. */
  park: (key: string, iframe: HTMLIFrameElement, cleanup: () => void) => void
  /** Claim a pooled iframe by key. Returns undefined on a miss. */
  claim: (key: string) => HTMLIFrameElement | undefined
  /** True if the pool has an entry for the given key. */
  has: (key: string) => boolean
  /** Number of entries currently pooled. */
  size: () => number
  /** Dispose the pool, evict all entries, and remove the host element. */
  dispose: () => void
}

/**
 * Create a fresh pool instance. Tests pass a fake `now` function to
 * simulate time-advancement without real-time waits. Production code
 * uses the module singleton (`getIframePool()`).
 */
export function createIframePool(now: () => number = Date.now): IframePool {
  const entries = new Map<string, PooledEntry>()
  let host: HTMLDivElement | undefined
  let intervalId: ReturnType<typeof setInterval> | undefined

  function ensureHost(): HTMLDivElement {
    if (host) return host
    const existing = document.getElementById(HOST_ID)
    if (existing instanceof HTMLDivElement) {
      host = existing
      return host
    }
    host = document.createElement("div")
    host.id = HOST_ID
    host.setAttribute("aria-hidden", "true")
    host.style.cssText = "display:none;position:absolute;left:-9999px;top:-9999px;"
    document.body.appendChild(host)
    return host
  }

  function evict(key: string): void {
    const entry = entries.get(key)
    if (!entry) return
    try {
      entry.cleanup()
    } catch {
      // Cleanup throwing must not block eviction.
    }
    if (entry.iframe.parentNode) {
      entry.iframe.parentNode.removeChild(entry.iframe)
    }
    entries.delete(key)
  }

  function enforceLru(): void {
    while (entries.size > POOL_MAX_SIZE) {
      let oldestKey: string | undefined
      let oldestTime = Infinity
      for (const [k, e] of entries) {
        if (e.parkedAt < oldestTime) {
          oldestTime = e.parkedAt
          oldestKey = k
        }
      }
      if (oldestKey) evict(oldestKey)
    }
  }

  function startCleanupInterval(): void {
    if (intervalId !== undefined) return
    intervalId = setInterval(() => {
      const cutoff = now() - POOL_TTL_MS
      for (const [key, entry] of entries) {
        if (entry.parkedAt < cutoff) {
          evict(key)
        }
      }
    }, 30_000)
  }

  return {
    park(key, iframe, cleanup) {
      // Replace existing entry if already pooled to avoid stale DOM nodes.
      if (entries.has(key)) evict(key)
      ensureHost().appendChild(iframe)
      entries.set(key, { iframe, parkedAt: now(), cleanup })
      enforceLru()
      startCleanupInterval()
    },

    claim(key) {
      const entry = entries.get(key)
      if (!entry) return undefined
      entries.delete(key)
      // Do NOT call entry.cleanup() here. By the time claim() is called from
      // a new PaneIframeBody, the old McpAppPanel.onCleanup has already fired
      // (Solid disposes children before parents), closing the old bridge and
      // removing its transport listeners. Calling cleanup again would fire the
      // HTTP POST that drops the app's session permission grants — which would
      // destroy permissions for an app we are about to immediately re-show.
      // The new owner registers its own bridge via useAppBridge; when that pane
      // is eventually removed, its onIframeReady callback is stored in DockPane
      // for the next park cycle.
      return entry.iframe
    },

    has: (key) => entries.has(key),

    size: () => entries.size,

    dispose() {
      if (intervalId !== undefined) {
        clearInterval(intervalId)
        intervalId = undefined
      }
      for (const key of [...entries.keys()]) {
        evict(key)
      }
      if (host?.parentNode) {
        host.parentNode.removeChild(host)
        host = undefined
      }
    },
  }
}

/** Module-singleton pool used by dock.tsx. */
let singleton: IframePool | undefined

export function getIframePool(): IframePool {
  if (!singleton) singleton = createIframePool()
  return singleton
}
