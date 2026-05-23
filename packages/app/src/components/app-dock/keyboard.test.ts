import { describe, expect, test } from "bun:test"
import { makeDockKeyHandler } from "./keyboard"

/**
 * Tests for the dock keyboard handler logic.
 * Uses the exported pure factory `makeDockKeyHandler` so no Solid reactive
 * root or context mock is needed — the handler just calls a toggle function.
 */

function fire(handler: (e: KeyboardEvent) => void, key: string, mods: Partial<KeyboardEventInit> = {}): boolean {
  let prevented = false
  const e = new KeyboardEvent("keydown", {
    key,
    ctrlKey: mods.ctrlKey ?? false,
    metaKey: mods.metaKey ?? false,
    altKey: mods.altKey ?? false,
    shiftKey: mods.shiftKey ?? false,
    bubbles: true,
  })
  Object.defineProperty(e, "preventDefault", {
    value: () => {
      prevented = true
    },
    writable: false,
  })
  handler(e)
  return prevented
}

describe("makeDockKeyHandler", () => {
  test("Ctrl+\\ calls toggle once", () => {
    let count = 0
    const handler = makeDockKeyHandler(() => count++)
    fire(handler, "\\", { ctrlKey: true })
    expect(count).toBe(1)
  })

  test("Ctrl+\\ called twice increments twice", () => {
    let count = 0
    const handler = makeDockKeyHandler(() => count++)
    fire(handler, "\\", { ctrlKey: true })
    fire(handler, "\\", { ctrlKey: true })
    expect(count).toBe(2)
  })

  test("Ctrl+K does not call toggle", () => {
    let count = 0
    const handler = makeDockKeyHandler(() => count++)
    fire(handler, "k", { ctrlKey: true })
    expect(count).toBe(0)
  })

  test("Alt+\\ does not call toggle", () => {
    let count = 0
    const handler = makeDockKeyHandler(() => count++)
    fire(handler, "\\", { altKey: true })
    expect(count).toBe(0)
  })

  test("bare \\ (no modifier) does not call toggle", () => {
    let count = 0
    const handler = makeDockKeyHandler(() => count++)
    fire(handler, "\\")
    expect(count).toBe(0)
  })

  test("Ctrl+\\ prevents default", () => {
    const handler = makeDockKeyHandler(() => {})
    const prevented = fire(handler, "\\", { ctrlKey: true })
    expect(prevented).toBe(true)
  })

  test("Ctrl+K does not prevent default", () => {
    const handler = makeDockKeyHandler(() => {})
    const prevented = fire(handler, "k", { ctrlKey: true })
    expect(prevented).toBe(false)
  })
})
