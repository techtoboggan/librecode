import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

// Phase 48 regression: the dead tabs().open("mcp-app:...") call in the
// pin handler was removed. This test ensures it doesn't come back.
test("session-header.tsx has no mcp-app: tab-open call after Phase 48", () => {
  const src = readFileSync(join(import.meta.dir, "session-header.tsx"), "utf8")
  expect(src).not.toMatch(/tabs\(\)\.open.*mcp-app:/)
  expect(src).not.toMatch(/`mcp-app:/)
  // batch() was only used to wrap the now-deleted pin+open pair; confirm gone
  expect(src).not.toMatch(/\bbatch\(/)
})
