import { createContext, startTransition, untrack, useContext, type ParentComponent } from "solid-js"
import { createStore, produce } from "solid-js/store"
import type { McpAppResource } from "@/components/mcp-app-panel"
import { useSDK } from "@/context/sdk"
import { Persist, persisted } from "@/utils/persist"

interface PinnedAppsContextValue {
  pinned: () => McpAppResource[]
  pin: (app: McpAppResource) => void
  unpin: (uri: string) => void
  isPinned: (uri: string) => boolean
}

const PinnedAppsContext = createContext<PinnedAppsContextValue>()

/**
 * Minimal shape guard so a bad localStorage blob (hand-edit, legacy
 * value, corrupted key) doesn't crash the whole session page. Drops
 * entries that don't look like an `McpAppResource` and keeps the rest.
 * Returns the store-shaped object `{ apps: [...] }` — a bare array
 * here would fail to merge against the object-shaped defaults and
 * silently reset to empty on every restart.
 */
function migrate(value: unknown): { apps: McpAppResource[] } {
  const raw: unknown =
    value && typeof value === "object" && "apps" in (value as object) ? (value as { apps: unknown }).apps : value
  if (!Array.isArray(raw)) return { apps: [] }
  const out: McpAppResource[] = []
  for (const item of raw) {
    if (!item || typeof item !== "object") continue
    const rec = item as { server?: unknown; name?: unknown; uri?: unknown; description?: unknown }
    if (typeof rec.server !== "string" || !rec.server) continue
    if (typeof rec.name !== "string" || !rec.name) continue
    if (typeof rec.uri !== "string" || !rec.uri) continue
    out.push({
      server: rec.server,
      name: rec.name,
      uri: rec.uri,
      description: typeof rec.description === "string" ? rec.description : undefined,
    })
  }
  return { apps: out }
}

export const PinnedAppsProvider: ParentComponent = (props) => {
  // v0.9.61 — per-workspace localStorage persistence so a user's pinned
  // MCP apps survive closing and reopening LibreCode. Previously the
  // state lived in a bare `createSignal` that reset on every mount,
  // meaning every restart you had to pin your apps again.
  //
  // Scoped per-workspace (directory) rather than global because
  // different projects tend to want different apps active in their
  // side panel. We use `sdk.directory` (the decoded absolute path)
  // rather than `params.dir` from the router (which is base64-encoded
  // and would produce a storage key that doesn't line up with other
  // workspace-scoped stores like `vcs` or `project`).
  //
  // The provider sits inside the session route which is dir-keyed, so
  // changing directories naturally remounts the provider with the
  // other project's saved set.
  const sdk = useSDK()
  const dir = untrack(() => sdk.directory)
  const target = Persist.workspace(dir, "pinned-apps")
  const [store, setStore] = persisted({ ...target, migrate }, createStore<{ apps: McpAppResource[] }>({ apps: [] }))

  const pinned = () => store.apps

  const pin = (app: McpAppResource) => {
    if (store.apps.some((a) => a.uri === app.uri)) return
    // v0.9.58 — wrap in startTransition so the new McpAppPanel's
    // `createResource` for the app HTML (which enters a `loading`
    // state as soon as it mounts) doesn't trip the SessionRoute
    // Suspense boundary and blank the entire page.
    void startTransition(() =>
      setStore(
        produce((draft) => {
          if (draft.apps.some((a) => a.uri === app.uri)) return
          draft.apps.push(app)
        }),
      ),
    )
  }

  const unpin = (uri: string) => {
    setStore(
      produce((draft) => {
        draft.apps = draft.apps.filter((a) => a.uri !== uri)
      }),
    )
  }

  const isPinned = (uri: string) => store.apps.some((a) => a.uri === uri)

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
