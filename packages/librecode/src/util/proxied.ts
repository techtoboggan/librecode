/**
 * Detect whether the current process is configured to route HTTP traffic
 * through a corporate / VPN proxy.
 *
 * This is a DETECTOR only — the actual proxying happens transparently:
 *   - Bun's native `fetch()` honors HTTP_PROXY/HTTPS_PROXY/NO_PROXY
 *     automatically (https://bun.sh/docs/api/fetch#proxy-support).
 *     Every fetch() call in LibreCode therefore proxies correctly
 *     without per-call configuration. That covers the AI SDK provider
 *     traffic, MCP transport over HTTP, our /provider/scan calls,
 *     the models.dev snapshot fetch — everything.
 *   - Subprocess spawns (`Process.run`, `BunProc.run`, MCP stdio
 *     transports) inherit `process.env`, so git fetches, npm installs
 *     during plugin installation, and MCP server children all see
 *     the proxy variables.
 *
 * Phase 40 audit: confirmed end-to-end coverage. No special-case code
 * paths needed.
 *
 * The detector exists for places that need to BEHAVE differently when
 * a proxy is in use — currently just `bun install --no-cache` (per
 * upstream bug where Bun's install cache + a proxy can hang) and CI
 * environments.
 */
export function proxied(): boolean {
  return !!(process.env.HTTP_PROXY || process.env.HTTPS_PROXY || process.env.http_proxy || process.env.https_proxy)
}
