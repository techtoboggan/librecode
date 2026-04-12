import type { ToolPart } from "@librecode/sdk/v2"
import { useKeybind } from "@tui/context/keybind"
import { useLocal } from "@tui/context/local"
import { useRoute } from "@tui/context/route"
import { useSync } from "@tui/context/sync"
import { useTheme } from "@tui/context/theme"
import { createMemo, onMount } from "solid-js"
import type { TaskTool } from "@/tool/task"
import { Locale } from "@/util/locale"
import { InlineTool, type ToolProps } from "./shared"

export function Task(props: ToolProps<typeof TaskTool>) {
  const { theme: _theme } = useTheme()
  const _keybind = useKeybind()
  const { navigate } = useRoute()
  const _local = useLocal()
  const sync = useSync()

  onMount(() => {
    if (props.metadata.sessionId && !sync.data.message[props.metadata.sessionId]?.length)
      sync.session.sync(props.metadata.sessionId)
  })

  const messages = createMemo(() => sync.data.message[props.metadata.sessionId ?? ""] ?? [])

  const tools = createMemo(() => {
    return messages().flatMap((msg) =>
      (sync.data.part[msg.id] ?? [])
        .filter((part): part is ToolPart => part.type === "tool")
        .map((part) => ({ tool: part.tool, state: part.state })),
    )
  })

  const current = createMemo(() => tools().findLast((x) => (x.state as any).title))

  const isRunning = createMemo(() => props.part.state.status === "running")

  const duration = createMemo(() => {
    const first = messages().find((x) => x.role === "user")?.time.created
    const assistant = messages().findLast((x) => x.role === "assistant")?.time.completed
    if (!first || !assistant) return 0
    return assistant - first
  })

  const content = createMemo(() => {
    if (!props.input.description) return ""
    const content = [`Task ${props.input.description}`]

    if (isRunning() && tools().length > 0) {
      if (current()) content.push(`↳ ${Locale.titlecase(current()!.tool)} ${(current()?.state as any).title}`)
      else content.push(`↳ ${tools().length} toolcalls`)
    }

    if (props.part.state.status === "completed") {
      content.push(`└ ${tools().length} toolcalls · ${Locale.duration(duration())}`)
    }

    return content.join("\n")
  })

  return (
    <InlineTool
      icon="│"
      spinner={isRunning()}
      complete={props.input.description}
      pending="Delegating..."
      part={props.part}
      onClick={() => {
        if (props.metadata.sessionId) {
          navigate({ type: "session", sessionID: props.metadata.sessionId })
        }
      }}
    >
      {content()}
    </InlineTool>
  )
}
