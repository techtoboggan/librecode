// A07 (Identification and Authentication Failures) — token-bucket rate
// limiter for basic-auth. 10 failed attempts per 5 minutes per source IP
// ⇒ 429. Successful auth clears the bucket.
//
// Local-first product: we keep state in-memory. A Redis-backed variant
// would be overkill. Memory grows linearly with distinct attacker IPs;
// periodic cleanup reaps expired entries to keep growth bounded.

export interface RateLimitOptions {
  /** Max allowed attempts inside the rolling window. */
  maxAttempts: number
  /** Rolling window length in ms. */
  windowMs: number
}

export interface RateLimitResult {
  allowed: boolean
  /** If !allowed, seconds until a retry would succeed. */
  retryAfterSec: number
  /** Current attempt count (useful for logging). */
  count: number
}

interface Bucket {
  /** Timestamps of attempts within the window. */
  timestamps: number[]
}

export interface RateLimiter {
  /** Record an attempt and return whether it is allowed to proceed. */
  check(key: string): RateLimitResult
  /** Clear the bucket for `key` (e.g. after a successful authentication). */
  success(key: string): void
  /** Remove expired buckets. */
  cleanup(): void
  /** Current bucket count — for tests and /metrics. */
  size(): number
}

export function createRateLimiter(opts: RateLimitOptions): RateLimiter {
  const buckets = new Map<string, Bucket>()

  function prune(bucket: Bucket, now: number): void {
    const cutoff = now - opts.windowMs
    while (bucket.timestamps.length > 0 && bucket.timestamps[0]! < cutoff) {
      bucket.timestamps.shift()
    }
  }

  return {
    check(key) {
      const now = Date.now()
      let bucket = buckets.get(key)
      if (!bucket) {
        bucket = { timestamps: [] }
        buckets.set(key, bucket)
      }
      prune(bucket, now)
      if (bucket.timestamps.length >= opts.maxAttempts) {
        const oldest = bucket.timestamps[0]!
        const retryAfterMs = oldest + opts.windowMs - now
        return {
          allowed: false,
          retryAfterSec: Math.max(1, Math.ceil(retryAfterMs / 1000)),
          count: bucket.timestamps.length,
        }
      }
      bucket.timestamps.push(now)
      return { allowed: true, retryAfterSec: 0, count: bucket.timestamps.length }
    },
    success(key) {
      buckets.delete(key)
    },
    cleanup() {
      const now = Date.now()
      for (const [key, bucket] of buckets) {
        prune(bucket, now)
        if (bucket.timestamps.length === 0) buckets.delete(key)
      }
    },
    size() {
      return buckets.size
    },
  }
}

/**
 * Redact the last IP segment for pseudonymised logging. Reserves the
 * network prefix so a pattern analyst can still spot a flood from a
 * subnet, without recording identifiable addresses.
 *
 * 192.168.1.100 → "192.168.1.*"
 * 2001:db8:abcd:1234::1 → "2001:db8:abcd:1234:::*"
 */
export function redactIp(ip: string): string {
  if (ip.includes(":")) {
    // IPv6: chop off the last ':<segment>'
    const idx = ip.lastIndexOf(":")
    if (idx < 0) return ip
    return ip.slice(0, idx) + ":*"
  }
  // IPv4: replace last '.segment'
  const idx = ip.lastIndexOf(".")
  if (idx < 0) return ip
  return ip.slice(0, idx) + ".*"
}
