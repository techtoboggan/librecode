/**
 * Phase 52 Sub-A — regression guard for the v0.9.94→.95 raw-fetch auth audit.
 *
 * Root cause: five call sites in packages/app/src used raw `fetch()` with
 * a template-literal base URL. In web-browser mode they worked fine (no
 * auth gate). In Tauri desktop mode the server runs behind
 * `LIBRECODE_SERVER_PASSWORD` — raw `fetch()` bypasses the authed wrapper
 * and returns 401, which surfaces to the user as "TypeError: Load failed."
 *
 * Fix landed in v0.9.95: all internal API calls now go through
 * `globalSDK.fetch()` / `sdk.fetch()` which injects the `Authorization`
 * header on every request.
 *
 * This test is a static-analysis regression guard: it walks every
 * non-test `.ts/.tsx` file in packages/app/src/ and fails if it finds
 * a raw `fetch(\`${baseUrl}/...\`)` pattern that bypasses auth.
 *
 * Which layer would have caught this: Layer 1 (static-analysis guard).
 * The bug only triggers when LIBRECODE_SERVER_PASSWORD is set — the
 * exact production Tauri configuration unit tests never exercise.
 * This guard prevents the pattern from re-appearing silently.
 */

import { describe, test } from "bun:test"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"

/** Prefixes that indicate an authed wrapper is in use. */
const AUTHED_PREFIXES = ["globalSDK.fetch", "sdk.fetch", "platform.fetch", "fetchFn", "tauriPage.request"]

/**
 * Allowlist: patterns that are legitimately raw fetch() calls (not
 * calling the internal API) or internal plumbing inside the authed
 * wrapper itself.
 */
const KNOWN_EXTERNAL_PATTERNS = [
  /fetch\(endpoint,/, // local-server-wizard.tsx fetchModels — probes arbitrary user-supplied URLs
  /fetch\(input, init\)/, // global-sdk.tsx makeAuthedFetch — the internal wrapper implementation itself
]

function walk(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...walk(full))
    else if (full.endsWith(".tsx") || full.endsWith(".ts")) out.push(full)
  }
  return out
}

const SRC_ROOT = join(import.meta.dir, "..")

describe("v0.9.94→.95 raw-fetch auth audit", () => {
  test("no raw fetch(`${baseUrl}/...`) anywhere in packages/app/src", () => {
    const files = walk(SRC_ROOT).filter((f) => !f.includes(".test."))

    const violations: Array<{ file: string; line: number; text: string }> = []
    for (const file of files) {
      const lines = readFileSync(file, "utf8").split("\n")
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!
        if (!/\bfetch\(/.test(line)) continue
        if (AUTHED_PREFIXES.some((p) => line.includes(p))) continue
        if (KNOWN_EXTERNAL_PATTERNS.some((p) => p.test(line))) continue
        // Raw fetch with a template string starting with baseUrl/sdk.url/globalSDK.url
        if (/fetch\(`\$\{(baseUrl|sdk\.url|globalSDK\.url)/.test(line)) {
          violations.push({ file: file.replace(SRC_ROOT, ""), line: i + 1, text: line.trim() })
        }
      }
    }

    if (violations.length > 0) {
      const list = violations.map((v) => `  ${v.file}:${v.line}  ${v.text}`).join("\n")
      throw new Error(`Raw fetch() against the librecode API (will 401 on Tauri prod):\n${list}`)
    }
  })
})
