import { For, createEffect, createMemo, on, onCleanup, Show, type JSX } from "solid-js"
import { createStore, produce } from "solid-js/store"
import { useNavigate } from "@solidjs/router"
import { Button } from "@librecode/ui/button"
import { Icon } from "@librecode/ui/icon"
import { ScrollView } from "@librecode/ui/scroll-view"
import type { AssistantMessage, Message as MessageType, Part, TextPart, UserMessage } from "@librecode/sdk/v2"
import { showToast } from "@librecode/ui/toast"
import { Binary } from "@librecode/util/binary"
import { shouldMarkBoundaryGesture, normalizeWheelDelta } from "@/pages/session/message-gesture"
import { useLanguage } from "@/context/language"
import { useSessionKey } from "@/pages/session/session-layout"
import { useGlobalSDK } from "@/context/global-sdk"
import { usePlatform } from "@/context/platform"
import { useSettings } from "@/context/settings"
import { useSDK } from "@/context/sdk"
import { useSync } from "@/context/sync"
import { messageAgentColor } from "@/utils/agent"
import { parseCommentNote, readCommentMetadata } from "@/utils/comment-note"
import { SessionHeader } from "./message-timeline/session-header"
import { MessageRow, type MessageComment } from "./message-timeline/message-row"

export type UserActions = {
  fork?: (input: { sessionID: string; messageID: string }) => Promise<void> | void
  revert?: (input: { sessionID: string; messageID: string }) => Promise<void> | void
}

const emptyMessages: MessageType[] = []
const idle = { type: "idle" as const }

const messageComments = (parts: Part[]): MessageComment[] =>
  parts.flatMap((part) => {
    if (part.type !== "text" || !(part as TextPart).synthetic) return []
    const next = readCommentMetadata(part.metadata) ?? parseCommentNote(part.text)
    if (!next) return []
    return [
      {
        path: next.path,
        comment: next.comment,
        selection: next.selection
          ? {
              startLine: next.selection.startLine,
              endLine: next.selection.endLine,
            }
          : undefined,
      },
    ]
  })

const boundaryTarget = (root: HTMLElement, target: EventTarget | null) => {
  const current = target instanceof Element ? target : undefined
  const nested = current?.closest("[data-scrollable]")
  if (!nested || nested === root) return root
  if (!(nested instanceof HTMLElement)) return root
  return nested
}

const markBoundaryGesture = (input: {
  root: HTMLDivElement
  target: EventTarget | null
  delta: number
  onMarkScrollGesture: (target?: EventTarget | null) => void
}) => {
  const target = boundaryTarget(input.root, input.target)
  if (target === input.root) {
    input.onMarkScrollGesture(input.root)
    return
  }
  if (
    shouldMarkBoundaryGesture({
      delta: input.delta,
      scrollTop: target.scrollTop,
      scrollHeight: target.scrollHeight,
      clientHeight: target.clientHeight,
    })
  ) {
    input.onMarkScrollGesture(input.root)
  }
}

type StageConfig = {
  init: number
  batch: number
}

type TimelineStageInput = {
  sessionKey: () => string
  turnStart: () => number
  messages: () => UserMessage[]
  config: StageConfig
}

/**
 * Defer-mounts small timeline windows so revealing older turns does not
 * block first paint with a large DOM mount.
 *
 * Once staging completes for a session it never re-stages — backfill and
 * new messages render immediately.
 */
