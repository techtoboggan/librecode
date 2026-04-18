import { describe, expect, test } from "bun:test"
import { useMode } from "./mode"

describe("useMode fallback", () => {
  test("returns development mode when outside provider", () => {
    // useMode() provides a safe fallback when used outside ModeProvider
    const mode = useMode()
    expect(mode.mode()).toBe("development")
    expect(mode.isDev()).toBe(true)
    expect(mode.isProductivity()).toBe(false)
  })

  test("toggle is a no-op outside provider", () => {
    const mode = useMode()
    mode.toggle()
    expect(mode.mode()).toBe("development") // unchanged
  })

  test("set is a no-op outside provider", () => {
    const mode = useMode()
    mode.set("productivity")
    expect(mode.mode()).toBe("development") // unchanged
  })
})
