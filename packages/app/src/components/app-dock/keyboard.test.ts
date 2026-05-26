import { describe, expect, test } from "bun:test"
import { makeDockKeyHandler, makeDetachKeyHandler, makePaneFocusKeyHandler } from "./keyboard"

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

// ── Phase 50: makePaneFocusKeyHandler ─────────────────────────────────────────

describe("makePaneFocusKeyHandler", () => {
  test("Ctrl+Shift+1 fires focusPane(0)", () => {
    let focused = -1
    const handler = makePaneFocusKeyHandler(
      (idx) => {
        focused = idx
      },
      () => {},
    )
    fire(handler, "1", { ctrlKey: true, shiftKey: true })
    expect(focused).toBe(0)
  })

  test("Ctrl+Shift+9 fires focusPane(8)", () => {
    let focused = -1
    const handler = makePaneFocusKeyHandler(
      (idx) => {
        focused = idx
      },
      () => {},
    )
    fire(handler, "9", { ctrlKey: true, shiftKey: true })
    expect(focused).toBe(8)
  })

  test("Ctrl+Shift+0 fires focusMain()", () => {
    let mainFocused = false
    const handler = makePaneFocusKeyHandler(
      () => {},
      () => {
        mainFocused = true
      },
    )
    fire(handler, "0", { ctrlKey: true, shiftKey: true })
    expect(mainFocused).toBe(true)
  })

  test("Ctrl+1 (no Shift) is a no-op", () => {
    let called = false
    const handler = makePaneFocusKeyHandler(
      () => {
        called = true
      },
      () => {
        called = true
      },
    )
    fire(handler, "1", { ctrlKey: true })
    expect(called).toBe(false)
  })

  test("Shift+1 (no Ctrl) is a no-op", () => {
    let called = false
    const handler = makePaneFocusKeyHandler(
      () => {
        called = true
      },
      () => {
        called = true
      },
    )
    fire(handler, "1", { shiftKey: true })
    expect(called).toBe(false)
  })

  test("Ctrl+Shift+1 prevents default", () => {
    const handler = makePaneFocusKeyHandler(
      () => {},
      () => {},
    )
    const prevented = fire(handler, "1", { ctrlKey: true, shiftKey: true })
    expect(prevented).toBe(true)
  })

  test("Mac: Cmd+Shift+1 fires focusPane(0)", () => {
    // Temporarily spoof navigator.platform to "MacIntel"
    const savedPlatform = navigator.platform
    Object.defineProperty(navigator, "platform", { value: "MacIntel", configurable: true })

    let focused = -1
    const handler = makePaneFocusKeyHandler(
      (idx) => {
        focused = idx
      },
      () => {},
    )
    fire(handler, "1", { metaKey: true, shiftKey: true })
    expect(focused).toBe(0)

    // Restore — always restore by value (getOwnPropertyDescriptor is undefined when on prototype)
    Object.defineProperty(navigator, "platform", { value: savedPlatform, configurable: true })
  })

  test("Mac: Ctrl+Shift+1 is a no-op (must use Cmd on Mac)", () => {
    const savedPlatform = navigator.platform
    Object.defineProperty(navigator, "platform", { value: "MacIntel", configurable: true })

    let called = false
    const handler = makePaneFocusKeyHandler(
      () => {
        called = true
      },
      () => {
        called = true
      },
    )
    fire(handler, "1", { ctrlKey: true, shiftKey: true })
    expect(called).toBe(false)

    Object.defineProperty(navigator, "platform", { value: savedPlatform, configurable: true })
  })
})

// ── Phase 50: makeDetachKeyHandler ────────────────────────────────────────────

describe("makeDetachKeyHandler", () => {
  test("Ctrl+Shift+D is a no-op when getActiveURI returns undefined", () => {
    let detached: string | undefined
    const handler = makeDetachKeyHandler(
      () => undefined,
      (uri) => {
        detached = uri
      },
    )
    fire(handler, "d", { ctrlKey: true, shiftKey: true })
    expect(detached).toBeUndefined()
  })

  test("Ctrl+Shift+D calls detach(uri) when a pane is focused", () => {
    let detached: string | undefined
    const handler = makeDetachKeyHandler(
      () => "ui://test/pane",
      (uri) => {
        detached = uri
      },
    )
    fire(handler, "d", { ctrlKey: true, shiftKey: true })
    expect(detached).toBe("ui://test/pane")
  })

  test("Ctrl+Shift+D works with uppercase D key", () => {
    let detached: string | undefined
    const handler = makeDetachKeyHandler(
      () => "ui://test/pane",
      (uri) => {
        detached = uri
      },
    )
    fire(handler, "D", { ctrlKey: true, shiftKey: true })
    expect(detached).toBe("ui://test/pane")
  })

  test("Ctrl+D (no Shift) is a no-op", () => {
    let called = false
    const handler = makeDetachKeyHandler(
      () => "ui://x",
      () => {
        called = true
      },
    )
    fire(handler, "d", { ctrlKey: true })
    expect(called).toBe(false)
  })
})