function createTimelineStaging(input: TimelineStageInput) {
  const [state, setState] = createStore({
    activeSession: "",
    completedSession: "",
    count: 0,
  })

  const stagedCount = createMemo(() => {
    const total = input.messages().length
    if (input.turnStart() <= 0) return total
    if (state.completedSession === input.sessionKey()) return total
    const init = Math.min(total, input.config.init)
    if (state.count <= init) return init
    if (state.count >= total) return total
    return state.count
  })

  const stagedUserMessages = createMemo(() => {
    const list = input.messages()
    const count = stagedCount()
    if (count >= list.length) return list
    return list.slice(Math.max(0, list.length - count))
  })

  let frame: number | undefined
  const cancel = () => {
    if (frame === undefined) return
    cancelAnimationFrame(frame)
    frame = undefined
  }

  createEffect(
    on(
      () => [input.sessionKey(), input.turnStart() > 0, input.messages().length] as const,
      ([sessionKey, isWindowed, total]) => {
        cancel()
        const shouldStage =
          isWindowed &&
          total > input.config.init &&
          state.completedSession !== sessionKey &&
          state.activeSession !== sessionKey
        if (!shouldStage) {
          setState({ activeSession: "", count: total })
          return
        }

        let count = Math.min(total, input.config.init)
        setState({ activeSession: sessionKey, count })

        const step = () => {
          if (input.sessionKey() !== sessionKey) {
            frame = undefined
            return
          }
          const currentTotal = input.messages().length
          count = Math.min(currentTotal, count + input.config.batch)
          setState("count", count)
          if (count >= currentTotal) {
            setState({ completedSession: sessionKey, activeSession: "" })
            frame = undefined
            return
          }
          frame = requestAnimationFrame(step)
        }
        frame = requestAnimationFrame(step)
      },
    ),
  )

  const isStaging = createMemo(() => {
    const key = input.sessionKey()
    return state.activeSession === key && state.completedSession !== key
  })

  onCleanup(cancel)
  return { messages: stagedUserMessages, isStaging }
}

