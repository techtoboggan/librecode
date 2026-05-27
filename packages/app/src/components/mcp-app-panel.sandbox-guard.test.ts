/**
 * Regression (v0.10.12) — sandboxed MCP-app iframe: no cross-frame access.
 *
 * The MCP-app iframe is `sandbox="allow-scripts"` with NO allow-same-origin,
 * so it runs at a null origin. Reading its document / location / frames from
 * the host throws a SecurityError in WebKitGTK (Tauri's REAL webview):
 *
 *   "Sandbox access violation: Blocked a frame at 'tauri://localhost' from
 *    accessing a frame at 'null'. The frame being accessed is sandboxed and
 *    lacks the 'allow-same-origin' flag."
 *
 * That thrown getter (`iframe.contentDocument.readyState`) aborted the bridge-
 * setup effect and broke the entire App Dock on the desktop build. Chromium
 * silently returns `null` for the same access, so browser-mode E2E (Chromium)
 * and the web preview never caught it — only the real WebKitGTK webview does.
 *
 * This is a pure SOURCE guard (no component import — importing the .tsx drags
 * in @solidjs/router, which throws under bun's server build). It makes the
 * forbidden cross-frame reads fail fast in Layer 1 CI rather than only in the
 * advisory Layer 3 tauri-mode run. `contentWindow` on its own is allowed — it
 * is the postMessage target; only reaching INTO the frame is forbidden.
 */

import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

const HOST_FILES = [
  "./mcp-app-panel.tsx",
  "./mcp-app-panel/state-relay.ts",
  "./mcp-app-panel/events.ts",
  "./mcp-app-panel/seed.ts",
]

// Property getters that throw a sandbox SecurityError on a null-origin frame.
// `.contentDocument` is the one that shipped the bug.
const FORBIDDEN: Array<[RegExp, string]> = [
  [/\.contentDocument\b/, ".contentDocument"],
  [/\.contentWindow\??\.(document|location)\b/, ".contentWindow.document / .location"],
  [/\.frames\[/, ".frames[…]"],
]

describe("sandboxed-iframe host never reads into the null-origin frame (WebKit-safe)", () => {
  for (const rel of HOST_FILES) {
    test(`${rel} avoids forbidden cross-frame document access`, () => {
      const path = fileURLToPath(new URL(rel, import.meta.url))
      const src = readFileSync(path, "utf8")
      // Strip comments so explanatory prose (which names these APIs on purpose)
      // doesn't trip the guard.
      const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "")
      for (const [pattern, label] of FORBIDDEN) {
        if (pattern.test(code)) {
          throw new Error(
            `${rel} reads ${label} on a sandboxed iframe — this throws a SecurityError in WebKitGTK ` +
              `and breaks the App Dock on the real desktop app. Track load state without touching the frame.`,
          )
        }
        expect(pattern.test(code)).toBe(false)
      }
    })
  }
})
