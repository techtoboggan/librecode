import { createEffect, on, untrack, onCleanup } from "solid-js"
import type { useSync } from "@/context/sync"

type DiffSyncInput = {
  sessionKey: () => string
  wantsDiff: () => boolean
  sessionID: () => string | undefined
  sync: ReturnType<typeof useSync>
}

export function createDiffSync(input: DiffSyncInput) {
  let diffFrame: number | undefined
  let diffTimer: number | undefined

  createEffect(() => {
    const id = input.sessionID()
    if (!id) return
    if (!input.wantsDiff()) return
    if (input.sync.data.session_diff[id] !== undefined) return
    if (input.sync.status === "loading") return
    void input.sync.session.diff(id)
  })

  createEffect(
    on(
      () => [input.sessionKey(), input.wantsDiff()] as const,
      ([key, wants]) => {
        if (diffFrame !== undefined) cancelAnimationFrame(diffFrame)
        if (diffTimer !== undefined) window.clearTimeout(diffTimer)
        diffFrame = undefined
        diffTimer = undefined
        if (!wants) return

        const id = input.sessionID()
        if (!id) return
        if (!untrack(() => input.sync.data.session_diff[id] !== undefined)) return

        diffFrame = requestAnimationFrame(() => {
          diffFrame = undefined
          diffTimer = window.setTimeout(() => {
            diffTimer = undefined
            if (input.sessionKey() !== key) return
            void input.sync.session.diff(id, { force: true })
          }, 0)
        })
      },
      { defer: true },
    ),
  )

  onCleanup(() => {
    if (diffFrame !== undefined) cancelAnimationFrame(diffFrame)
    if (diffTimer !== undefined) window.clearTimeout(diffTimer)
  })
}
