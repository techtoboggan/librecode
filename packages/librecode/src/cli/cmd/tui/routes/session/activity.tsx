import type { EventActivityAgentEntry, EventActivityFileEntry } from "@librecode/sdk/v2"
import { RGBA } from "@opentui/core"
import { createMemo, createResource, For, onCleanup, Show, type JSX } from "solid-js"
import { createStore, reconcile } from "solid-js/store"
import { useKeybind } from "@tui/context/keybind"
import { useSDK } from "@tui/context/sdk"
import { useTheme } from "@tui/context/theme"

type ActivityState = {
  files: Record<string, EventActivityFileEntry>
  agents: Record<string, EventActivityAgentEntry>
}

const CELL_CHAR = "■"

function kindColor(kind: string, theme: ReturnType<typeof useTheme>["theme"]): RGBA {
  switch (kind) {
    case "write":
      return theme.warning
    case "read":
      return theme.info
    case "search":
      return theme.success
    case "shell":
      return RGBA.fromInts(180, 100, 220, 255)
    case "other":
      return theme.textMuted
    default:
      return RGBA.fromInts(80, 80, 80, 255)
  }
}

function shortPath(filePath: string, maxLen: number): string {
  if (filePath.length <= maxLen) return filePath
  const parts = filePath.split("/")
  const filename = parts[parts.length - 1] ?? filePath
  if (filename.length >= maxLen) return `…${filename.slice(-(maxLen - 1))}`
  return `…/${filename}`
}

function AgentStatusRow(props: { entry: EventActivityAgentEntry; theme: ReturnType<typeof useTheme>["theme"] }) {
  const phase = () => props.entry.phase
  const tool = () => props.entry.tool
  const file = () => props.entry.file

  const phaseColor = createMemo(() => {
    if (phase() === "running" || phase() === "tool") return props.theme.warning
    if (phase() === "complete") return props.theme.success
    if (phase() === "error") return props.theme.error
    return props.theme.textMuted
  })

  return (
    <box flexDirection="row" gap={1} flexShrink={0}>
      <text fg={phaseColor()}>●</text>
      <text fg={props.theme.textMuted} width={8}>
        {props.entry.agentID.slice(0, 8)}
      </text>
      <text fg={props.theme.text} width={12}>
        {phase()}
      </text>
      <Show when={tool()}>
        <text fg={props.theme.textMuted}>{tool()}</text>
      </Show>
      <Show when={file()}>{(f) => <text fg={props.theme.textMuted}> {shortPath(f(), 40)}</text>}</Show>
    </box>
  )
}

function FileRow(props: { entry: EventActivityFileEntry; theme: ReturnType<typeof useTheme>["theme"] }) {
  const color = createMemo(() => kindColor(props.entry.kind, props.theme))
  return (
    <box flexDirection="row" gap={1} flexShrink={0}>
      <text style={{ fg: color() }}>{CELL_CHAR}</text>
      <text fg={props.theme.textMuted} width={8}>
        {props.entry.kind}
      </text>
      <text fg={props.theme.text}>{shortPath(props.entry.path, 60)}</text>
      <Show when={props.entry.tool}>
        <text fg={props.theme.textMuted}> via {props.entry.tool}</text>
      </Show>
    </box>
  )
}

function ActivityLegend(props: { theme: ReturnType<typeof useTheme>["theme"] }) {
  const entries: Array<{ kind: string; label: string }> = [
    { kind: "write", label: "write" },
    { kind: "read", label: "read" },
    { kind: "search", label: "search" },
    { kind: "shell", label: "shell" },
    { kind: "idle", label: "idle" },
  ]

  return (
    <box flexDirection="row" gap={2} flexShrink={0} marginTop={1}>
      <For each={entries}>
        {(entry) => (
          <box flexDirection="row" gap={1}>
            <text style={{ fg: kindColor(entry.kind, props.theme) }}>{CELL_CHAR}</text>
            <text fg={props.theme.textMuted}>{entry.label}</text>
          </box>
        )}
      </For>
    </box>
  )
}

export function ActivityPanel(props: { sessionID: string; onClose: () => void }): JSX.Element {
  const sdk = useSDK()
  const { theme } = useTheme()
  const keybind = useKeybind()

  const [activity, setActivity] = createStore<ActivityState>({ files: {}, agents: {} })

  const [_initial] = createResource(async () => {
    try {
      const res = await sdk.fetch(`${sdk.url}/session/${props.sessionID}/activity`)
      if (!res.ok) return
      const data = (await res.json()) as ActivityState
      setActivity(reconcile(data))
    } catch {
      // silently ignore
    }
  })

  const unsub = sdk.event.on("activity.updated", (evt) => {
    if (evt.properties.sessionID !== props.sessionID) return
    setActivity(
      reconcile({
        files: evt.properties.files,
        agents: evt.properties.agents,
      }),
    )
  })
  onCleanup(unsub)

  const activeAgents = createMemo(() =>
    Object.values(activity.agents).filter((a) => a.phase !== "idle" && a.phase !== "complete"),
  )

  const recentFiles = createMemo(() =>
    Object.values(activity.files)
      .filter((f) => f.kind !== "idle")
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, 20),
  )

  return (
    <box
      position="absolute"
      top={0}
      right={0}
      bottom={0}
      width={80}
      backgroundColor={theme.backgroundPanel}
      paddingTop={1}
      paddingBottom={1}
      paddingLeft={2}
      paddingRight={2}
      flexDirection="column"
      gap={1}
      onKeyDown={(evt) => {
        if (evt.name === "escape" || keybind.match("session_activity", evt)) {
          props.onClose()
        }
      }}
    >
      <box flexDirection="row" justifyContent="space-between" flexShrink={0}>
        <text fg={theme.text}>
          <b>Activity</b>
        </text>
        <text fg={theme.textMuted}>ESC to close</text>
      </box>

      <Show
        when={activeAgents().length > 0}
        fallback={
          <box flexShrink={0}>
            <text fg={theme.textMuted}>No active agents</text>
          </box>
        }
      >
        <box flexDirection="column" gap={0} flexShrink={0}>
          <text fg={theme.textMuted}>
            <b>Agents</b>
          </text>
          <For each={activeAgents()}>{(entry) => <AgentStatusRow entry={entry} theme={theme} />}</For>
        </box>
      </Show>

      <Show when={recentFiles().length > 0}>
        <box flexDirection="column" gap={0} flexShrink={0}>
          <text fg={theme.textMuted}>
            <b>Files (recent)</b>
          </text>
          <For each={recentFiles()}>{(entry) => <FileRow entry={entry} theme={theme} />}</For>
        </box>
      </Show>

      <Show when={recentFiles().length === 0 && activeAgents().length === 0}>
        <text fg={theme.textMuted}>No recent activity</text>
      </Show>

      <ActivityLegend theme={theme} />

      <box flexShrink={0} marginTop={1}>
        <text fg={theme.textMuted}>
          {Object.keys(activity.files).length} files tracked · {Object.keys(activity.agents).length} agents tracked
        </text>
      </box>
    </box>
  )
}
