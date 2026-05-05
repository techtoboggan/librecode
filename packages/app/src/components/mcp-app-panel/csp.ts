/**
 * Content Security Policy injection for MCP App iframes.
 *
 * Why this is in a `<meta>` tag rather than a real CSP header: WebkitGTK
 * doesn't let us intercept iframe response headers, so we rewrite the
 * HTML before assigning to `srcdoc`. The injected meta tag is honoured
 * by Chromium, Firefox, and WebkitGTK alike.
 */

/**
 * Default CSP injected into MCP App iframes.
 *
 * - `script-src 'unsafe-inline' 'unsafe-eval'` — most MCP apps are bundled
 *   single-file SPAs with no nonces; unsafe-eval required for some bundlers.
 * - `connect-src 'none'` — apps communicate exclusively through the AppBridge
 *   postMessage channel, not direct HTTP (security boundary).
 * - `frame-src 'none'` — no nested iframes.
 */
export const DEFAULT_CSP =
  "default-src 'none'; " +
  "script-src 'unsafe-inline' 'unsafe-eval'; " +
  "style-src 'unsafe-inline'; " +
  "img-src data: blob:; " +
  "font-src data: blob:; " +
  "connect-src 'none'; " +
  "frame-src 'none';"

export function injectCsp(html: string, csp: string): string {
  const metaTag = `<meta http-equiv="Content-Security-Policy" content="${csp.replace(/"/g, "&quot;")}">`
  // Insert after <head> if present, otherwise prepend a <head> block.
  if (/<head(\s[^>]*)?>/i.test(html)) {
    return html.replace(/(<head(\s[^>]*)?>)/i, `$1\n${metaTag}`)
  }
  return `<head>\n${metaTag}\n</head>\n${html}`
}
