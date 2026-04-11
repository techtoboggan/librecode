import { batch } from "solid-js"
import { useRoute, useRouteData } from "@tui/context/route"
import { useSync } from "@tui/context/sync"
import { useLocal } from "@tui/context/local"
import { useSDK } from "@tui/context/sdk"
import type { ScrollBoxRenderable, CliRenderer } from "@opentui/core"
import { useCommandDialog } from "@tui/component/dialog-command"
import type { PromptRef } from "@tui/component/prompt"
import { DialogSessionRename } from "../../component/dialog-session-rename"
import { DialogTimeline } from "./dialog-timeline"
import { DialogForkFromTimeline } from "./dialog-fork-from-timeline"
import { Clipboard } from "../../util/clipboard"
import { DialogExportOptions } from "../../ui/dialog-export-options"
import { formatTranscript } from "../../util/transcript"
import { Editor } from "../../util/editor"
import { useToast, type ToastContext } from "../../ui/toast"
import type { PromptInfo } from "../../component/prompt/history"
import type { Part } from "@librecode/sdk/v2"
import path from "path"

type CommandDeps = {
  session: () => any
  messages: () => any[]
  sidebarVisible: () => boolean
  wide: () => boolean
  conceal: () => boolean
  showTimestamps: () => boolean
  showThinking: () => boolean
  showDetails: () => boolean
  showScrollbar: () => boolean
  showHeader: () => boolean
  showGenericToolOutput: () => boolean
  showAssistantMetadata: () => boolean
  // kv.signal setters have a different signature from createSignal setters; use loose types
  setSidebar: (next: any) => void
  setSidebarOpen: (next: any) => void
  setConceal: (next: any) => void
  setTimestamps: (next: any) => void
  setShowThinking: (next: any) => void
  setShowDetails: (next: any) => void
  setShowScrollbar: (next: any) => void
  setShowHeader: (next: any) => void
  setShowGenericToolOutput: (next: any) => void
  scroll: () => ScrollBoxRenderable
  promptRef: () => PromptRef
  toBottom: () => void
  scrollToMessage: (direction: "next" | "prev", dialog: any) => void
  scrollToLastUserMessage: (msgs: any[], parts: Record<string, Part[]>, scroll: ScrollBoxRenderable) => void
  moveFirstChild: () => void
  moveChild: (direction: number) => void
  childSessionHandler: (func: (dialog: any) => void) => (dialog: any) => void
  reducePartsToPromptInfo: (parts: Part[]) => { input: string; parts: PromptInfo["parts"] }
  renderer: CliRenderer
  toast: ToastContext
}

async function saveTranscriptToFile(
  transcript: string,
  filename: string,
  renderer: CliRenderer,
  toast: ToastContext,
): Promise<void> {
  const exportDir = process.cwd()
  const filepath = path.join(exportDir, filename)
  await Bun.write(filepath, transcript)
  const result = await Editor.open({ value: transcript, renderer })
  if (result !== undefined) {
    await Bun.write(filepath, result)
  }
  toast.show({ message: `Session exported to ${filename}`, variant: "success" })
}

