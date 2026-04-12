import type { SessionStatus } from "@librecode/sdk/v2"
import type { useTheme } from "@tui/context/theme"
import type { useDialog } from "@tui/ui/dialog"
import { createMemo, createSignal, onCleanup, onMount, Show } from "solid-js"
import { formatDuration } from "@/util/format"
import { DialogAlert } from "../../ui/dialog-alert"

// ---------------------------------------------------------------------------
// RetryStatusDisplay — subcomponent that shows retry error + countdown
// ---------------------------------------------------------------------------

type RetryStatusDisplayProps = {
  status: () => SessionStatus
  dialog: ReturnType<typeof useDialog>
  theme: ReturnType<typeof useTheme>["theme"]
}

export function RetryStatusDisplay(props: RetryStatusDisplayProps) {
  const retry = createMemo(() => {
    const s = props.status()
    if (s.type !== "retry") return undefined
    return s
  })

  const message = createMemo(() => {
    const r = retry()
    if (!r) return undefined
    if (r.message.includes("exceeded your current quota") && r.message.includes("gemini"))
      return "gemini is way too hot right now"
    if (r.message.length > 80) return `${r.message.slice(0, 80)}...`
    return r.message
  })

  const isTruncated = createMemo(() => {
    const r = retry()
    if (!r) return false
    return r.message.length > 120
  })

  const [seconds, setSeconds] = createSignal(0)
  onMount(() => {
    const timer = setInterval(() => {
      const next = retry()?.next
      if (next) setSeconds(Math.round((next - Date.now()) / 1000))
    }, 1000)
    onCleanup(() => clearInterval(timer))
  })

  const handleMessageClick = () => {
    const r = retry()
    if (!r) return
    if (isTruncated()) DialogAlert.show(props.dialog, "Retry Error", r.message)
  }

  const retryText = () => {
    const r = retry()
    if (!r) return ""
    const truncatedHint = isTruncated() ? " (click to expand)" : ""
    const duration = formatDuration(seconds())
    const retryInfo = ` [retrying ${duration ? `in ${duration} ` : ""}attempt #${r.attempt}]`
    return message() + truncatedHint + retryInfo
  }

  return (
    <Show when={retry()}>
      <box onMouseUp={handleMessageClick}>
        <text fg={props.theme.error}>{retryText()}</text>
      </box>
    </Show>
  )
}
