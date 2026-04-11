import { createContext, useContext } from "solid-js"
import type { useSync } from "@tui/context/sync"
import type { TuiConfig } from "@/config/tui"

export type SessionContext = {
  width: number
  sessionID: string
  conceal: () => boolean
  showThinking: () => boolean
  showTimestamps: () => boolean
  showDetails: () => boolean
  showGenericToolOutput: () => boolean
  diffWrapMode: () => "word" | "none"
  sync: ReturnType<typeof useSync>
  tui: TuiConfig.Info
}

export const sessionContext = createContext<SessionContext>()

export function use(): SessionContext {
  const ctx = useContext(sessionContext)
  if (!ctx) throw new Error("useContext must be used within a Session component")
  return ctx
}
