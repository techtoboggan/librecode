import { describe, expect, test } from "bun:test"
import { buildThemeCss, injectTheme } from "./mcp-app-panel"

describe("buildThemeCss", () => {
  test("emits :root block with all supplied tokens", () => {
    const css = buildThemeCss({
      "--lc-bg": "#121212",
      "--lc-text": "#f1ece8",
      "--lc-border": "#282828",
    })
    expect(css).toContain(":root {")
    expect(css).toContain("--lc-bg: #121212;")
    expect(css).toContain("--lc-text: #f1ece8;")
    expect(css).toContain("--lc-border: #282828;")
  })

  test("injects body fallbacks so apps without theme-aware styles still inherit the host palette", () => {
    const css = buildThemeCss({ "--lc-bg": "#fff", "--lc-text": "#000" })
    expect(css).toContain("background: var(--lc-bg")
    expect(css).toContain("color: var(--lc-text")
    // color-scheme is important for form controls/scrollbars to adapt
    expect(css).toContain("color-scheme: light dark")
  })

  test("empty token map still produces valid CSS (apps work with just fallbacks)", () => {
    const css = buildThemeCss({})
    expect(css).toContain(":root {")
    expect(css).toContain("background: var(--lc-bg, transparent)")
    expect(css).toContain("color: var(--lc-text, inherit)")
  })
})

describe("injectTheme", () => {
  test("inserts the theme style tag after <head>", () => {
    const html = "<!doctype html><html><head><title>App</title></head><body></body></html>"
    const out = injectTheme(html, { "--lc-bg": "#000" })
    expect(out).toContain("<title>App</title>")
    expect(out).toContain("--lc-bg: #000;")
    // Theme block comes right after opening <head>, before title
    expect(out.indexOf("--lc-bg")).toBeLessThan(out.indexOf("<title>"))
  })

  test("creates a <head> block if none exists", () => {
    const html = "<html><body>no head</body></html>"
    const out = injectTheme(html, { "--lc-bg": "#f5f5f5" })
    expect(out).toContain("<head>")
    expect(out).toContain("--lc-bg: #f5f5f5;")
  })

  test("preserves the original <body> content", () => {
    const html = '<html><head></head><body><div id="app">original</div></body></html>'
    const out = injectTheme(html, { "--lc-text": "#fff" })
    expect(out).toContain('<div id="app">original</div>')
  })
})
