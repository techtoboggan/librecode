import { type JSX, createMemo, Index, Show } from "solid-js"
import { FileIcon } from "@librecode/ui/file-icon"
import { SessionTurn } from "@librecode/ui/session-turn"
import { getFilename } from "@librecode/util/path"
import type { Part, UserMessage } from "@librecode/sdk/v2"
import type { UserActions } from "../message-timeline"

type MessageComment = {
  path: string
  comment: string
  selection?: {
    startLine: number
    endLine: number
  }
}

export type MessageRowProps = {
  messageID: string
  anchor: string
  centered: boolean
  active: boolean
  sessionID: string
  actions?: UserActions
  sessionStatus: { type: string } | undefined
  showReasoningSummaries: boolean
  shellToolDefaultOpen: boolean
  editToolDefaultOpen: boolean
  comments: () => MessageComment[]
}

export type { MessageComment }

export function MessageRow(props: MessageRowProps): JSX.Element {
  const commentCount = createMemo(() => props.comments().length)

  return (
    <div
      id={props.anchor}
      data-message-id={props.messageID}
      classList={{
        "min-w-0 w-full max-w-full": true,
        "md:max-w-200 2xl:max-w-[1000px]": props.centered,
      }}
      style={{ "content-visibility": "auto", "contain-intrinsic-size": "auto 500px" }}
    >
      <Show when={commentCount() > 0}>
        <div class="w-full px-4 md:px-5 pb-2">
          <div class="ml-auto max-w-[82%] overflow-x-auto no-scrollbar">
            <div class="flex w-max min-w-full justify-end gap-2">
              <Index each={props.comments()}>
                {(commentAccessor: () => MessageComment) => {
                  const comment = createMemo(() => commentAccessor())
                  return (
                    <Show when={comment()}>
                      {(c) => (
                        <div class="shrink-0 max-w-[260px] rounded-[6px] border border-border-weak-base bg-background-stronger px-2.5 py-2">
                          <div class="flex items-center gap-1.5 min-w-0 text-11-medium text-text-strong">
                            <FileIcon node={{ path: c().path, type: "file" }} class="size-3.5 shrink-0" />
                            <span class="truncate">{getFilename(c().path)}</span>
                            <Show when={c().selection}>
                              {(selection) => (
                                <span class="shrink-0 text-text-weak">
                                  {selection().startLine === selection().endLine
                                    ? `:${selection().startLine}`
                                    : `:${selection().startLine}-${selection().endLine}`}
                                </span>
                              )}
                            </Show>
                          </div>
                          <div class="pt-1 text-12-regular text-text-strong whitespace-pre-wrap break-words">
                            {c().comment}
                          </div>
                        </div>
                      )}
                    </Show>
                  )
                }}
              </Index>
            </div>
          </div>
        </div>
      </Show>
      <SessionTurn
        sessionID={props.sessionID}
        messageID={props.messageID}
        actions={props.actions}
        active={props.active}
        status={props.active ? props.sessionStatus : undefined}
        showReasoningSummaries={props.showReasoningSummaries}
        shellToolDefaultOpen={props.shellToolDefaultOpen}
        editToolDefaultOpen={props.editToolDefaultOpen}
        classes={{
          root: "min-w-0 w-full relative",
          content: "flex flex-col justify-between !overflow-visible",
          container: "w-full px-4 md:px-5",
        }}
      />
    </div>
  )
}
