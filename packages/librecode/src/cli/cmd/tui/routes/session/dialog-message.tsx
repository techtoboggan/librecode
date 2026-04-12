import type { Part } from "@librecode/sdk/v2"
import type { PromptInfo } from "@tui/component/prompt/history"
import { useRoute } from "@tui/context/route"
import { useSDK } from "@tui/context/sdk"
import { useSync } from "@tui/context/sync"
import { DialogSelect } from "@tui/ui/dialog-select"
import { Clipboard } from "@tui/util/clipboard"
import { createMemo } from "solid-js"

function buildInitialPrompt(parts: Part[]): PromptInfo {
  return parts.reduce(
    (agg, part) => {
      if (part.type === "text" && !part.synthetic) agg.input += part.text
      if (part.type === "file") agg.parts.push(part)
      return agg
    },
    { input: "", parts: [] as PromptInfo["parts"] },
  )
}

function extractMessageText(parts: Part[]): string {
  return parts.reduce((agg, part) => {
    if (part.type === "text" && !part.synthetic) return agg + part.text
    return agg
  }, "")
}

export function DialogMessage(props: {
  messageID: string
  sessionID: string
  setPrompt?: (prompt: PromptInfo) => void
}) {
  const sync = useSync()
  const sdk = useSDK()
  const message = createMemo(() => sync.data.message[props.sessionID]?.find((x) => x.id === props.messageID))
  const route = useRoute()

  function handleRevert(dialog: { clear: () => void }): void {
    const msg = message()
    if (!msg) return
    sdk.client.session.revert({ sessionID: props.sessionID, messageID: msg.id })
    if (props.setPrompt) {
      props.setPrompt(buildInitialPrompt(sync.data.part[msg.id]))
    }
    dialog.clear()
  }

  async function handleCopy(dialog: { clear: () => void }): Promise<void> {
    const msg = message()
    if (!msg) return
    await Clipboard.copy(extractMessageText(sync.data.part[msg.id]))
    dialog.clear()
  }

  async function handleFork(dialog: { clear: () => void }): Promise<void> {
    const result = await sdk.client.session.fork({ sessionID: props.sessionID, messageID: props.messageID })
    const msg = message()
    const initialPrompt = msg ? buildInitialPrompt(sync.data.part[msg.id]) : undefined
    route.navigate({ sessionID: result.data!.id, type: "session", initialPrompt })
    dialog.clear()
  }

  return (
    <DialogSelect
      title="Message Actions"
      options={[
        {
          title: "Revert",
          value: "session.revert",
          description: "undo messages and file changes",
          onSelect: handleRevert,
        },
        {
          title: "Copy",
          value: "message.copy",
          description: "message text to clipboard",
          onSelect: handleCopy,
        },
        {
          title: "Fork",
          value: "session.fork",
          description: "create a new session",
          onSelect: handleFork,
        },
      ]}
    />
  )
}