export function useSessionCommands(deps: CommandDeps) {
  const route = useRouteData("session")
  const { navigate } = useRoute()
  const sync = useSync()
  const local = useLocal()
  const sdk = useSDK()
  const command = useCommandDialog()

  command.register(() => [
    {
      title: deps.session()?.share?.url ? "Copy share link" : "Share session",
      value: "session.share",
      suggested: route.type === "session",
      keybind: "session_share",
      category: "Session",
      enabled: sync.data.config.share !== "disabled",
      slash: { name: "share" },
      onSelect: async (dialog: any) => {
        const copy = (url: string) =>
          Clipboard.copy(url)
            .then(() => deps.toast.show({ message: "Share URL copied to clipboard!", variant: "success" }))
            .catch(() => deps.toast.show({ message: "Failed to copy URL to clipboard", variant: "error" }))
        const url = deps.session()?.share?.url
        if (url) {
          await copy(url)
          dialog.clear()
          return
        }
        await sdk.client.session
          .share({ sessionID: route.sessionID })
          .then((res: any) => copy(res.data!.share!.url))
          .catch((error: any) => {
            deps.toast.show({
              message: error instanceof Error ? error.message : "Failed to share session",
              variant: "error",
            })
          })
        dialog.clear()
      },
    },
    {
      title: "Rename session",
      value: "session.rename",
      keybind: "session_rename",
      category: "Session",
      slash: { name: "rename" },
      onSelect: (dialog: any) => {
        dialog.replace(() => <DialogSessionRename session={route.sessionID} />)
      },
    },
    {
      title: "Jump to message",
      value: "session.timeline",
      keybind: "session_timeline",
      category: "Session",
      slash: { name: "timeline" },
      onSelect: (dialog: any) => {
        dialog.replace(() => (
          <DialogTimeline
            onMove={(messageID: string) => {
              const child = deps.scroll().getChildren().find((child) => child.id === messageID)
              if (child) deps.scroll().scrollBy(child.y - deps.scroll().y - 1)
            }}
            sessionID={route.sessionID}
            setPrompt={(promptInfo: any) => deps.promptRef().set(promptInfo)}
          />
        ))
      },
    },
    {
      title: "Fork from message",
      value: "session.fork",
      keybind: "session_fork",
      category: "Session",
      slash: { name: "fork" },
      onSelect: (dialog: any) => {
        dialog.replace(() => (
          <DialogForkFromTimeline
            onMove={(messageID: string) => {
              const child = deps.scroll().getChildren().find((child) => child.id === messageID)
              if (child) deps.scroll().scrollBy(child.y - deps.scroll().y - 1)
            }}
            sessionID={route.sessionID}
          />
        ))
      },
    },
    {
      title: "Compact session",
      value: "session.compact",
      keybind: "session_compact",
      category: "Session",
      slash: { name: "compact", aliases: ["summarize"] },
      onSelect: (dialog: any) => {
        const selectedModel = local.model.current()
        if (!selectedModel) {
          deps.toast.show({ variant: "warning", message: "Connect a provider to summarize this session", duration: 3000 })
          return
        }
        sdk.client.session.summarize({
          sessionID: route.sessionID,
          modelID: selectedModel.modelID,
          providerID: selectedModel.providerID,
        })
        dialog.clear()
      },
    },
    {
      title: "Unshare session",
      value: "session.unshare",
      keybind: "session_unshare",
      category: "Session",
      enabled: !!deps.session()?.share?.url,
      slash: { name: "unshare" },
      onSelect: async (dialog: any) => {
        await sdk.client.session
          .unshare({ sessionID: route.sessionID })
          .then(() => deps.toast.show({ message: "Session unshared successfully", variant: "success" }))
          .catch((error: any) => {
            deps.toast.show({
              message: error instanceof Error ? error.message : "Failed to unshare session",
              variant: "error",
            })
          })
        dialog.clear()
      },
    },
    {
      title: "Undo previous message",
      value: "session.undo",
      keybind: "messages_undo",
      category: "Session",
      slash: { name: "undo" },
      onSelect: async (dialog: any) => {
        const status = sync.data.session_status?.[route.sessionID]
        if (status?.type !== "idle") await sdk.client.session.abort({ sessionID: route.sessionID }).catch(() => {})
        const revert = deps.session()?.revert?.messageID
        const message = deps.messages().findLast((x: any) => (!revert || x.id < revert) && x.role === "user")
        if (!message) return
        sdk.client.session.revert({ sessionID: route.sessionID, messageID: message.id }).then(() => deps.toBottom())
        const parts = sync.data.part[message.id]
        deps.promptRef().set(deps.reducePartsToPromptInfo(parts))
        dialog.clear()
      },
    },
    {
      title: "Redo",
      value: "session.redo",
      keybind: "messages_redo",
      category: "Session",
      enabled: !!deps.session()?.revert?.messageID,
      slash: { name: "redo" },
      onSelect: (dialog: any) => {
        dialog.clear()
        const messageID = deps.session()?.revert?.messageID
        if (!messageID) return
        const message = deps.messages().find((x: any) => x.role === "user" && x.id > messageID)
        if (!message) {
          sdk.client.session.unrevert({ sessionID: route.sessionID })
          deps.promptRef().set({ input: "", parts: [] })
          return
        }
        sdk.client.session.revert({ sessionID: route.sessionID, messageID: message.id })
      },
    },
  ])

  command.register(() => [
    {
      title: deps.sidebarVisible() ? "Hide sidebar" : "Show sidebar",
      value: "session.sidebar.toggle",
      keybind: "sidebar_toggle",
      category: "Session",
      onSelect: (dialog: any) => {
        batch(() => {
          const isVisible = deps.sidebarVisible()
          deps.setSidebar(() => (isVisible ? "hide" : "auto"))
          deps.setSidebarOpen(!isVisible)
        })
        dialog.clear()
      },
    },
    {
      title: deps.conceal() ? "Disable code concealment" : "Enable code concealment",
      value: "session.toggle.conceal",
      keybind: "messages_toggle_conceal" as any,
      category: "Session",
      onSelect: (dialog: any) => {
        deps.setConceal((prev: boolean) => !prev)
        dialog.clear()
      },
    },
    {
      title: deps.showTimestamps() ? "Hide timestamps" : "Show timestamps",
      value: "session.toggle.timestamps",
      category: "Session",
      slash: { name: "timestamps", aliases: ["toggle-timestamps"] },
      onSelect: (dialog: any) => {
        deps.setTimestamps((prev: "hide" | "show") => (prev === "show" ? "hide" : "show"))
        dialog.clear()
      },
    },
    {
      title: deps.showThinking() ? "Hide thinking" : "Show thinking",
      value: "session.toggle.thinking",
      keybind: "display_thinking",
      category: "Session",
      slash: { name: "thinking", aliases: ["toggle-thinking"] },
      onSelect: (dialog: any) => {
        deps.setShowThinking((prev: boolean) => !prev)
        dialog.clear()
      },
    },
  ])

  command.register(() => [
    {
      title: deps.showDetails() ? "Hide tool details" : "Show tool details",
      value: "session.toggle.actions",
      keybind: "tool_details",
      category: "Session",
      onSelect: (dialog: any) => {
        deps.setShowDetails((prev: boolean) => !prev)
        dialog.clear()
      },
    },
    {
      title: "Toggle session scrollbar",
      value: "session.toggle.scrollbar",
      keybind: "scrollbar_toggle",
      category: "Session",
      onSelect: (dialog: any) => {
        deps.setShowScrollbar((prev: boolean) => !prev)
        dialog.clear()
      },
    },
    {
      title: deps.showHeader() ? "Hide header" : "Show header",
      value: "session.toggle.header",
      category: "Session",
      onSelect: (dialog: any) => {
        deps.setShowHeader((prev: boolean) => !prev)
        dialog.clear()
      },
    },
    {
      title: deps.showGenericToolOutput() ? "Hide generic tool output" : "Show generic tool output",
      value: "session.toggle.generic_tool_output",
      category: "Session",
      onSelect: (dialog: any) => {
        deps.setShowGenericToolOutput((prev: boolean) => !prev)
        dialog.clear()
      },
    },
  ])

  command.register(() => [
    {
      title: "Page up",
      value: "session.page.up",
      keybind: "messages_page_up",
      category: "Session",
      hidden: true,
      onSelect: (dialog: any) => {
        deps.scroll().scrollBy(-deps.scroll().height / 2)
        dialog.clear()
      },
    },
    {
      title: "Page down",
      value: "session.page.down",
      keybind: "messages_page_down",
      category: "Session",
      hidden: true,
      onSelect: (dialog: any) => {
        deps.scroll().scrollBy(deps.scroll().height / 2)
        dialog.clear()
      },
    },
    {
      title: "Line up",
      value: "session.line.up",
      keybind: "messages_line_up",
      category: "Session",
      disabled: true,
      onSelect: (dialog: any) => {
        deps.scroll().scrollBy(-1)
        dialog.clear()
      },
    },
    {
      title: "Line down",
      value: "session.line.down",
      keybind: "messages_line_down",
      category: "Session",
      disabled: true,
      onSelect: (dialog: any) => {
        deps.scroll().scrollBy(1)
        dialog.clear()
      },
    },
    {
      title: "Half page up",
      value: "session.half.page.up",
      keybind: "messages_half_page_up",
      category: "Session",
      hidden: true,
      onSelect: (dialog: any) => {
        deps.scroll().scrollBy(-deps.scroll().height / 4)
        dialog.clear()
      },
    },
    {
      title: "Half page down",
      value: "session.half.page.down",
      keybind: "messages_half_page_down",
      category: "Session",
      hidden: true,
      onSelect: (dialog: any) => {
        deps.scroll().scrollBy(deps.scroll().height / 4)
        dialog.clear()
      },
    },
    {
      title: "First message",
      value: "session.first",
      keybind: "messages_first",
      category: "Session",
      hidden: true,
      onSelect: (dialog: any) => {
        deps.scroll().scrollTo(0)
        dialog.clear()
      },
    },
    {
      title: "Last message",
      value: "session.last",
      keybind: "messages_last",
      category: "Session",
      hidden: true,
      onSelect: (dialog: any) => {
        deps.scroll().scrollTo(deps.scroll().scrollHeight)
        dialog.clear()
      },
    },
    {
      title: "Jump to last user message",
      value: "session.messages_last_user",
      keybind: "messages_last_user",
      category: "Session",
      hidden: true,
      onSelect: () => {
        const msgs = sync.data.message[route.sessionID]
        if (!msgs || !msgs.length) return
        deps.scrollToLastUserMessage(msgs, sync.data.part, deps.scroll())
      },
    },
    {
      title: "Next message",
      value: "session.message.next",
      keybind: "messages_next",
      category: "Session",
      hidden: true,
      onSelect: (dialog: any) => deps.scrollToMessage("next", dialog),
    },
    {
      title: "Previous message",
      value: "session.message.previous",
      keybind: "messages_previous",
      category: "Session",
      hidden: true,
      onSelect: (dialog: any) => deps.scrollToMessage("prev", dialog),
    },
    {
      title: "Copy last assistant message",
      value: "messages.copy",
      keybind: "messages_copy",
      category: "Session",
      onSelect: (dialog: any) => {
        const revertID = deps.session()?.revert?.messageID
        const lastAssistantMessage = deps.messages().findLast(
          (msg: any) => msg.role === "assistant" && (!revertID || msg.id < revertID),
        )
        if (!lastAssistantMessage) {
          deps.toast.show({ message: "No assistant messages found", variant: "error" })
          dialog.clear()
          return
        }

        const parts = sync.data.part[lastAssistantMessage.id] ?? []
        const textParts = parts.filter((part: any) => part.type === "text")
        if (textParts.length === 0) {
          deps.toast.show({ message: "No text parts found in last assistant message", variant: "error" })
          dialog.clear()
          return
        }

        const text = textParts.map((part: any) => part.text).join("\n").trim()
        if (!text) {
          deps.toast.show({ message: "No text content found in last assistant message", variant: "error" })
          dialog.clear()
          return
        }

        Clipboard.copy(text)
          .then(() => deps.toast.show({ message: "Message copied to clipboard!", variant: "success" }))
          .catch(() => deps.toast.show({ message: "Failed to copy to clipboard", variant: "error" }))
        dialog.clear()
      },
    },
    {
      title: "Copy session transcript",
      value: "session.copy",
      category: "Session",
      slash: { name: "copy" },
      onSelect: async (dialog: any) => {
        try {
          const sessionData = deps.session()
          if (!sessionData) return
          const sessionMessages = deps.messages()
          const transcript = formatTranscript(
            sessionData,
            sessionMessages.map((msg: any) => ({ info: msg, parts: sync.data.part[msg.id] ?? [] })),
            { thinking: deps.showThinking(), toolDetails: deps.showDetails(), assistantMetadata: deps.showAssistantMetadata() },
          )
          await Clipboard.copy(transcript)
          deps.toast.show({ message: "Session transcript copied to clipboard!", variant: "success" })
        } catch (error) {
          deps.toast.show({ message: "Failed to copy session transcript", variant: "error" })
        }
        dialog.clear()
      },
    },
    {
      title: "Export session transcript",
      value: "session.export",
      keybind: "session_export",
      category: "Session",
      slash: { name: "export" },
      onSelect: async (dialog: any) => {
        try {
          const sessionData = deps.session()
          if (!sessionData) return
          const sessionMessages = deps.messages()
          const defaultFilename = `session-${sessionData.id.slice(0, 8)}.md`
          const options = await DialogExportOptions.show(
            dialog,
            defaultFilename,
            deps.showThinking(),
            deps.showDetails(),
            deps.showAssistantMetadata(),
            false,
          )
          if (options === null) return
          const transcript = formatTranscript(
            sessionData,
            sessionMessages.map((msg: any) => ({ info: msg, parts: sync.data.part[msg.id] ?? [] })),
            { thinking: options.thinking, toolDetails: options.toolDetails, assistantMetadata: options.assistantMetadata },
          )
          if (options.openWithoutSaving) {
            await Editor.open({ value: transcript, renderer: deps.renderer })
          } else {
            await saveTranscriptToFile(transcript, options.filename.trim(), deps.renderer, deps.toast)
          }
        } catch (error) {
          deps.toast.show({ message: "Failed to export session", variant: "error" })
        }
        dialog.clear()
      },
    },
    {
      title: "Go to child session",
      value: "session.child.first",
      keybind: "session_child_first",
      category: "Session",
      hidden: true,
      onSelect: (dialog: any) => {
        deps.moveFirstChild()
        dialog.clear()
      },
    },
    {
      title: "Go to parent session",
      value: "session.parent",
      keybind: "session_parent",
      category: "Session",
      hidden: true,
      enabled: !!deps.session()?.parentID,
      onSelect: deps.childSessionHandler((dialog) => {
        const parentID = deps.session()?.parentID
        if (parentID) navigate({ type: "session", sessionID: parentID })
        dialog.clear()
      }),
    },
    {
      title: "Next child session",
      value: "session.child.next",
      keybind: "session_child_cycle",
      category: "Session",
      hidden: true,
      enabled: !!deps.session()?.parentID,
      onSelect: deps.childSessionHandler((dialog) => {
        deps.moveChild(1)
        dialog.clear()
      }),
    },
    {
      title: "Previous child session",
      value: "session.child.previous",
      keybind: "session_child_cycle_reverse",
      category: "Session",
      hidden: true,
      enabled: !!deps.session()?.parentID,
      onSelect: deps.childSessionHandler((dialog) => {
        deps.moveChild(-1)
        dialog.clear()
      }),
    },
  ])
}
