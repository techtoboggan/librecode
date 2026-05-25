import { describe, expect, test, mock } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

/**
 * Phase 48 — SessionFileTreePanel unit tests.
 *
 * Full DOM render requires wrapping with useLanguage, useLayout,
 * useSync, and multiple other contexts. Instead we use the
 * "mirror function" pattern (spec §5b fallback): extract the pure
 * helpers for direct unit testing, and add source-level assertions
 * for structural correctness.
 */

// Pure helper: mirrors setFileTreeTabValue in the component
function setFileTreeTabValue(value: string, setTab: (v: "changes" | "all") => void): void {
  if (value !== "changes" && value !== "all") return
  setTab(value as "changes" | "all")
}

describe("setFileTreeTabValue", () => {
  test("calls setTab for 'changes'", () => {
    const spy = mock(() => {})
    setFileTreeTabValue("changes", spy)
    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy).toHaveBeenCalledWith("changes")
  })

  test("calls setTab for 'all'", () => {
    const spy = mock(() => {})
    setFileTreeTabValue("all", spy)
    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy).toHaveBeenCalledWith("all")
  })

  test("rejects unknown tab values — setTab is NOT called", () => {
    const spy = mock(() => {})
    setFileTreeTabValue("bogus", spy)
    expect(spy).toHaveBeenCalledTimes(0)
  })

  test("rejects empty string — setTab is NOT called", () => {
    const spy = mock(() => {})
    setFileTreeTabValue("", spy)
    expect(spy).toHaveBeenCalledTimes(0)
  })

  test("rejects mcp-app: prefixed values — setTab is NOT called", () => {
    const spy = mock(() => {})
    setFileTreeTabValue("mcp-app:server:uri", spy)
    expect(spy).toHaveBeenCalledTimes(0)
  })
})

describe("SessionFileTreePanel source assertions (Phase 48)", () => {
  const src = readFileSync(join(import.meta.dir, "session-file-tree-panel.tsx"), "utf8")

  test("exports SessionFileTreePanel as named export", () => {
    expect(src).toMatch(/export function SessionFileTreePanel/)
  })

  test("exports SessionFileTreePanelProps interface", () => {
    expect(src).toMatch(/export interface SessionFileTreePanelProps/)
  })

  test("has no createResource calls (ADR-006 danger zone safe)", () => {
    expect(src).not.toMatch(/createResource/)
  })

  test("handles fileOpen=false via aria-hidden and inert", () => {
    expect(src).toMatch(/aria-hidden=\{!props\.fileOpen\(\)\}/)
    expect(src).toMatch(/inert=\{!props\.fileOpen\(\)\}/)
  })

  test("uses props.treeWidth() for width style", () => {
    expect(src).toMatch(/width: props\.treeWidth\(\)/)
  })

  test("renders FileTree with allowed={props.diffFiles()} for changes tab", () => {
    expect(src).toMatch(/allowed=\{props\.diffFiles\(\)\}/)
  })

  test("has ResizeHandle with onCollapse=layout.fileTree.close", () => {
    expect(src).toMatch(/onCollapse=\{layout\.fileTree\.close\}/)
  })
})
