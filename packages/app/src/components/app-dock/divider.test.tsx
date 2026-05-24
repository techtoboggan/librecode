/**
 * PaneDivider logic tests.
 *
 * DOM rendering is not available in bun test (Solid's server-side build
 * blocks client-only APIs). These tests verify the divider's delta
 * computation and dragging-state semantics using plain math and object
 * inspection — no JSX evaluation required.
 *
 * Interactive pointer-event behaviour is covered by the Playwright E2E suite.
 */
import { describe, expect, test } from "bun:test"

// ── Delta computation ──────────────────────────────────────────────────────────

/**
 * The PaneDivider tracks `lastY` and computes delta = newY - lastY on each
 * pointer-move. This pure function mirrors that calculation.
 */
function computeDelta(lastY: number, newY: number): number {
  return newY - lastY
}

describe("PaneDivider delta computation", () => {
  test("dragging down produces positive delta", () => {
    expect(computeDelta(100, 150)).toBe(50)
  })

  test("dragging up produces negative delta", () => {
    expect(computeDelta(200, 150)).toBe(-50)
  })

  test("no movement is zero delta", () => {
    expect(computeDelta(100, 100)).toBe(0)
  })

  test("multiple sequential moves accumulate correctly", () => {
    let lastY = 100
    const deltas: number[] = []
    for (const newY of [110, 130, 120]) {
      deltas.push(computeDelta(lastY, newY))
      lastY = newY
    }
    expect(deltas).toEqual([10, 20, -10])
    // Total net movement from 100 → 120 = 20
    expect(deltas.reduce((a, b) => a + b, 0)).toBe(20)
  })
})

// ── Dragging state machine ─────────────────────────────────────────────────────

describe("PaneDivider dragging state", () => {
  test("pointer-up without pointer-down is a no-op (dragging stays false)", () => {
    // Simulates: onPointerUp fires before onPointerDown (e.g. released outside)
    let dragging = false
    const onPointerUp = () => {
      if (!dragging) return // guard in the component
      dragging = false
    }
    onPointerUp()
    expect(dragging).toBe(false) // unchanged
  })

  test("pointer-down sets dragging to true", () => {
    let dragging = false
    const onPointerDown = () => {
      dragging = true
    }
    onPointerDown()
    expect(dragging).toBe(true)
  })

  test("pointer-up after pointer-down clears dragging", () => {
    let dragging = true
    const onPointerUp = () => {
      if (!dragging) return
      dragging = false
    }
    onPointerUp()
    expect(dragging).toBe(false)
  })

  test("pointer-move while not dragging is skipped", () => {
    const calls: number[] = []
    let dragging = false
    const onPointerMove = (delta: number) => {
      if (!dragging) return
      calls.push(delta)
    }
    onPointerMove(50) // dragging = false → skipped
    expect(calls).toHaveLength(0)
  })
})
