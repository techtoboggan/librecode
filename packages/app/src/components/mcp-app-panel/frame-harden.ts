/**
 * frame-harden — make a null-origin sandboxed iframe safe for third-party
 * focus utilities to walk in WebKitGTK.
 *
 * The v0.10.x dock crash: @kobalte/utils focus helpers (getAllTabbableIn,
 * getActiveElement) walk the document and descend into iframes via
 * `iframe.contentDocument.body`. Kobalte runs this on EVERY overlay open —
 * menu, tooltip, popover, dialog — so interacting anywhere near the dock
 * triggered it. On our `sandbox="allow-scripts"` (null-origin, NO
 * allow-same-origin) MCP-app iframe, WebKitGTK — Tauri's real webview — THROWS
 * a SecurityError on that access ("Sandbox access violation: Blocked a frame at
 * 'tauri://localhost' from accessing a frame at 'null'…"). Chromium returns
 * null instead, so the same code is harmless there — which is exactly why every
 * Chromium-based test layer (browser-mode E2E, web preview) passed while the
 * real desktop app's dock never rendered (the throw escaped the Solid effect
 * that opened the overlay).
 *
 * Fix: define an own `contentDocument` getter on the element that returns null —
 * precisely what Chromium effectively yields for this isolation level. Both
 * Kobalte paths gate on `&& contentDocument` truthiness, so null makes them
 * short-circuit; the `.body` descent (and the throw) never happen. This
 * neutralizes ANY focus walker, present or future, not a single call site.
 *
 * We never need real `contentDocument` here: the frame is intentionally
 * null-origin and the host talks to it over postMessage via `contentWindow`,
 * which is deliberately left untouched.
 */

const HARDENED = new WeakSet<HTMLIFrameElement>()

export function hardenSandboxedFrame(iframe: HTMLIFrameElement): void {
  if (HARDENED.has(iframe)) return
  try {
    Object.defineProperty(iframe, "contentDocument", { configurable: true, get: () => null })
    HARDENED.add(iframe)
  } catch {
    // defineProperty cannot fail on an extensible element in practice; if it
    // ever does, fall back to prior behavior rather than crash the caller.
  }
}
