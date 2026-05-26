import { onCleanup, onMount } from "solid-js"
import { useAppDockState } from "./use-dock-state"

/**
 * Pure factory: builds the keydown handler for the dock toggle shortcut.
 * Extracted so keyboard.test.ts can test the handler logic without a
 * Solid reactive root or context mock.
 */
export function makeDockKeyHandler(toggle: () => void): (e: KeyboardEvent) => void {
  return (e: KeyboardEvent) => {
    const isMac = typeof navigator !== "undefined" && navigator.platform.startsWith("Mac")
    const modifier = isMac ? e.metaKey : e.ctrlKey
    if (!modifier) return
    if (e.key !== "\\") return
    e.preventDefault()
    toggle()
  }
}

/**
 * Phase 50 — handler for Ctrl+Shift+1..9 (focus Nth pane) and
 * Ctrl+Shift+0 (return focus to session main).
 */
export function makePaneFocusKeyHandler(
  focusPane: (idx: number) => void,
  focusMain: () => void,
): (e: KeyboardEvent) => void {
  return (e: KeyboardEvent) => {
    const isMac = typeof navigator !== "undefined" && navigator.platform.startsWith("Mac")
    const modifier = isMac ? e.metaKey : e.ctrlKey
    if (!modifier || !e.shiftKey) return
    if (e.key === "0") {
      e.preventDefault()
      focusMain()
      return
    }
    if (e.key >= "1" && e.key <= "9") {
      e.preventDefault()
      focusPane(parseInt(e.key, 10) - 1)
    }
  }
}

/**
 * Phase 50 — handler for Ctrl+Shift+D (detach the currently focused pane).
 * `getActiveURI` returns the URI of the pane whose header is focused,
 * or undefined if no pane is focused.
 */
export function makeDetachKeyHandler(
  getActiveURI: () => string | undefined,
  detach: (uri: string) => void,
): (e: KeyboardEvent) => void {
  return (e: KeyboardEvent) => {
    const isMac = typeof navigator !== "undefined" && navigator.platform.startsWith("Mac")
    const modifier = isMac ? e.metaKey : e.ctrlKey
    if (!modifier || !e.shiftKey) return
    if (e.key !== "D" && e.key !== "d") return
    const uri = getActiveURI()
    if (!uri) return
    e.preventDefault()
    detach(uri)
  }
}

/**
 * Wire the global Ctrl+\ (Cmd+\ on Mac) shortcut to toggle the dock.
 * Call this inside a component that is mounted inside <AppDockProvider>.
 * Pure side-effect; no return value.
 */
export function useDockToggleShortcut(): void {
  const dock = useAppDockState()
  onMount(() => {
    const onKey = makeDockKeyHandler(dock.toggle)
    window.addEventListener("keydown", onKey)
    onCleanup(() => window.removeEventListener("keydown", onKey))
  })
}

/**
 * Phase 50 — Wire Ctrl+Shift+1..9 / Ctrl+Shift+0 / Ctrl+Shift+D shortcuts.
 *
 * - Ctrl+Shift+1 focuses the 1st dock pane header.
 * - Ctrl+Shift+9 focuses the 9th (last if fewer than 9).
 * - Ctrl+Shift+0 returns focus to the session main area.
 * - Ctrl+Shift+D detaches the currently focused pane (desktop-only; no-op on web
 *   because the dock.detach call is no-op when openDetachedWindow is absent).
 *
 * Must be called inside a component mounted inside <AppDockProvider>.
 */
export function useDockPaneKeyboardShortcuts(): void {
  const dock = useAppDockState()

  const focusPane = (idx: number): void => {
    const entries = dock.state().entries
    const target = entries[idx]
    if (!target) return
    const el = document.querySelector<HTMLElement>(`[data-testid="pane-header-${target.uri}"]`)
    el?.focus()
  }

  const focusMain = (): void => {
    const el = document.querySelector<HTMLElement>("[data-testid='session-main']")
    el?.focus()
  }

  const getActiveURI = (): string | undefined => {
    const active = document.activeElement
    if (!active) return undefined
    // pane headers have data-uri set on them (see pane-header.tsx)
    return active.getAttribute("data-uri") ?? undefined
  }

  onMount(() => {
    const onFocus = makePaneFocusKeyHandler(focusPane, focusMain)
    const onDetach = makeDetachKeyHandler(getActiveURI, (uri) => dock.detach(uri))
    window.addEventListener("keydown", onFocus)
    window.addEventListener("keydown", onDetach)
    onCleanup(() => {
      window.removeEventListener("keydown", onFocus)
      window.removeEventListener("keydown", onDetach)
    })
  })
}
