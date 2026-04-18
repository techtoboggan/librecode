import { describe, expect, test } from "bun:test"
import { iconNames } from "./types"

describe("app icon types", () => {
  test("includes platform-specific file manager icons", () => {
    expect(iconNames).toContain("finder") // macOS
    expect(iconNames).toContain("file-explorer") // Windows
    expect(iconNames).toContain("files") // Linux (generic)
  })

  test("includes common editors", () => {
    expect(iconNames).toContain("vscode")
    expect(iconNames).toContain("cursor")
    expect(iconNames).toContain("zed")
  })

  test("includes terminals", () => {
    expect(iconNames).toContain("terminal")
    expect(iconNames).toContain("ghostty")
    expect(iconNames).toContain("iterm2")
  })

  test("no duplicates", () => {
    const unique = new Set(iconNames)
    expect(unique.size).toBe(iconNames.length)
  })
})
