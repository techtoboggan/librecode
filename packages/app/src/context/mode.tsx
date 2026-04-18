import { createContext, createMemo, useContext, type ParentComponent } from "solid-js"
import { showToast } from "@librecode/ui/toast"
import { useGlobalSync } from "./global-sync"
import { useLanguage } from "./language"

type AppMode = "development" | "productivity"

interface ModeContextValue {
  /** Current app mode */
  mode: () => AppMode
  /** True when in development mode */
  isDev: () => boolean
  /** True when in productivity mode */
  isProductivity: () => boolean
  /** Toggle between modes */
  toggle: () => void
  /** Set a specific mode */
  set: (mode: AppMode) => void
}

const ModeContext = createContext<ModeContextValue>()

export const ModeProvider: ParentComponent = (props) => {
  const globalSync = useGlobalSync()
  const language = useLanguage()

  const mode = createMemo((): AppMode => (globalSync.data.config.app_mode as AppMode) ?? "development")
  const isDev = createMemo(() => mode() === "development")
  const isProductivity = createMemo(() => mode() === "productivity")

  const set = async (next: AppMode) => {
    try {
      await globalSync.updateConfig({
        ...globalSync.data.config,
        app_mode: next,
      })
    } catch {
      showToast({ variant: "error", title: "Failed to update app mode" })
    }
  }

  const toggle = () => set(isDev() ? "productivity" : "development")

  return (
    <ModeContext.Provider value={{ mode, isDev, isProductivity, toggle, set }}>{props.children}</ModeContext.Provider>
  )
}

export function useMode(): ModeContextValue {
  const ctx = useContext(ModeContext)
  if (!ctx) {
    // Fallback for components outside provider (e.g. tests, storybook)
    return {
      mode: () => "development",
      isDev: () => true,
      isProductivity: () => false,
      toggle: () => {},
      set: () => {},
    }
  }
  return ctx
}
