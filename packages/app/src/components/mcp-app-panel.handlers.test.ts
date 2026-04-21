import { describe, expect, mock, test } from "bun:test"
import {
  OPEN_LINK_ALLOWED_SCHEMES,
  createLogHandler,
  createOpenLinkHandler,
  isSafeOpenUrl,
} from "./mcp-app-panel"

/**
 * Tests for the AppBridge handlers added in v0.9.39:
 *   - onopenlink (ui/open-link) → host platform.openLink with scheme allowlist
 *   - onloggingmessage (notifications/message) → console with severity tag
 *
 * Lock the security-relevant scheme allowlist so a regression doesn't
 * silently let `javascript:` or `data:` URLs through.
 */

describe("OPEN_LINK_ALLOWED_SCHEMES", () => {
  test("only http and https — nothing else, ever", () => {
    expect(OPEN_LINK_ALLOWED_SCHEMES.has("http:")).toBe(true)
    expect(OPEN_LINK_ALLOWED_SCHEMES.has("https:")).toBe(true)
    expect(OPEN_LINK_ALLOWED_SCHEMES.size).toBe(2)
  })
})

describe("isSafeOpenUrl", () => {
  test("accepts standard web URLs", () => {
    expect(isSafeOpenUrl("https://example.com")).toBe(true)
    expect(isSafeOpenUrl("http://localhost:3000/path?q=1#frag")).toBe(true)
  })

  test("rejects dangerous schemes", () => {
    expect(isSafeOpenUrl("javascript:alert(1)")).toBe(false)
    expect(isSafeOpenUrl("data:text/html,<script>alert(1)</script>")).toBe(false)
    expect(isSafeOpenUrl("file:///etc/passwd")).toBe(false)
    expect(isSafeOpenUrl("blob:https://example.com/abc")).toBe(false)
    expect(isSafeOpenUrl("vbscript:msgbox")).toBe(false)
  })

  test("rejects malformed input without throwing", () => {
    expect(isSafeOpenUrl("not a url")).toBe(false)
    expect(isSafeOpenUrl("")).toBe(false)
    expect(isSafeOpenUrl("//example.com")).toBe(false)
  })
})

describe("createOpenLinkHandler", () => {
  test("opens safe URLs and returns success result", async () => {
    const open = mock<(url: string) => void>()
    const handler = createOpenLinkHandler(open)
    const result = await handler({ url: "https://example.com/foo" })
    expect(open).toHaveBeenCalledTimes(1)
    expect(open.mock.calls[0][0]).toBe("https://example.com/foo")
    expect(result.isError).toBeUndefined()
  })

  test("rejects unsafe URLs without invoking the opener", async () => {
    const open = mock<(url: string) => void>()
    const handler = createOpenLinkHandler(open)
    const result = await handler({ url: "javascript:alert(1)" })
    expect(open).toHaveBeenCalledTimes(0)
    expect(result.isError).toBe(true)
  })

  test("opener throw → isError result, no propagation", async () => {
    const open = mock<(url: string) => void>(() => {
      throw new Error("platform error")
    })
    const handler = createOpenLinkHandler(open)
    const result = await handler({ url: "https://example.com" })
    expect(result.isError).toBe(true)
  })
})

describe("createLogHandler", () => {
  function fakeConsole() {
    return { log: mock(), info: mock(), warn: mock(), error: mock() }
  }

  test("info-class levels go to console.info with [mcp-app:server] tag", () => {
    const c = fakeConsole()
    const handler = createLogHandler({ server: "acme", console: c })
    handler({ level: "debug", data: "d" })
    handler({ level: "info", data: "i" })
    handler({ level: "notice", data: "n" })
    expect(c.info).toHaveBeenCalledTimes(3)
    expect(c.info.mock.calls[0][0]).toBe("[mcp-app:acme]")
    expect(c.info.mock.calls[0][1]).toBe("d")
  })

  test("warning level goes to console.warn", () => {
    const c = fakeConsole()
    const handler = createLogHandler({ server: "acme", console: c })
    handler({ level: "warning", data: { msg: "be careful" } })
    expect(c.warn).toHaveBeenCalledTimes(1)
    expect(c.warn.mock.calls[0][0]).toBe("[mcp-app:acme]")
    expect(c.warn.mock.calls[0][1]).toEqual({ msg: "be careful" })
  })

  test("error and above all go to console.error", () => {
    const c = fakeConsole()
    const handler = createLogHandler({ server: "acme", console: c })
    handler({ level: "error", data: "e" })
    handler({ level: "critical", data: "c" })
    handler({ level: "alert", data: "a" })
    handler({ level: "emergency", data: "x" })
    expect(c.error).toHaveBeenCalledTimes(4)
  })

  test("includes the logger name when present", () => {
    const c = fakeConsole()
    const handler = createLogHandler({ server: "acme", console: c })
    handler({ level: "info", logger: "submodule", data: "hi" })
    expect(c.info.mock.calls[0][0]).toBe("[mcp-app:acme/submodule]")
  })
})
