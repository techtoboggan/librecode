import { TextareaRenderable, TextAttributes } from "@opentui/core"
import { useTheme } from "../context/theme"
import { useDialog, type DialogContext } from "./dialog"
import { createStore } from "solid-js/store"
import { onMount, Show, type JSX } from "solid-js"
import { useKeyboard } from "@opentui/solid"

export type DialogExportOptionsProps = {
  defaultFilename: string
  defaultThinking: boolean
  defaultToolDetails: boolean
  defaultAssistantMetadata: boolean
  defaultOpenWithoutSaving: boolean
  onConfirm?: (options: {
    filename: string
    thinking: boolean
    toolDetails: boolean
    assistantMetadata: boolean
    openWithoutSaving: boolean
  }) => void
  onCancel?: () => void
}

type ExportOptionField = "filename" | "thinking" | "toolDetails" | "assistantMetadata" | "openWithoutSaving"

const EXPORT_OPTION_ORDER: ExportOptionField[] = [
  "filename",
  "thinking",
  "toolDetails",
  "assistantMetadata",
  "openWithoutSaving",
]

const TOGGLEABLE_FIELDS = new Set<ExportOptionField>(["thinking", "toolDetails", "assistantMetadata", "openWithoutSaving"])

type CheckboxRowProps = {
  field: ExportOptionField
  checked: boolean
  active: ExportOptionField
  label: string
  onActivate: (field: ExportOptionField) => void
}

function CheckboxRow(props: CheckboxRowProps): JSX.Element {
  const { theme } = useTheme()
  const isActive = () => props.active === props.field
  return (
    <box
      flexDirection="row"
      gap={2}
      paddingLeft={1}
      backgroundColor={isActive() ? theme.backgroundElement : undefined}
      onMouseUp={() => props.onActivate(props.field)}
    >
      <text fg={isActive() ? theme.primary : theme.textMuted}>{props.checked ? "[x]" : "[ ]"}</text>
      <text fg={isActive() ? theme.primary : theme.text}>{props.label}</text>
    </box>
  )
}

export function DialogExportOptions(props: DialogExportOptionsProps) {
  const dialog = useDialog()
  const { theme } = useTheme()
  let textarea: TextareaRenderable
  const [store, setStore] = createStore({
    thinking: props.defaultThinking,
    toolDetails: props.defaultToolDetails,
    assistantMetadata: props.defaultAssistantMetadata,
    openWithoutSaving: props.defaultOpenWithoutSaving,
    active: "filename" as ExportOptionField,
  })

  function buildConfirmOptions() {
    return {
      filename: textarea.plainText,
      thinking: store.thinking,
      toolDetails: store.toolDetails,
      assistantMetadata: store.assistantMetadata,
      openWithoutSaving: store.openWithoutSaving,
    }
  }

  function handleTabKey(evt: { preventDefault: () => void }) {
    const currentIndex = EXPORT_OPTION_ORDER.indexOf(store.active)
    const nextIndex = (currentIndex + 1) % EXPORT_OPTION_ORDER.length
    setStore("active", EXPORT_OPTION_ORDER[nextIndex])
    evt.preventDefault()
  }

  function handleSpaceKey(evt: { preventDefault: () => void }) {
    if (!TOGGLEABLE_FIELDS.has(store.active)) return
    setStore(store.active as Exclude<ExportOptionField, "filename">, (prev: boolean) => !prev)
    evt.preventDefault()
  }

  useKeyboard((evt) => {
    if (evt.name === "return") props.onConfirm?.(buildConfirmOptions())
    if (evt.name === "tab") handleTabKey(evt)
    if (evt.name === "space" || evt.name === " ") handleSpaceKey(evt)
  })

  onMount(() => {
    dialog.setSize("medium")
    setTimeout(() => {
      if (!textarea || textarea.isDestroyed) return
      textarea.focus()
    }, 1)
    textarea.gotoLineEnd()
  })

  return (
    <box paddingLeft={2} paddingRight={2} gap={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text attributes={TextAttributes.BOLD} fg={theme.text}>
          Export Options
        </text>
        <text fg={theme.textMuted} onMouseUp={() => dialog.clear()}>
          esc
        </text>
      </box>
      <box gap={1}>
        <box>
          <text fg={theme.text}>Filename:</text>
        </box>
        <textarea
          onSubmit={() => props.onConfirm?.(buildConfirmOptions())}
          height={3}
          keyBindings={[{ name: "return", action: "submit" }]}
          ref={(val: TextareaRenderable) => (textarea = val)}
          initialValue={props.defaultFilename}
          placeholder="Enter filename"
          textColor={theme.text}
          focusedTextColor={theme.text}
          cursorColor={theme.text}
        />
      </box>
      <box flexDirection="column">
        <CheckboxRow field="thinking" checked={store.thinking} active={store.active} label="Include thinking" onActivate={(f) => setStore("active", f)} />
        <CheckboxRow field="toolDetails" checked={store.toolDetails} active={store.active} label="Include tool details" onActivate={(f) => setStore("active", f)} />
        <CheckboxRow field="assistantMetadata" checked={store.assistantMetadata} active={store.active} label="Include assistant metadata" onActivate={(f) => setStore("active", f)} />
        <CheckboxRow field="openWithoutSaving" checked={store.openWithoutSaving} active={store.active} label="Open without saving" onActivate={(f) => setStore("active", f)} />
      </box>
      <Show when={store.active !== "filename"}>
        <text fg={theme.textMuted} paddingBottom={1}>
          Press <span style={{ fg: theme.text }}>space</span> to toggle, <span style={{ fg: theme.text }}>return</span>{" "}
          to confirm
        </text>
      </Show>
      <Show when={store.active === "filename"}>
        <text fg={theme.textMuted} paddingBottom={1}>
          Press <span style={{ fg: theme.text }}>return</span> to confirm, <span style={{ fg: theme.text }}>tab</span>{" "}
          for options
        </text>
      </Show>
    </box>
  )
}

DialogExportOptions.show = (
  dialog: DialogContext,
  defaultFilename: string,
  defaultThinking: boolean,
  defaultToolDetails: boolean,
  defaultAssistantMetadata: boolean,
  defaultOpenWithoutSaving: boolean,
) => {
  return new Promise<{
    filename: string
    thinking: boolean
    toolDetails: boolean
    assistantMetadata: boolean
    openWithoutSaving: boolean
  } | null>((resolve) => {
    dialog.replace(
      () => (
        <DialogExportOptions
          defaultFilename={defaultFilename}
          defaultThinking={defaultThinking}
          defaultToolDetails={defaultToolDetails}
          defaultAssistantMetadata={defaultAssistantMetadata}
          defaultOpenWithoutSaving={defaultOpenWithoutSaving}
          onConfirm={(options) => resolve(options)}
          onCancel={() => resolve(null)}
        />
      ),
      () => resolve(null),
    )
  })
}
