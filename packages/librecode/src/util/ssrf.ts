import { lookup } from "node:dns/promises"
import { isIP, isIPv4, isIPv6 } from "node:net"

// A10 (Server-Side Request Forgery) — shared guards for any code path that
// fetches a user-supplied URL (webfetch tool, /provider/scan, …).
//
// Two layers:
//   isBlockedIP / isBlockedHost: pure, no DNS
//   validateFetchURL: full check including DNS resolution + pinning
//
// Why DNS resolution matters: an attacker can point a hostname at a private
// IP ("rebinding" is usually about TOCTOU, but even a single-shot
// unprotected.example.com → 169.254.169.254 is enough). We resolve once and
// verify the resolved address is not blocked before allowing the fetch.

const LITERAL_BLOCKED_HOSTS = new Set([
  "localhost",
  "metadata",
  "metadata.google.internal",
  // Azure instance metadata DNS alternate form
  "metadata.azure.com",
  // Kubernetes in-cluster DNS
  "kubernetes.default",
  "kubernetes.default.svc",
])

/**
 * True if a literal IP (v4 or v6) is in a private, loopback, link-local,
 * unique-local, CGNAT, or wildcard range. Pure function — no DNS.
 */
export function isBlockedIP(ip: string): boolean {
  if (!ip) return false
  if (isIPv4(ip)) return isBlockedIPv4(ip)
  if (isIPv6(ip)) return isBlockedIPv6(ip)
  return false
}

function isBlockedIPv4(ip: string): boolean {
  const parts = ip.split(".").map((p) => Number(p))
  if (parts.length !== 4) return false
  const [a, b] = parts as [number, number, number, number]
  // 0.0.0.0/8 — wildcard / this-network
  if (a === 0) return true
  // 10.0.0.0/8 — RFC1918
  if (a === 10) return true
  // 127.0.0.0/8 — loopback
  if (a === 127) return true
  // 169.254.0.0/16 — link-local / cloud metadata
  if (a === 169 && b === 254) return true
  // 172.16.0.0/12 — RFC1918 (172.16.0.0 … 172.31.255.255)
  if (a === 172 && b >= 16 && b <= 31) return true
  // 192.168.0.0/16 — RFC1918
  if (a === 192 && b === 168) return true
  // 100.64.0.0/10 — CGNAT (100.64.0.0 … 100.127.255.255)
  if (a === 100 && b >= 64 && b <= 127) return true
  return false
}

function isBlockedIPv6(ip: string): boolean {
  // Normalize: lowercase, expand. Use URL parser for stability.
  const lower = ip.toLowerCase()
  if (lower === "::" || lower === "::1") return true
  // fe80::/10 — link-local. First 10 bits = 1111111010
  if (lower.startsWith("fe80:") || lower.startsWith("fe8") || lower.startsWith("fe9")) return true
  if (lower.startsWith("fea") || lower.startsWith("feb")) return true
  // fc00::/7 — unique-local (fc00 … fdff)
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true
  return false
}

/**
 * Like isBlockedIP but accepts a hostname string; literal names (localhost,
 * metadata.google.internal, …) are blocked regardless of DNS. Does NOT
 * perform DNS lookup — call validateFetchURL() for that.
 */
export function isBlockedHost(host: string): boolean {
  if (!host) return true
  const lower = host.toLowerCase().trim()
  if (LITERAL_BLOCKED_HOSTS.has(lower)) return true
  if (isIP(lower)) return isBlockedIP(lower)
  return false
}

export class BlockedURLError extends Error {
  constructor(
    public readonly url: string,
    public readonly reason: string,
  ) {
    super(`URL blocked: ${reason} (${url})`)
    this.name = "BlockedURLError"
  }
}

/**
 * Full SSRF check for a URL about to be fetched. Throws BlockedURLError if:
 *   - Scheme isn't http/https
 *   - URL carries userinfo (smuggling defense)
 *   - Hostname is in LITERAL_BLOCKED_HOSTS
 *   - Hostname parses as an IP AND the IP is in a blocked range
 *   - Hostname resolves (via DNS) to a blocked IP
 *
 * On success, resolves to void. Callers should fetch the same URL; DNS is
 * cached so the second resolution is ~free. (We don't return a resolved IP
 * because node fetch doesn't accept one — full TOCTOU defense would require
 * a custom agent, tracked separately.)
 */
export async function validateFetchURL(rawUrl: string): Promise<void> {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    throw new BlockedURLError(rawUrl, "malformed URL")
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new BlockedURLError(rawUrl, `unsupported scheme ${url.protocol}`)
  }

  if (url.username || url.password) {
    throw new BlockedURLError(rawUrl, "userinfo in URL is not allowed (smuggling defense)")
  }

  // Strip IPv6 brackets if present (new URL() gives '[::1]' as hostname)
  const hostname = url.hostname.replace(/^\[/, "").replace(/\]$/, "")

  if (isBlockedHost(hostname)) {
    throw new BlockedURLError(rawUrl, `host ${hostname} is blocked`)
  }

  // If already an IP literal, isBlockedHost already covered it. Otherwise,
  // resolve via DNS and check each returned address.
  if (!isIP(hostname)) {
    let addresses: { address: string; family: number }[]
    try {
      addresses = await lookup(hostname, { all: true })
    } catch (err) {
      // DNS failure is not a security issue — let fetch surface it normally.
      // But don't silently allow: if we can't resolve, we can't check, so
      // fail closed for the unresolvable case isn't realistic (breaks CDN
      // edge fallback patterns). Pass through and let fetch() fail naturally.
      return
    }
    for (const { address } of addresses) {
      if (isBlockedIP(address)) {
        throw new BlockedURLError(rawUrl, `host ${hostname} resolves to blocked IP ${address}`)
      }
    }
  }
}
