import type { UserMessage } from "@librecode/sdk/v2"
import { batch, createMemo } from "solid-js"
import { showToast } from "@librecode/ui/toast"
import { base64Encode } from "@librecode/util/encode"
import { useNavigate } from "@solidjs/router"
import { useSDK } from "@/context/sdk"
import { useSync } from "@/context/sync"
import { usePrompt } from "@/context/prompt"
import { useLanguage } from "@/context/language"
import { formatServerError } from "@/utils/server-errors"
import { extractPromptFromParts } from "@/utils/prompt"

type SessionInfo = {
  id: string
  revert?: { messageID: string } | undefined
}

type SessionOperationsInput = {
  sessionID: () => string | undefined
  sdk: ReturnType<typeof useSDK>
  sync: ReturnType<typeof useSync>
  prompt: ReturnType<typeof usePrompt>
  language: ReturnType<typeof useLanguage>
  navigate: ReturnType<typeof useNavigate>
  info: () => SessionInfo | undefined
  userMessages: () => UserMessage[]
  reverting: () => boolean
  restoring: () => string | undefined
  setReverting: (value: boolean) => void
  setRestoring: (value: ((prev: string | undefined) => string | undefined) | string | undefined) => void
}

export function createSessionOperations(input: SessionOperationsInput) {
  const draft = (id: string) =>
    extractPromptFromParts(input.sync.data.part[id] ?? [], {
      directory: input.sdk.directory,
      attachmentName: input.language.t("common.attachment"),
    })

  const line = (id: string): string => {
    const text = draft(id)
      .map((part) => (part.type === "image" ? `[image:${part.filename}]` : part.content))
      .join("")
      .replace(/\s+/g, " ")
      .trim()
    if (text) return text
    return `[${input.language.t("common.attachment")}]`
  }

  const fail = (err: unknown) => {
    showToast({
      variant: "error",
      title: input.language.t("common.requestFailed"),
      description: formatServerError(err, input.language.t),
    })
  }

  const merge = (next: SessionInfo) =>
    input.sync.set("session", (list) => {
      const idx = list.findIndex((item) => item.id === next.id)
      if (idx < 0) return list
      const out = list.slice()
      out[idx] = next
      return out
    })

  const roll = (sessionID: string, next: { messageID: string } | undefined) =>
    input.sync.set("session", (list) => {
      const idx = list.findIndex((item) => item.id === sessionID)
      if (idx < 0) return list
      const out = list.slice()
      out[idx] = { ...out[idx], revert: next }
      return out
    })

  const busy = (sessionID: string): boolean => {
    if ((input.sync.data.session_status[sessionID] ?? { type: "idle" as const }).type !== "idle") return true
    return (input.sync.data.message[sessionID] ?? []).some(
      (item) => item.role === "assistant" && typeof item.time.completed !== "number",
    )
  }

  const halt = (sessionID: string): Promise<void> =>
    busy(sessionID) ? input.sdk.client.session.abort({ sessionID }).catch(() => {}) : Promise.resolve()

  const fork = (op: { sessionID: string; messageID: string }) => {
    const value = draft(op.messageID)
    const dir = base64Encode(input.sdk.directory)
    return input.sdk.client.session
      .fork(op)
      .then((result) => {
        const next = result.data
        if (!next) {
          showToast({ variant: "error", title: input.language.t("common.requestFailed") })
          return
        }
        input.prompt.set(value, undefined, { dir, id: next.id })
        input.navigate(`/${dir}/session/${next.id}`)
      })
      .catch(fail)
  }

  const revert = (op: { sessionID: string; messageID: string }) => {
    if (input.reverting() || input.restoring()) return
    const prev = input.prompt.current().slice()
    const last = input.info()?.revert
    const value = draft(op.messageID)
    batch(() => {
      input.setReverting(true)
      roll(op.sessionID, { messageID: op.messageID })
      input.prompt.set(value)
    })
    return halt(op.sessionID)
      .then(() => input.sdk.client.session.revert(op))
      .then((result) => {
        if (result.data) merge(result.data)
      })
      .catch((err) => {
        batch(() => {
          roll(op.sessionID, last)
          input.prompt.set(prev)
        })
        fail(err)
      })
      .finally(() => {
        input.setReverting(false)
      })
  }

  const restore = (id: string) => {
    const sessionID = input.sessionID()
    if (!sessionID || input.restoring() || input.reverting()) return

    const next = input.userMessages().find((item) => item.id > id)
    const prev = input.prompt.current().slice()
    const last = input.info()?.revert

    batch(() => {
      input.setRestoring(id)
      input.setReverting(true)
      roll(sessionID, next ? { messageID: next.id } : undefined)
      if (next) {
        input.prompt.set(draft(next.id))
        return
      }
      input.prompt.reset()
    })

    const task = !next
      ? halt(sessionID).then(() => input.sdk.client.session.unrevert({ sessionID }))
      : halt(sessionID).then(() => input.sdk.client.session.revert({ sessionID, messageID: next.id }))

    return task
      .then((result) => {
        if (result.data) merge(result.data)
      })
      .catch((err) => {
        batch(() => {
          roll(sessionID, last)
          input.prompt.set(prev)
        })
        fail(err)
      })
      .finally(() => {
        batch(() => {
          input.setRestoring((value) => (value === id ? undefined : value))
          input.setReverting(false)
        })
      })
  }

  const revertMessageID = createMemo(() => input.info()?.revert?.messageID)

  const rolled = createMemo(() => {
    const id = revertMessageID()
    if (!id) return []
    return input
      .userMessages()
      .filter((item) => item.id >= id)
      .map((item) => ({ id: item.id, text: line(item.id) }))
  })

  return {
    draft,
    line,
    fail,
    busy,
    halt,
    fork,
    revert,
    restore,
    rolled,
    revertMessageID,
  }
}
