import { type BoxRenderable, type TextareaRenderable, type MouseEvent, type PasteEvent, type KeyEvent, type ParsedKey, t, dim, fg } from "@opentui/core"
import { createEffect, createMemo, type JSX, onMount, createSignal, onCleanup, on, Show, Switch, Match } from "solid-js"
import "opentui-spinner/solid"
import { useLocal } from "@tui/context/local"
import { useTheme } from "@tui/context/theme"
import { EmptyBorder } from "@tui/component/border"
import { useSDK } from "@tui/context/sdk"
import { useRoute } from "@tui/context/route"
import { useSync } from "@tui/context/sync"
import { MessageID, PartID } from "@/session/schema"
import { createStore, produce } from "solid-js/store"
import { useKeybind } from "@tui/context/keybind"
import { usePromptHistory, type PromptInfo } from "./history"
import { usePromptStash } from "./stash"
import { DialogStash } from "../dialog-stash"
import { type AutocompleteRef, Autocomplete } from "./autocomplete"
import { useCommandDialog } from "../dialog-command"
import { useRenderer } from "@opentui/solid"
import { Editor } from "@tui/util/editor"
import { useExit } from "../../context/exit"
import type { SessionStatus } from "@librecode/sdk/v2"
import { TuiEvent } from "../../event"
import { Locale } from "@/util/locale"
import { createColors, createFrames } from "../../ui/spinner.ts"
import { useDialog } from "@tui/ui/dialog"
import { DialogProvider as DialogProviderConnect } from "../dialog-provider"
import { useToast } from "../../ui/toast"
import { useKV } from "../../context/kv"
import { useTextareaKeybindings } from "../textarea-keybindings"
import { DialogSkill } from "../dialog-skill"
import { buildCommandArgs, isKnownSlashCommand, updatedPartPositionInContent } from "./prompt-helpers"
import { RetryStatusDisplay } from "./prompt-status"
import { usePromptPaste } from "./prompt-paste"

export type PromptProps = {
  sessionID?: string
  workspaceID?: string
  visible?: boolean
  disabled?: boolean
  onSubmit?: () => void
  ref?: (ref: PromptRef) => void
  hint?: JSX.Element
  showPlaceholder?: boolean
}

export type PromptRef = {
  focused: boolean
  current: PromptInfo
  set(prompt: PromptInfo): void
  reset(): void
  blur(): void
  focus(): void
  submit(): void
}

const PLACEHOLDERS = ["Fix a TODO in the codebase", "What is the tech stack of this project?", "Fix broken tests"]
const SHELL_PLACEHOLDERS = ["ls -la", "git status", "pwd"]