export function MessageTimeline(props: {
  mobileChanges: boolean
  mobileFallback: JSX.Element
  actions?: UserActions
  scroll: { overflow: boolean; bottom: boolean }
  onResumeScroll: () => void
  setScrollRef: (el: HTMLDivElement | undefined) => void
  onScheduleScrollState: (el: HTMLDivElement) => void
  onAutoScrollHandleScroll: () => void
  onMarkScrollGesture: (target?: EventTarget | null) => void
  hasScrollGesture: () => boolean
  onUserScroll: () => void
  onTurnBackfillScroll: () => void
  onAutoScrollInteraction: (event: MouseEvent) => void
  centered: boolean
  setContentRef: (el: HTMLDivElement) => void
  turnStart: number
  historyMore: boolean
  historyLoading: boolean
  onLoadEarlier: () => void
  renderedUserMessages: UserMessage[]
  anchor: (id: string) => string
}): JSX.Element {
  let touchGesture: number | undefined
  let more: HTMLButtonElement | undefined
  let titleRef: HTMLInputElement | undefined

  const navigate = useNavigate()
  const globalSDK = useGlobalSDK()
  const sdk = useSDK()
  const sync = useSync()
  const settings = useSettings()
  const language = useLanguage()
  const { params, sessionKey } = useSessionKey()
  const platform = usePlatform()

  const rendered = createMemo(() => props.renderedUserMessages.map((message) => message.id))
  const sessionID = createMemo(() => params.id)
  const sessionMessages = createMemo(() => {
    const id = sessionID()
    if (!id) return emptyMessages
    return sync.data.message[id] ?? emptyMessages
  })
  const pending = createMemo(() =>
    sessionMessages().findLast(
      (item): item is AssistantMessage => item.role === "assistant" && typeof item.time.completed !== "number",
    ),
  )
  const sessionStatus = createMemo(() => {
    const id = sessionID()
    if (!id) return idle
    return sync.data.session_status[id] ?? idle
  })
  const working = createMemo(() => !!pending() || sessionStatus().type !== "idle")
  const tint = createMemo(() => messageAgentColor(sessionMessages(), sync.data.agent))

  const [slot, setSlot] = createStore({
    open: false,
    show: false,
    fade: false,
  })

  let f: number | undefined
  const clear = () => {
    if (f !== undefined) window.clearTimeout(f)
    f = undefined
  }

  onCleanup(clear)
  createEffect(
    on(
      working,
      (on, prev) => {
        clear()
        if (on) {
          setSlot({ open: true, show: true, fade: false })
          return
        }
        if (prev) {
          setSlot({ open: false, show: true, fade: true })
          f = window.setTimeout(() => setSlot({ show: false, fade: false }), 260)
          return
        }
        setSlot({ open: false, show: false, fade: false })
      },
      { defer: true },
    ),
  )

  const activeMessageID = createMemo(() => {
    const parentID = pending()?.parentID
    if (parentID) {
      const messages = sessionMessages()
      const result = Binary.search(messages, parentID, (message) => message.id)
      const message = result.found ? messages[result.index] : messages.find((item) => item.id === parentID)
      if (message && message.role === "user") return message.id
    }

    const status = sessionStatus()
    if (status.type !== "idle") {
      const messages = sessionMessages()
      for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i].role === "user") return messages[i].id
      }
    }

    return undefined
  })

  const info = createMemo(() => {
    const id = sessionID()
    if (!id) return
    return sync.session.get(id)
  })
  const titleValue = createMemo(() => info()?.title)
  const shareUrl = createMemo(() => info()?.share?.url)
  const shareEnabled = createMemo(() => sync.data.config.share !== "disabled")
  const parentID = createMemo(() => info()?.parentID)
  const showHeader = createMemo(() => !!(titleValue() || parentID()))
  const stageCfg = { init: 1, batch: 3 }
  const staging = createTimelineStaging({
    sessionKey,
    turnStart: () => props.turnStart,
    messages: () => props.renderedUserMessages,
    config: stageCfg,
  })

  const [title, setTitle] = createStore({
    draft: "",
    editing: false,
    saving: false,
    menuOpen: false,
    pendingRename: false,
    pendingShare: false,
  })

  const [share, setShare] = createStore({
    open: false,
    dismiss: null as "escape" | "outside" | null,
  })

  const [req, setReq] = createStore({ share: false, unshare: false })

  const errorMessage = (err: unknown) => {
    if (err && typeof err === "object" && "data" in err) {
      const data = (err as { data?: { message?: string } }).data
      if (data?.message) return data.message
    }
    if (err instanceof Error) return err.message
    return language.t("common.requestFailed")
  }

  createEffect(
    on(
      sessionKey,
      () =>
        setTitle({
          draft: "",
          editing: false,
          saving: false,
          menuOpen: false,
          pendingRename: false,
          pendingShare: false,
        }),
      { defer: true },
    ),
  )

  const openTitleEditor = () => {
    if (!sessionID()) return
    setTitle({ editing: true, draft: titleValue() ?? "" })
    requestAnimationFrame(() => {
      titleRef?.focus()
      titleRef?.select()
    })
  }

  const closeTitleEditor = () => {
    if (title.saving) return
    setTitle({ editing: false, saving: false })
  }

  const saveTitleEditor = async () => {
    const id = sessionID()
    if (!id) return
    if (title.saving) return

    const next = title.draft.trim()
    if (!next || next === (titleValue() ?? "")) {
      setTitle({ editing: false, saving: false })
      return
    }

    setTitle("saving", true)
    await sdk.client.session
      .update({ sessionID: id, title: next })
      .then(() => {
        sync.set(
          produce((draft) => {
            const index = draft.session.findIndex((s) => s.id === id)
            if (index !== -1) draft.session[index].title = next
          }),
        )
        setTitle({ editing: false, saving: false })
      })
      .catch((err) => {
        setTitle("saving", false)
        showToast({
          title: language.t("common.requestFailed"),
          description: errorMessage(err),
        })
      })
  }

  const navigateAfterSessionRemoval = (sid: string, pid?: string, nextSID?: string) => {
    if (params.id !== sid) return
    if (pid) {
      navigate(`/${params.dir}/session/${pid}`)
      return
    }
    if (nextSID) {
      navigate(`/${params.dir}/session/${nextSID}`)
      return
    }
    navigate(`/${params.dir}/session`)
  }

  const archiveSession = async (sid: string) => {
    const session = sync.session.get(sid)
    if (!session) return

    const sessions = sync.data.session ?? []
    const index = sessions.findIndex((s) => s.id === sid)
    const nextSession = index === -1 ? undefined : (sessions[index + 1] ?? sessions[index - 1])

    await sdk.client.session
      .update({ sessionID: sid, time: { archived: Date.now() } })
      .then(() => {
        sync.set(
          produce((draft) => {
            const idx = draft.session.findIndex((s) => s.id === sid)
            if (idx !== -1) draft.session.splice(idx, 1)
          }),
        )
        navigateAfterSessionRemoval(sid, session.parentID, nextSession?.id)
      })
      .catch((err) => {
        showToast({
          title: language.t("common.requestFailed"),
          description: errorMessage(err),
        })
      })
  }

  const deleteSession = async (sid: string) => {
    const session = sync.session.get(sid)
    if (!session) return false

    const sessions = (sync.data.session ?? []).filter((s) => !s.parentID && !s.time?.archived)
    const index = sessions.findIndex((s) => s.id === sid)
    const nextSession = index === -1 ? undefined : (sessions[index + 1] ?? sessions[index - 1])

    const result = await sdk.client.session
      .delete({ sessionID: sid })
      .then((x) => x.data)
      .catch((err) => {
        showToast({
          title: language.t("session.delete.failed.title"),
          description: errorMessage(err),
        })
        return false
      })

    if (!result) return false

    sync.set(
      produce((draft) => {
        const removed = new Set<string>([sid])

        const byParent = new Map<string, string[]>()
        for (const item of draft.session) {
          const pid = item.parentID
          if (!pid) continue
          const existing = byParent.get(pid)
          if (existing) {
            existing.push(item.id)
            continue
          }
          byParent.set(pid, [item.id])
        }

        const stack = [sid]
        while (stack.length) {
          const pid = stack.pop()
          if (!pid) continue
          const children = byParent.get(pid)
          if (!children) continue
          for (const child of children) {
            if (removed.has(child)) continue
            removed.add(child)
            stack.push(child)
          }
        }

        draft.session = draft.session.filter((s) => !removed.has(s.id))
      }),
    )

    navigateAfterSessionRemoval(sid, session.parentID, nextSession?.id)
    return true
  }

  const navigateParent = () => {
    const id = parentID()
    if (!id) return
    navigate(`/${params.dir}/session/${id}`)
  }

  const shareSession = () => {
    const id = sessionID()
    if (!id || req.share) return
    if (!shareEnabled()) return
    setReq("share", true)
    globalSDK.client.session
      .share({ sessionID: id, directory: sdk.directory })
      .catch((err: unknown) => {
        console.error("Failed to share session", err)
      })
      .finally(() => {
        setReq("share", false)
      })
  }

  const unshareSession = () => {
    const id = sessionID()
    if (!id || req.unshare) return
    if (!shareEnabled()) return
    setReq("unshare", true)
    globalSDK.client.session
      .unshare({ sessionID: id, directory: sdk.directory })
      .catch((err: unknown) => {
        console.error("Failed to unshare session", err)
      })
      .finally(() => {
        setReq("unshare", false)
      })
  }

  const viewShare = () => {
    const url = shareUrl()
    if (!url) return
    platform.openLink(url)
  }

  return (
    <Show
      when={!props.mobileChanges}
      fallback={<div class="relative h-full overflow-hidden">{props.mobileFallback}</div>}
    >
      <div class="relative w-full h-full min-w-0">
        <div
          class="absolute left-1/2 -translate-x-1/2 bottom-6 z-[60] pointer-events-none transition-all duration-200 ease-out"
          classList={{
            "opacity-100 translate-y-0 scale-100":
              props.scroll.overflow && !props.scroll.bottom && !staging.isStaging(),
            "opacity-0 translate-y-2 scale-95 pointer-events-none":
              !props.scroll.overflow || props.scroll.bottom || staging.isStaging(),
          }}
        >
          <button
            class="pointer-events-auto size-8 flex items-center justify-center rounded-full bg-background-base border border-border-base shadow-sm text-text-base hover:bg-background-stronger transition-colors"
            onClick={props.onResumeScroll}
          >
            <Icon name="arrow-down-to-line" />
          </button>
        </div>
        <ScrollView
          viewportRef={props.setScrollRef}
          onWheel={(e) => {
            const root = e.currentTarget
            const delta = normalizeWheelDelta({
              deltaY: e.deltaY,
              deltaMode: e.deltaMode,
              rootHeight: root.clientHeight,
            })
            if (!delta) return
            markBoundaryGesture({ root, target: e.target, delta, onMarkScrollGesture: props.onMarkScrollGesture })
          }}
          onTouchStart={(e) => {
            touchGesture = e.touches[0]?.clientY
          }}
          onTouchMove={(e) => {
            const next = e.touches[0]?.clientY
            const prev = touchGesture
            touchGesture = next
            if (next === undefined || prev === undefined) return
            const delta = prev - next
            if (!delta) return
            const root = e.currentTarget
            markBoundaryGesture({ root, target: e.target, delta, onMarkScrollGesture: props.onMarkScrollGesture })
          }}
          onTouchEnd={() => { touchGesture = undefined }}
          onTouchCancel={() => { touchGesture = undefined }}
          onPointerDown={(e) => {
            if (e.target !== e.currentTarget) return
            props.onMarkScrollGesture(e.currentTarget)
          }}
          onScroll={(e) => {
            props.onScheduleScrollState(e.currentTarget)
            props.onTurnBackfillScroll()
            if (!props.hasScrollGesture()) return
            props.onUserScroll()
            props.onAutoScrollHandleScroll()
            props.onMarkScrollGesture(e.currentTarget)
          }}
          onClick={props.onAutoScrollInteraction}
          class="relative min-w-0 w-full h-full"
          style={{
            "--session-title-height": showHeader() ? "40px" : "0px",
            "--sticky-accordion-top": showHeader() ? "48px" : "0px",
          }}
        >
          <div ref={props.setContentRef} class="min-w-0 w-full">
            <Show when={showHeader()}>
              <SessionHeader
                centered={props.centered}
                sessionID={sessionID}
                titleValue={titleValue}
                shareUrl={shareUrl}
                shareEnabled={shareEnabled}
                parentID={parentID}
                slot={slot}
                tint={tint}
                title={title}
                share={share}
                req={req}
                moreRef={(el) => { more = el }}
                titleInputRef={(el) => { titleRef = el }}
                onNavigateParent={navigateParent}
                onOpenTitleEditor={openTitleEditor}
                onCloseTitleEditor={closeTitleEditor}
                onSaveTitleEditor={() => void saveTitleEditor()}
                onTitleInput={(value) => setTitle("draft", value)}
                onTitleMenuOpenChange={(open) => {
                  setTitle("menuOpen", open)
                }}
                onSelectRename={() => {
                  setTitle("pendingRename", true)
                  setTitle("menuOpen", false)
                }}
                onSelectShare={() => {
                  setTitle({ pendingShare: true, menuOpen: false })
                }}
                onPendingRename={() => {
                  setTitle("pendingRename", false)
                  openTitleEditor()
                }}
                onPendingShare={() => {
                  requestAnimationFrame(() => {
                    setShare({ open: true, dismiss: null })
                    setTitle("pendingShare", false)
                  })
                }}
                onArchiveSession={archiveSession}
                onDeleteSession={deleteSession}
                onShareSession={shareSession}
                onUnshareSession={unshareSession}
                onViewShare={viewShare}
                onShareOpenChange={(open) => {
                  if (open) setShare("dismiss", null)
                  setShare("open", open)
                }}
                onShareDismissEscape={() => setShare({ dismiss: "escape", open: false })}
                onShareDismissOutside={() => setShare({ dismiss: "outside", open: false })}
                onShareCloseAutoFocus={(event) => {
                  if (share.dismiss === "outside") event.preventDefault()
                  setShare("dismiss", null)
                }}
              />
            </Show>

            <div
              role="log"
              class="flex flex-col gap-12 items-start justify-start pb-16 transition-[margin]"
              classList={{
                "w-full": true,
                "md:max-w-200 md:mx-auto 2xl:max-w-[1000px]": props.centered,
                "mt-0.5": props.centered,
                "mt-0": !props.centered,
              }}
            >
              <Show when={props.turnStart > 0 || props.historyMore}>
                <div class="w-full flex justify-center">
                  <Button
                    variant="ghost"
                    size="large"
                    class="text-12-medium opacity-50"
                    disabled={props.historyLoading}
                    onClick={props.onLoadEarlier}
                  >
                    {props.historyLoading
                      ? language.t("session.messages.loadingEarlier")
                      : language.t("session.messages.loadEarlier")}
                  </Button>
                </div>
              </Show>
              <For each={rendered()}>
                {(messageID) => {
                  const active = createMemo(() => activeMessageID() === messageID)
                  const comments = createMemo(() => messageComments(sync.data.part[messageID] ?? []), [], {
                    equals: (a, b) => JSON.stringify(a) === JSON.stringify(b),
                  })
                  return (
                    <MessageRow
                      messageID={messageID}
                      anchor={props.anchor(messageID)}
                      centered={props.centered}
                      active={active()}
                      sessionID={sessionID() ?? ""}
                      actions={props.actions}
                      sessionStatus={active() ? sessionStatus() : undefined}
                      showReasoningSummaries={settings.general.showReasoningSummaries()}
                      shellToolDefaultOpen={settings.general.shellToolPartsExpanded()}
                      editToolDefaultOpen={settings.general.editToolPartsExpanded()}
                      comments={comments}
                    />
                  )
                }}
              </For>
            </div>
          </div>
        </ScrollView>
      </div>
    </Show>
  )
}
