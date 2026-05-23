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
