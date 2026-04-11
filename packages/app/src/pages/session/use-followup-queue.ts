import { createEffect, createMemo } from "solid-js"
import { createStore } from "solid-js/store"
import { useGlobalSync } from "@/context/global-sync"
import { useSync } from "@/context/sync"
import { useSDK } from "@/context/sdk"
import { sendFollowupDraft, type FollowupDraft } from "@/components/prompt-input/submit"
import { Identifier } from "@/utils/id"

type FollowupItem = FollowupDraft & { id: string }

type FollowupQueueInput = {
  sessionID: () => string | undefined
  sdk: ReturnType<typeof useSDK>
  sync: ReturnType<typeof useSync>
  globalSync: ReturnType<typeof useGlobalSync>
  composerBlocked: () => boolean
  followupMode: () => string
  busy: (sessionID: string) => boolean
  attachmentLabel: () => string
  onScrollToBottom: () => void
  onError: (err: unknown) => void
}

export function createFollowupQueue(input: FollowupQueueInput) {
  const emptyFollowups: FollowupItem[] = []

  const [followup, setFollowup] = createStore({
    items: {} as Record<string, FollowupItem[] | undefined>,
    sending: {} as Record<string, string | undefined>,
    failed: {} as Record<string, string | undefined>,
    paused: {} as Record<string, boolean | undefined>,
    edit: {} as Record<
      string,
      { id: string; prompt: FollowupDraft["prompt"]; context: FollowupDraft["context"] } | undefined
    >,
  })

  const queuedFollowups = createMemo(() => {
    const id = input.sessionID()
    if (!id) return emptyFollowups
    return followup.items[id] ?? emptyFollowups
  })

  const editingFollowup = createMemo(() => {
    const id = input.sessionID()
    if (!id) return undefined
    return followup.edit[id]
  })

  const sendingFollowup = createMemo(() => {
    const id = input.sessionID()
    if (!id) return undefined
    return followup.sending[id]
  })

  const queueEnabled = createMemo(() => {
    const id = input.sessionID()
    if (!id) return false
    return input.followupMode() === "queue" && input.busy(id) && !input.composerBlocked()
  })

  const followupText = (item: FollowupDraft): string => {
    const text = item.prompt
      .map((part) => {
        if (part.type === "image") return `[image:${part.filename}]`
        if (part.type === "file") return `[file:${part.path}]`
        if (part.type === "agent") return `@${part.name}`
        return part.content
      })
      .join("")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => !!line)

    if (text) return text
    return `[${input.attachmentLabel()}]`
  }

  const queueFollowup = (draft: FollowupDraft) => {
    setFollowup("items", draft.sessionID, (items) => [
      ...(items ?? []),
      { id: Identifier.ascending("message"), ...draft },
    ])
    setFollowup("failed", draft.sessionID, undefined)
    setFollowup("paused", draft.sessionID, undefined)
  }

  const followupDock = createMemo(() => queuedFollowups().map((item) => ({ id: item.id, text: followupText(item) })))

  const sendFollowup = (sessionID: string, id: string, opts?: { manual?: boolean }): Promise<void> => {
    const item = (followup.items[sessionID] ?? []).find((entry) => entry.id === id)
    if (!item) return Promise.resolve()
    if (followup.sending[sessionID]) return Promise.resolve()

    if (opts?.manual) setFollowup("paused", sessionID, undefined)
    setFollowup("sending", sessionID, id)
    setFollowup("failed", sessionID, undefined)

    return sendFollowupDraft({
      client: input.sdk.client,
      sync: input.sync,
      globalSync: input.globalSync,
      draft: item,
      optimisticBusy: item.sessionDirectory === input.sdk.directory,
    })
      .then((ok) => {
        if (ok === false) return
        setFollowup("items", sessionID, (items) => (items ?? []).filter((entry) => entry.id !== id))
        if (opts?.manual) input.onScrollToBottom()
      })
      .catch((err) => {
        setFollowup("failed", sessionID, id)
        input.onError(err)
      })
      .finally(() => {
        setFollowup("sending", sessionID, (value) => (value === id ? undefined : value))
      })
  }

  const editFollowup = (id: string) => {
    const sessionID = input.sessionID()
    if (!sessionID) return
    if (followup.sending[sessionID]) return

    const item = queuedFollowups().find((entry) => entry.id === id)
    if (!item) return

    setFollowup("items", sessionID, (items) => (items ?? []).filter((entry) => entry.id !== id))
    setFollowup("failed", sessionID, (value) => (value === id ? undefined : value))
    setFollowup("edit", sessionID, {
      id: item.id,
      prompt: item.prompt,
      context: item.context,
    })
  }

  const clearFollowupEdit = () => {
    const id = input.sessionID()
    if (!id) return
    setFollowup("edit", id, undefined)
  }

  // Auto-send: drain the queue when idle
  createEffect(() => {
    const sessionID = input.sessionID()
    if (!sessionID) return

    const item = queuedFollowups()[0]
    if (!item) return
    if (followup.sending[sessionID]) return
    if (followup.failed[sessionID] === item.id) return
    if (followup.paused[sessionID]) return
    if (input.composerBlocked()) return
    if (input.busy(sessionID)) return

    void sendFollowup(sessionID, item.id)
  })

  return {
    followup,
    setFollowup,
    queuedFollowups,
    editingFollowup,
    sendingFollowup,
    queueEnabled,
    followupText,
    queueFollowup,
    followupDock,
    sendFollowup,
    editFollowup,
    clearFollowupEdit,
  }
}
