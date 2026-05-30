import { describe, expect, test } from "bun:test"
import { wsUpgradeAuthorized } from "../../src/server/server.ts"

// Regression — the desktop terminal's PTY WebSocket 401'd its handshake because
// the client passed Basic-auth creds via WS URL userinfo (`ws://user:pass@host`)
// and WebKitGTK (the Tauri webview) drops userinfo on WebSocket handshakes
// (Chromium doesn't). Fix: the client also sends `?token=`, and the server
// accepts it — but ONLY for the upgrade handshake, never for ordinary routes.
// Verified end-to-end against the real sidecar binary: WS upgrade + correct
// ?token → reaches the route (not 401); missing/wrong token or non-upgrade
// request → 401.

const PASSWORD = "s3cr3t-token-value"

describe("wsUpgradeAuthorized", () => {
  test("accepts a WebSocket upgrade with the correct token", () => {
    expect(wsUpgradeAuthorized("websocket", PASSWORD, PASSWORD)).toBe(true)
  })

  test("is case-insensitive on the Upgrade header", () => {
    expect(wsUpgradeAuthorized("WebSocket", PASSWORD, PASSWORD)).toBe(true)
  })

  test("rejects a WebSocket upgrade with the wrong token", () => {
    expect(wsUpgradeAuthorized("websocket", "wrong", PASSWORD)).toBe(false)
  })

  test("rejects when the token is missing", () => {
    expect(wsUpgradeAuthorized("websocket", undefined, PASSWORD)).toBe(false)
    expect(wsUpgradeAuthorized("websocket", null, PASSWORD)).toBe(false)
    expect(wsUpgradeAuthorized("websocket", "", PASSWORD)).toBe(false)
  })

  test("does NOT authorize a non-upgrade request even with a correct token", () => {
    // The bypass must be gated to the WS handshake — never a credential channel
    // for ordinary HTTP routes (those still require basic-auth).
    expect(wsUpgradeAuthorized(undefined, PASSWORD, PASSWORD)).toBe(false)
    expect(wsUpgradeAuthorized(null, PASSWORD, PASSWORD)).toBe(false)
    expect(wsUpgradeAuthorized("", PASSWORD, PASSWORD)).toBe(false)
    expect(wsUpgradeAuthorized("h2c", PASSWORD, PASSWORD)).toBe(false)
  })

  test("token length mismatch is rejected (timing-safe compare guards length)", () => {
    expect(wsUpgradeAuthorized("websocket", PASSWORD + "x", PASSWORD)).toBe(false)
    expect(wsUpgradeAuthorized("websocket", PASSWORD.slice(0, -1), PASSWORD)).toBe(false)
  })
})