export function Prompt(props: PromptProps) {
  let input: TextareaRenderable
  let anchor: BoxRenderable
  let autocomplete: AutocompleteRef

  const keybind = useKeybind()
  const local = useLocal()
  const sdk = useSDK()
  const route = useRoute()
  const sync = useSync()
  const dialog = useDialog()
  const toast = useToast()
  const status = createMemo(() => sync.data.session_status?.[props.sessionID ?? ""] ?? { type: "idle" })
  const history = usePromptHistory()
  const stash = usePromptStash()
  const command = useCommandDialog()
  const renderer = useRenderer()
  const { theme, syntax } = useTheme()
  const kv = useKV()

  function promptModelWarning() {
    toast.show({
      variant: "warning",
      message: "Connect a provider to send prompts",
      duration: 3000,
    })
    if (sync.data.provider.length === 0) {
      dialog.replace(() => <DialogProviderConnect />)
    }
  }

  const textareaKeybindings = useTextareaKeybindings()

  const fileStyleId = syntax().getStyleId("extmark.file")!
  const agentStyleId = syntax().getStyleId("extmark.agent")!
  const pasteStyleId = syntax().getStyleId("extmark.paste")!
  let promptPartTypeId = 0

  sdk.event.on(TuiEvent.PromptAppend.type, (evt) => {
    if (!input || input.isDestroyed) return
    input.insertText(evt.properties.text)
    setTimeout(() => {
      // setTimeout is a workaround and needs to be addressed properly
      if (!input || input.isDestroyed) return
      input.getLayoutNode().markDirty()
      input.gotoBufferEnd()
      renderer.requestRender()
    }, 0)
  })

  createEffect(() => {
    if (props.disabled) input.cursorColor = theme.backgroundElement
    if (!props.disabled) input.cursorColor = theme.text
  })

  const lastUserMessage = createMemo(() => {
    if (!props.sessionID) return undefined
    const messages = sync.data.message[props.sessionID]
    if (!messages) return undefined
    return messages.findLast((m) => m.role === "user")
  })

  const [store, setStore] = createStore<{
    prompt: PromptInfo
    mode: "normal" | "shell"
    extmarkToPartIndex: Map<number, number>
    interrupt: number
    placeholder: number
  }>({
    placeholder: Math.floor(Math.random() * PLACEHOLDERS.length),
    prompt: {
      input: "",
      parts: [],
    },
    mode: "normal",
    extmarkToPartIndex: new Map(),
    interrupt: 0,
  })

  createEffect(
    on(
      () => props.sessionID,
      () => {
        setStore("placeholder", Math.floor(Math.random() * PLACEHOLDERS.length))
      },
      { defer: true },
    ),
  )

  // Initialize agent/model/variant from last user message when session changes
  let syncedSessionID: string | undefined

  function syncAgentFromMessage(msg: ReturnType<typeof lastUserMessage>): void {
    if (!msg?.agent) return
    const isPrimaryAgent = local.agent.list().some((x) => x.name === msg.agent)
    if (!isPrimaryAgent) return
    local.agent.set(msg.agent)
    if (msg.model) local.model.set(msg.model)
    if (msg.variant) local.model.variant.set(msg.variant)
  }

  createEffect(() => {
    const sessionID = props.sessionID
    const msg = lastUserMessage()
    if (sessionID === syncedSessionID) return
    if (!sessionID || !msg) return
    syncedSessionID = sessionID
    syncAgentFromMessage(msg)
  })

  // ---------------------------------------------------------------------------
  // Paste handlers — via extracted hook
  // ---------------------------------------------------------------------------

  const { pasteText, pasteImage, handleKeyDownPaste, onPaste } = usePromptPaste({
    getInput: () => input,
    store,
    setStore: setStore as unknown as Parameters<typeof usePromptPaste>[0]["setStore"],
    pasteStyleId,
    getPromptPartTypeId: () => promptPartTypeId,
  })

  // ---------------------------------------------------------------------------
  // Command onSelect handlers — extracted to reduce complexity of register callbacks
  // ---------------------------------------------------------------------------

  function handleInterruptSelect(dialogClear: () => void): void {
    if (autocomplete.visible) return
    if (!input.focused) return
    // TODO: this should be its own command
    if (store.mode === "shell") {
      setStore("mode", "normal")
      return
    }
    if (!props.sessionID) return

    setStore("interrupt", store.interrupt + 1)
    setTimeout(() => {
      setStore("interrupt", 0)
    }, 5000)

    if (store.interrupt >= 2) {
      sdk.client.session.abort({ sessionID: props.sessionID })
      setStore("interrupt", 0)
    }
    dialogClear()
  }

  async function handleEditorOpen(dialogClear: () => void): Promise<void> {
    dialogClear()

    // Replace summarized text parts with the actual text
    const text = store.prompt.parts
      .filter((p) => p.type === "text")
      .reduce((acc, p) => {
        if (!p.source) return acc
        return acc.replace(p.source.text.value, p.text)
      }, store.prompt.input)

    const nonTextParts = store.prompt.parts.filter((p) => p.type !== "text")

    const content = await Editor.open({ value: text, renderer })
    if (!content) return

    input.setText(content)

    const updatedNonTextParts = nonTextParts
      .map((part) => updatedPartPositionInContent(part, content))
      .filter((part): part is PromptInfo["parts"][number] => part !== null)

    setStore("prompt", { input: content, parts: updatedNonTextParts })
    restoreExtmarksFromParts(updatedNonTextParts)
    input.cursorOffset = Bun.stringWidth(content)
  }

  command.register(() => {
    return [
      {
        title: "Clear prompt",
        value: "prompt.clear",
        category: "Prompt",
        hidden: true,
        onSelect: (dialog) => {
          input.extmarks.clear()
          input.clear()
          dialog.clear()
        },
      },
      {
        title: "Submit prompt",
        value: "prompt.submit",
        keybind: "input_submit",
        category: "Prompt",
        hidden: true,
        onSelect: (dialog) => {
          if (!input.focused) return
          submit()
          dialog.clear()
        },
      },
      {
        title: "Paste",
        value: "prompt.paste",
        keybind: "input_paste",
        category: "Prompt",
        hidden: true,
        onSelect: async () => {
          const content = await import("../../util/clipboard").then((m) => m.Clipboard.read())
          if (content?.mime.startsWith("image/")) {
            await pasteImage({
              filename: "clipboard",
              mime: content.mime,
              content: content.data,
            })
          }
        },
      },
      {
        title: "Interrupt session",
        value: "session.interrupt",
        keybind: "session_interrupt",
        category: "Session",
        hidden: true,
        enabled: status().type !== "idle",
        onSelect: (dialog) => handleInterruptSelect(dialog.clear.bind(dialog)),
      },
      {
        title: "Open editor",
        category: "Session",
        keybind: "editor_open",
        value: "prompt.editor",
        slash: {
          name: "editor",
        },
        onSelect: async (dialog) => handleEditorOpen(dialog.clear.bind(dialog)),
      },
      {
        title: "Skills",
        value: "prompt.skills",
        category: "Prompt",
        slash: {
          name: "skills",
        },
        onSelect: () => {
          dialog.replace(() => (
            <DialogSkill
              onSelect={(skill) => {
                input.setText(`/${skill} `)
                setStore("prompt", {
                  input: `/${skill} `,
                  parts: [],
                })
                input.gotoBufferEnd()
              }}
            />
          ))
        },
      },
    ]
  })

  const ref: PromptRef = {
    get focused() {
      return input.focused
    },
    get current() {
      return store.prompt
    },
    focus() {
      input.focus()
    },
    blur() {
      input.blur()
    },
    set(prompt) {
      input.setText(prompt.input)
      setStore("prompt", prompt)
      restoreExtmarksFromParts(prompt.parts)
      input.gotoBufferEnd()
    },
    reset() {
      input.clear()
      input.extmarks.clear()
      setStore("prompt", {
        input: "",
        parts: [],
      })
      setStore("extmarkToPartIndex", new Map())
    },
    submit() {
      submit()
    },
  }

  createEffect(() => {
    if (props.visible !== false) input?.focus()
    if (props.visible === false) input?.blur()
  })

  function resolvePartExtmarkInfo(
    part: PromptInfo["parts"][number],
  ): { start: number; end: number; virtualText: string; styleId: number | undefined } | null {
    if (part.type === "file" && part.source?.text) {
      return {
        start: part.source.text.start,
        end: part.source.text.end,
        virtualText: part.source.text.value,
        styleId: fileStyleId,
      }
    }
    if (part.type === "agent" && part.source) {
      return { start: part.source.start, end: part.source.end, virtualText: part.source.value, styleId: agentStyleId }
    }
    if (part.type === "text" && part.source?.text) {
      return {
        start: part.source.text.start,
        end: part.source.text.end,
        virtualText: part.source.text.value,
        styleId: pasteStyleId,
      }
    }
    return null
  }

  function restoreExtmarksFromParts(parts: PromptInfo["parts"]) {
    input.extmarks.clear()
    setStore("extmarkToPartIndex", new Map())

    parts.forEach((part, partIndex) => {
      const info = resolvePartExtmarkInfo(part)
      if (!info) return

      const extmarkId = input.extmarks.create({
        start: info.start,
        end: info.end,
        virtual: true,
        styleId: info.styleId,
        typeId: promptPartTypeId,
      })
      setStore("extmarkToPartIndex", (map: Map<number, number>) => {
        const newMap = new Map(map)
        newMap.set(extmarkId, partIndex)
        return newMap
      })
    })
  }

  function applyExtmarkPositionToDraftPart(
    part: PromptInfo["parts"][number],
    extmark: { start: number; end: number },
  ): void {
    if (part.type === "agent" && part.source) {
      part.source.start = extmark.start
      part.source.end = extmark.end
    } else if (part.type === "file" && part.source?.text) {
      part.source.text.start = extmark.start
      part.source.text.end = extmark.end
    } else if (part.type === "text" && part.source?.text) {
      part.source.text.start = extmark.start
      part.source.text.end = extmark.end
    }
  }

  function syncExtmarksWithPromptParts() {
    const allExtmarks = input.extmarks.getAllForTypeId(promptPartTypeId)
    setStore(
      produce((draft) => {
        const newMap = new Map<number, number>()
        const newParts: typeof draft.prompt.parts = []

        for (const extmark of allExtmarks) {
          const partIndex = draft.extmarkToPartIndex.get(extmark.id)
          if (partIndex === undefined) continue
          const part = draft.prompt.parts[partIndex]
          if (!part) continue
          applyExtmarkPositionToDraftPart(part, extmark)
          newMap.set(extmark.id, newParts.length)
          newParts.push(part)
        }

        draft.extmarkToPartIndex = newMap
        draft.prompt.parts = newParts
      }),
    )
  }

  command.register(() => [
    {
      title: "Stash prompt",
      value: "prompt.stash",
      category: "Prompt",
      enabled: !!store.prompt.input,
      onSelect: (dialog) => {
        if (!store.prompt.input) return
        stash.push({
          input: store.prompt.input,
          parts: store.prompt.parts,
        })
        input.extmarks.clear()
        input.clear()
        setStore("prompt", { input: "", parts: [] })
        setStore("extmarkToPartIndex", new Map())
        dialog.clear()
      },
    },
    {
      title: "Stash pop",
      value: "prompt.stash.pop",
      category: "Prompt",
      enabled: stash.list().length > 0,
      onSelect: (dialog) => {
        const entry = stash.pop()
        if (entry) {
          input.setText(entry.input)
          setStore("prompt", { input: entry.input, parts: entry.parts })
          restoreExtmarksFromParts(entry.parts)
          input.gotoBufferEnd()
        }
        dialog.clear()
      },
    },
    {
      title: "Stash list",
      value: "prompt.stash.list",
      category: "Prompt",
      enabled: stash.list().length > 0,
      onSelect: (dialog) => {
        dialog.replace(() => (
          <DialogStash
            onSelect={(entry) => {
              input.setText(entry.input)
              setStore("prompt", { input: entry.input, parts: entry.parts })
              restoreExtmarksFromParts(entry.parts)
              input.gotoBufferEnd()
            }}
          />
        ))
      },
    },
  ])

  function dispatchShellSubmit(
    sessionID: string,
    inputText: string,
    selectedModel: { providerID: string; modelID: string },
  ): void {
    sdk.client.session.shell({
      sessionID,
      agent: local.agent.current().name,
      model: { providerID: selectedModel.providerID, modelID: selectedModel.modelID },
      command: inputText,
    })
    setStore("mode", "normal")
  }

  function dispatchCommandSubmit(
    sessionID: string,
    inputText: string,
    selectedModel: { providerID: string; modelID: string },
    messageID: string,
    variant: string | undefined,
    nonTextParts: PromptInfo["parts"],
  ): void {
    const { commandName, args } = buildCommandArgs(inputText)
    sdk.client.session.command({
      sessionID,
      command: commandName,
      arguments: args,
      agent: local.agent.current().name,
      model: `${selectedModel.providerID}/${selectedModel.modelID}`,
      messageID,
      variant,
      parts: nonTextParts.filter((x) => x.type === "file").map((x) => ({ id: PartID.ascending(), ...x })),
    })
  }

  function dispatchPromptSubmit(
    sessionID: string,
    inputText: string,
    selectedModel: ReturnType<typeof local.model.current>,
    messageID: string,
    variant: string | undefined,
    nonTextParts: PromptInfo["parts"],
  ): void {
    sdk.client.session
      .prompt({
        sessionID,
        ...selectedModel,
        messageID,
        agent: local.agent.current().name,
        model: selectedModel,
        variant,
        parts: [
          { id: PartID.ascending(), type: "text", text: inputText },
          ...nonTextParts.map((x) => ({ id: PartID.ascending(), ...x })),
        ],
      })
      .catch(() => {})
  }

  function expandInputText(): string {
    const allExtmarks = input.extmarks.getAllForTypeId(promptPartTypeId)
    const sortedExtmarks = allExtmarks.slice().sort((a: { start: number }, b: { start: number }) => b.start - a.start)
    let text = store.prompt.input
    for (const extmark of sortedExtmarks) {
      const partIndex = store.extmarkToPartIndex.get(extmark.id)
      if (partIndex === undefined) continue
      const part = store.prompt.parts[partIndex]
      if (part?.type === "text" && part.text) {
        text = text.slice(0, extmark.start) + part.text + text.slice(extmark.end)
      }
    }
    return text
  }

  async function resolveSessionID(): Promise<string | null> {
    if (props.sessionID != null) return props.sessionID
    const res = await sdk.client.session.create({ workspaceID: props.workspaceID })
    if (res.error) {
      console.log("Creating a session failed:", res.error)
      toast.show({ message: "Creating a session failed. Open console for more details.", variant: "error" })
      return null
    }
    return res.data.id
  }

  function isExitCommand(inputStr: string): boolean {
    const t = inputStr.trim()
    return t === "exit" || t === "quit" || t === ":q"
  }

  function dispatchToSession(
    sessionID: string,
    inputText: string,
    selectedModel: NonNullable<ReturnType<typeof local.model.current>>,
    messageID: string,
    variant: string | undefined,
    nonTextParts: PromptInfo["parts"],
  ): void {
    if (store.mode === "shell") {
      dispatchShellSubmit(sessionID, inputText, selectedModel)
    } else if (isKnownSlashCommand(inputText, sync.data.command)) {
      dispatchCommandSubmit(sessionID, inputText, selectedModel, messageID, variant, nonTextParts)
    } else {
      dispatchPromptSubmit(sessionID, inputText, selectedModel, messageID, variant, nonTextParts)
    }
  }

  function afterSubmitCleanup(currentMode: string, sessionID: string): void {
    input.extmarks.clear()
    setStore("prompt", { input: "", parts: [] })
    setStore("extmarkToPartIndex", new Map())
    props.onSubmit?.()
    if (!props.sessionID)
      setTimeout(() => {
        route.navigate({ type: "session", sessionID })
      }, 50)
    input.clear()
  }

  async function submit() {
    if (props.disabled) return
    if (autocomplete?.visible) return
    if (!store.prompt.input) return
    if (isExitCommand(store.prompt.input)) {
      exit()
      return
    }
    const selectedModel = local.model.current()
    if (!selectedModel) {
      promptModelWarning()
      return
    }

    const sessionID = await resolveSessionID()
    if (!sessionID) return

    const messageID = MessageID.ascending()
    const inputText = expandInputText()
    const nonTextParts = store.prompt.parts.filter((part) => part.type !== "text")
    const currentMode = store.mode
    const variant = local.model.variant.current()

    history.append({ ...store.prompt, mode: currentMode })
    dispatchToSession(sessionID, inputText, selectedModel, messageID, variant, nonTextParts)
    afterSubmitCleanup(currentMode, sessionID)
  }
  const exit = useExit()

  // ---------------------------------------------------------------------------
  // Keyboard handler helpers — extracted to reduce onKeyDown complexity
  // ---------------------------------------------------------------------------

  function handleKeyDownClear(e: { preventDefault(): void }): boolean {
    if (store.prompt.input === "") return false
    input.clear()
    input.extmarks.clear()
    setStore("prompt", { input: "", parts: [] })
    setStore("extmarkToPartIndex", new Map())
    e.preventDefault()
    return true
  }

  async function handleKeyDownExit(e: { preventDefault(): void }): Promise<void> {
    if (store.prompt.input === "") {
      await exit()
      e.preventDefault()
    }
  }

  function handleKeyDownShellMode(e: { name: string; preventDefault(): void }): boolean {
    if (e.name === "!" && input.visualCursor.offset === 0) {
      setStore("placeholder", Math.floor(Math.random() * SHELL_PLACEHOLDERS.length))
      setStore("mode", "shell")
      e.preventDefault()
      return true
    }
    if (store.mode === "shell") {
      if ((e.name === "backspace" && input.visualCursor.offset === 0) || e.name === "escape") {
        setStore("mode", "normal")
        e.preventDefault()
        return true
      }
    }
    return false
  }

  function applyHistoryItem(
    item: PromptInfo & { mode?: "normal" | "shell" },
    direction: -1 | 1,
    e: { preventDefault(): void },
  ): void {
    input.setText(item.input)
    setStore("prompt", item)
    setStore("mode", item.mode ?? "normal")
    restoreExtmarksFromParts(item.parts)
    e.preventDefault()
    input.cursorOffset = direction === -1 ? 0 : input.plainText.length
  }

  function handleHistoryNavigation(isPrev: boolean, isNext: boolean, e: KeyEvent): void {
    const direction: -1 | 1 = isPrev ? -1 : 1
    const item = history.move(direction, input.plainText)
    if (item) applyHistoryItem(item, direction, e)
  }

  function handleKeyDownHistory(e: KeyEvent): void {
    const isPrev = !!keybind.match("history_previous", e)
    const isNext = !!keybind.match("history_next", e)
    const atStart = input.cursorOffset === 0
    const atEnd = input.cursorOffset === input.plainText.length

    if ((isPrev && atStart) || (isNext && atEnd)) {
      handleHistoryNavigation(isPrev, isNext, e)
      return
    }
    if (isPrev && input.visualCursor.visualRow === 0) input.cursorOffset = 0
    if (isNext && input.visualCursor.visualRow === input.height - 1) input.cursorOffset = input.plainText.length
  }

  async function handleSpecialKeys(e: KeyEvent): Promise<boolean> {
    if (keybind.match("input_paste", e)) {
      const handled = await handleKeyDownPaste(e)
      if (handled) return true
      // If no image, let the default paste behavior continue
    }
    if (keybind.match("input_clear", e) && handleKeyDownClear(e)) return true
    if (keybind.match("app_exit", e)) {
      await handleKeyDownExit(e)
      return true
    }
    return handleKeyDownShellMode(e)
  }

  async function onTextareaKeyDown(e: KeyEvent): Promise<void> {
    if (props.disabled) {
      e.preventDefault()
      return
    }
    if (await handleSpecialKeys(e)) return
    if (store.mode === "normal") autocomplete.onKeyDown(e)
    if (!autocomplete.visible) handleKeyDownHistory(e)
  }

  const highlight = createMemo(() => {
    if (keybind.leader) return theme.border
    if (store.mode === "shell") return theme.primary
    return local.agent.color(local.agent.current().name)
  })

  const showVariant = createMemo(() => {
    const variants = local.model.variant.list()
    if (variants.length === 0) return false
    const current = local.model.variant.current()
    return !!current
  })

  const placeholderText = createMemo(() => {
    if (props.sessionID) return undefined
    if (store.mode === "shell") {
      const example = SHELL_PLACEHOLDERS[store.placeholder % SHELL_PLACEHOLDERS.length]
      return `Run a command... "${example}"`
    }
    return `Ask anything... "${PLACEHOLDERS[store.placeholder % PLACEHOLDERS.length]}"`
  })

  const spinnerDef = createMemo(() => {
    const color = local.agent.color(local.agent.current().name)
    return {
      frames: createFrames({
        color,
        style: "blocks",
        inactiveFactor: 0.6,
        minAlpha: 0.3,
      }),
      color: createColors({
        color,
        style: "blocks",
        inactiveFactor: 0.6,
        minAlpha: 0.3,
      }),
    }
  })

  return (
    <>
      <Autocomplete
        sessionID={props.sessionID}
        ref={(r) => (autocomplete = r)}
        anchor={() => anchor}
        input={() => input}
        setPrompt={(cb) => {
          setStore("prompt", produce(cb))
        }}
        setExtmark={(partIndex, extmarkId) => {
          setStore("extmarkToPartIndex", (map: Map<number, number>) => {
            const newMap = new Map(map)
            newMap.set(extmarkId, partIndex)
            return newMap
          })
        }}
        value={store.prompt.input}
        fileStyleId={fileStyleId}
        agentStyleId={agentStyleId}
        promptPartTypeId={() => promptPartTypeId}
      />
      <box ref={(r) => (anchor = r)} visible={props.visible !== false}>
        <box
          border={["left"]}
          borderColor={highlight()}
          customBorderChars={{
            ...EmptyBorder,
            vertical: "┃",
            bottomLeft: "╹",
          }}
        >
          <box
            paddingLeft={2}
            paddingRight={2}
            paddingTop={1}
            flexShrink={0}
            backgroundColor={theme.backgroundElement}
            flexGrow={1}
          >
            <textarea
              placeholder={placeholderText()}
              textColor={keybind.leader ? theme.textMuted : theme.text}
              focusedTextColor={keybind.leader ? theme.textMuted : theme.text}
              minHeight={1}
              maxHeight={6}
              onContentChange={() => {
                const value = input.plainText
                setStore("prompt", "input", value)
                autocomplete.onInput(value)
                syncExtmarksWithPromptParts()
              }}
              keyBindings={textareaKeybindings()}
              onKeyDown={onTextareaKeyDown}
              onSubmit={submit}
              onPaste={(event: PasteEvent) => onPaste(event, !!props.disabled)}
              ref={(r: TextareaRenderable) => {
                input = r
                if (promptPartTypeId === 0) {
                  promptPartTypeId = input.extmarks.registerType("prompt-part")
                }
                props.ref?.(ref)
                setTimeout(() => {
                  // setTimeout is a workaround and needs to be addressed properly
                  if (!input || input.isDestroyed) return
                  input.cursorColor = theme.text
                }, 0)
              }}
              onMouseDown={(r: MouseEvent) => r.target?.focus()}
              focusedBackgroundColor={theme.backgroundElement}
              cursorColor={theme.text}
              syntaxStyle={syntax()}
            />
            <box flexDirection="row" flexShrink={0} paddingTop={1} gap={1}>
              <text fg={highlight()}>
                {store.mode === "shell" ? "Shell" : Locale.titlecase(local.agent.current().name)}{" "}
              </text>
              <Show when={store.mode === "normal"}>
                <box flexDirection="row" gap={1}>
                  <text flexShrink={0} fg={keybind.leader ? theme.textMuted : theme.text}>
                    {local.model.parsed().model}
                  </text>
                  <text fg={theme.textMuted}>{local.model.parsed().provider}</text>
                  <Show when={showVariant()}>
                    <text fg={theme.textMuted}>·</text>
                    <text>
                      <span style={{ fg: theme.warning, bold: true }}>{local.model.variant.current()}</span>
                    </text>
                  </Show>
                </box>
              </Show>
            </box>
          </box>
        </box>
        <box
          height={1}
          border={["left"]}
          borderColor={highlight()}
          customBorderChars={{
            ...EmptyBorder,
            vertical: theme.backgroundElement.a !== 0 ? "╹" : " ",
          }}
        >
          <box
            height={1}
            border={["bottom"]}
            borderColor={theme.backgroundElement}
            customBorderChars={
              theme.backgroundElement.a !== 0
                ? {
                    ...EmptyBorder,
                    horizontal: "▀",
                  }
                : {
                    ...EmptyBorder,
                    horizontal: " ",
                  }
            }
          />
        </box>
        <box flexDirection="row" justifyContent="space-between">
          <Show when={status().type !== "idle"} fallback={<text />}>
            <box
              flexDirection="row"
              gap={1}
              flexGrow={1}
              justifyContent={status().type === "retry" ? "space-between" : "flex-start"}
            >
              <box flexShrink={0} flexDirection="row" gap={1}>
                <box marginLeft={1}>
                  <Show when={kv.get("animations_enabled", true)} fallback={<text fg={theme.textMuted}>[⋯]</text>}>
                    <spinner color={spinnerDef().color} frames={spinnerDef().frames} interval={40} />
                  </Show>
                </box>
                <box flexDirection="row" gap={1} flexShrink={0}>
                  <RetryStatusDisplay status={status} dialog={dialog} theme={theme} />
                </box>
              </box>
              <text fg={store.interrupt > 0 ? theme.primary : theme.text}>
                esc{" "}
                <span style={{ fg: store.interrupt > 0 ? theme.primary : theme.textMuted }}>
                  {store.interrupt > 0 ? "again to interrupt" : "interrupt"}
                </span>
              </text>
            </box>
          </Show>
          <Show when={status().type !== "retry"}>
            <box gap={2} flexDirection="row">
              <Switch>
                <Match when={store.mode === "normal"}>
                  <Show when={local.model.variant.list().length > 0}>
                    <text fg={theme.text}>
                      {keybind.print("variant_cycle")} <span style={{ fg: theme.textMuted }}>variants</span>
                    </text>
                  </Show>
                  <text fg={theme.text}>
                    {keybind.print("agent_cycle")} <span style={{ fg: theme.textMuted }}>agents</span>
                  </text>
                  <text fg={theme.text}>
                    {keybind.print("command_list")} <span style={{ fg: theme.textMuted }}>commands</span>
                  </text>
                </Match>
                <Match when={store.mode === "shell"}>
                  <text fg={theme.text}>
                    esc <span style={{ fg: theme.textMuted }}>exit shell mode</span>
                  </text>
                </Match>
              </Switch>
            </box>
          </Show>
        </box>
      </box>
    </>
  )
}
