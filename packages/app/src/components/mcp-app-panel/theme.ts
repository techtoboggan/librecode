/**
 * Theme token sync between the host and MCP App iframes.
 *
 * Tokens are forwarded into iframes as CSS custom properties on `:root`.
 * Built-in apps (and cooperating MCP apps) can style themselves via
 * `var(--lc-bg)`, `var(--lc-text)`, etc. Without this, apps look like they
 * don't belong to the host — hardcoded dark colors that clash with light
 * mode, wrong borders, etc.
 *
 * Kept small on purpose: the app owns its own layout; the host just gives
 * it the palette.
 */

const THEME_TOKENS = [
  ["--lc-bg", "--background-base"],
  ["--lc-bg-subtle", "--background-subtle"],
  ["--lc-bg-raised", "--surface-raised-base"],
  ["--lc-bg-panel", "--surface-panel"],
  ["--lc-text", "--text-base"],
  ["--lc-text-strong", "--text-strong"],
  ["--lc-text-weak", "--text-weak"],
  ["--lc-text-weaker", "--text-weaker"],
  ["--lc-border", "--border-weak-base"],
  ["--lc-border-weaker", "--border-weaker-base"],
  ["--lc-accent", "--text-accent"],
  ["--lc-danger", "--text-danger"],
] as const

export function readThemeTokens(): Record<string, string> {
  if (typeof document === "undefined") return {}
  const style = getComputedStyle(document.documentElement)
  const out: Record<string, string> = {}
  for (const [appVar, hostVar] of THEME_TOKENS) {
    const value = style.getPropertyValue(hostVar).trim()
    if (value) out[appVar] = value
  }
  return out
}

export function buildThemeCss(tokens: Record<string, string>): string {
  const vars = Object.entries(tokens)
    .map(([k, v]) => `  ${k}: ${v};`)
    .join("\n")
  // Inject defaults so the iframe inherits the host look even if the app's
  // own stylesheet doesn't reference the vars explicitly. body fallbacks to
  // --lc-bg / --lc-text; html is transparent so the host container shows
  // through during the CSP-enforced srcdoc load.
  return `<style>
:root {
${vars}
}
html, body {
  background: var(--lc-bg, transparent);
  color: var(--lc-text, inherit);
  color-scheme: light dark;
}
</style>`
}

export function injectTheme(html: string, tokens: Record<string, string>): string {
  const styleTag = buildThemeCss(tokens)
  if (/<head[\s>]/i.test(html)) {
    return html.replace(/(<head(\s[^>]*)?>)/i, `$1\n${styleTag}`)
  }
  return `<head>\n${styleTag}\n</head>\n${html}`
}
