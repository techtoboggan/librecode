import { createContext, createSignal, useContext, type ParentComponent } from "solid-js"
import type { McpAppResource } from "@/components/mcp-app-panel"

interface PinnedAppsContextValue {
  pinned: () => McpAppResource[]
  pin: (app: McpAppResource) => void
  unpin: (uri: string) => void
  isPinned: (uri: string) => boolean
}

const PinnedAppsContext = createContext<PinnedAppsContextValue>()

export const PinnedAppsProvider: ParentComponent = (props) => {
  const [pinned, setPinned] = createSignal<McpAppResource[]>([])

  const pin = (app: McpAppResource) => {
    if (pinned().find((a) => a.uri === app.uri)) return
    setPinned([...pinned(), app])
  }

  const unpin = (uri: string) => {
    setPinned(pinned().filter((a) => a.uri !== uri))
  }

  const isPinned = (uri: string) => Boolean(pinned().find((a) => a.uri === uri))

  return (
    <PinnedAppsContext.Provider value={{ pinned, pin, unpin, isPinned }}>{props.children}</PinnedAppsContext.Provider>
  )
}

export function usePinnedApps(): PinnedAppsContextValue {
  const ctx = useContext(PinnedAppsContext)
  if (!ctx) {
    // Safe fallback — components outside a SessionSidePanel get no-op behavior
    return {
      pinned: () => [],
      pin: () => {},
      unpin: () => {},
      isPinned: () => false,
    }
  }
  return ctx
}
