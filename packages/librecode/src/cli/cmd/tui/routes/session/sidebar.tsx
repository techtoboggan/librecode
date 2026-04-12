
import type { AssistantMessage } from "@librecode/sdk/v2"
import type { RGBA } from "@opentui/core"
import { useSync } from "@tui/context/sync"
import { createMemo, For, Match, Show, Switch } from "solid-js"
import { createStore } from "solid-js/store"
import { Installation } from "@/installation"
import { TodoItem } from "../../component/todo-item"
import { useDirectory } from "../../context/directory"
import { useKV } from "../../context/kv"
import { useTheme } from "../../context/theme"

type Theme = ReturnType<typeof useTheme>["theme"]
type SyncData = ReturnType<typeof useSync>

type McpEntry = [string, SyncData["data"]["mcp"][string]]

function McpStatusDot(props: { status: string; theme: Theme }) {
  const colorMap: Record<string, RGBA> = {
    connected: props.theme.success,
    failed: props.theme.error,
    disabled: props.theme.textMuted,
    needs_auth: props.theme.warning,
    needs_client_registration: props.theme.error,
  }
  return (
    <text flexShrink={0} style={{ fg: colorMap[props.status] }}>
      •
    </text>
  )
}

function McpStatusLabel(props: { entry: McpEntry[1]; theme: Theme }) {
  const item = props.entry
  return (
    <span style={{ fg: props.theme.textMuted }}>
      <Switch fallback={item.status}>
        <Match when={item.status === "connected"}>Connected</Match>
        <Match when={item.status === "failed" && item}>{(val) => <i>{val().error}</i>}</Match>
        <Match when={item.status === "disabled"}>Disabled</Match>
        <Match when={(item.status as string) === "needs_auth"}>Needs auth</Match>
        <Match when={(item.status as string) === "needs_client_registration"}>Needs client ID</Match>
      </Switch>
    </span>
  )
}

function McpSection(props: {
  entries: McpEntry[]
  connectedCount: number
  errorCount: number
  expanded: boolean
  onToggle: () => void
  theme: Theme
}) {
  return (
    <Show when={props.entries.length > 0}>
      <box>
        <box flexDirection="row" gap={1} onMouseDown={() => props.entries.length > 2 && props.onToggle()}>
          <Show when={props.entries.length > 2}>
            <text fg={props.theme.text}>{props.expanded ? "▼" : "▶"}</text>
          </Show>
          <text fg={props.theme.text}>
            <b>MCP</b>
            <Show when={!props.expanded}>
              <span style={{ fg: props.theme.textMuted }}>
                {" "}
                ({props.connectedCount} active
                {props.errorCount > 0 ? `, ${props.errorCount} error${props.errorCount > 1 ? "s" : ""}` : ""})
              </span>
            </Show>
          </text>
        </box>
        <Show when={props.entries.length <= 2 || props.expanded}>
          <For each={props.entries}>
            {([key, item]) => (
              <box flexDirection="row" gap={1}>
                <McpStatusDot status={item.status} theme={props.theme} />
                <text fg={props.theme.text} wrapMode="word">
                  {key} <McpStatusLabel entry={item} theme={props.theme} />
                </text>
              </box>
            )}
          </For>
        </Show>
      </box>
    </Show>
  )
}

function LspSection(props: {
  lspItems: SyncData["data"]["lsp"]
  lspDisabled: boolean
  expanded: boolean
  onToggle: () => void
  theme: Theme
}) {
  return (
    <box>
      <box flexDirection="row" gap={1} onMouseDown={() => props.lspItems.length > 2 && props.onToggle()}>
        <Show when={props.lspItems.length > 2}>
          <text fg={props.theme.text}>{props.expanded ? "▼" : "▶"}</text>
        </Show>
        <text fg={props.theme.text}>
          <b>LSP</b>
        </text>
      </box>
      <Show when={props.lspItems.length <= 2 || props.expanded}>
        <Show when={props.lspItems.length === 0}>
          <text fg={props.theme.textMuted}>
            {props.lspDisabled ? "LSPs have been disabled in settings" : "LSPs will activate as files are read"}
          </text>
        </Show>
        <For each={props.lspItems}>
          {(item) => (
            <box flexDirection="row" gap={1}>
              <text
                flexShrink={0}
                style={{
                  fg: { connected: props.theme.success, error: props.theme.error }[item.status],
                }}
              >
                •
              </text>
              <text fg={props.theme.textMuted}>
                {item.id} {item.root}
              </text>
            </box>
          )}
        </For>
      </Show>
    </box>
  )
}

function TodoSection(props: {
  items: SyncData["data"]["todo"][string]
  expanded: boolean
  onToggle: () => void
  theme: Theme
}) {
  return (
    <Show when={props.items.length > 0 && props.items.some((t) => t.status !== "completed")}>
      <box>
        <box flexDirection="row" gap={1} onMouseDown={() => props.items.length > 2 && props.onToggle()}>
          <Show when={props.items.length > 2}>
            <text fg={props.theme.text}>{props.expanded ? "▼" : "▶"}</text>
          </Show>
          <text fg={props.theme.text}>
            <b>Todo</b>
          </text>
        </box>
        <Show when={props.items.length <= 2 || props.expanded}>
          <For each={props.items}>{(todo) => <TodoItem status={todo.status} content={todo.content} />}</For>
        </Show>
      </box>
    </Show>
  )
}

function DiffSection(props: {
  items: SyncData["data"]["session_diff"][string]
  expanded: boolean
  onToggle: () => void
  theme: Theme
}) {
  return (
    <Show when={props.items.length > 0}>
      <box>
        <box flexDirection="row" gap={1} onMouseDown={() => props.items.length > 2 && props.onToggle()}>
          <Show when={props.items.length > 2}>
            <text fg={props.theme.text}>{props.expanded ? "▼" : "▶"}</text>
          </Show>
          <text fg={props.theme.text}>
            <b>Modified Files</b>
          </text>
        </box>
        <Show when={props.items.length <= 2 || props.expanded}>
          <For each={props.items || []}>
            {(item) => (
              <box flexDirection="row" gap={1} justifyContent="space-between">
                <text fg={props.theme.textMuted} wrapMode="none">
                  {item.file}
                </text>
                <box flexDirection="row" gap={1} flexShrink={0}>
                  <Show when={item.additions}>
                    <text fg={props.theme.diffAdded}>+{item.additions}</text>
                  </Show>
                  <Show when={item.deletions}>
                    <text fg={props.theme.diffRemoved}>-{item.deletions}</text>
                  </Show>
                </box>
              </box>
            )}
          </For>
        </Show>
      </box>
    </Show>
  )
}

function GettingStartedPanel(props: { onDismiss: () => void; theme: Theme }) {
  return (
    <box
      backgroundColor={props.theme.backgroundElement}
      paddingTop={1}
      paddingBottom={1}
      paddingLeft={2}
      paddingRight={2}
      flexDirection="row"
      gap={1}
    >
      <text flexShrink={0} fg={props.theme.text}>
        ⬖
      </text>
      <box flexGrow={1} gap={1}>
        <box flexDirection="row" justifyContent="space-between">
          <text fg={props.theme.text}>
            <b>Getting started</b>
          </text>
          <text fg={props.theme.textMuted} onMouseDown={props.onDismiss}>
            ✕
          </text>
        </box>
        <text fg={props.theme.textMuted}>Connect a provider to get started.</text>
        <text fg={props.theme.textMuted}>Choose from 75+ providers, including Claude, GPT, Gemini etc</text>
        <box flexDirection="row" gap={1} justifyContent="space-between">
          <text fg={props.theme.text}>Connect provider</text>
          <text fg={props.theme.textMuted}>/connect</text>
        </box>
      </box>
    </box>
  )
}

export function Sidebar(props: { sessionID: string; overlay?: boolean }) {
  const sync = useSync()
  const { theme } = useTheme()
  const session = createMemo(() => sync.session.get(props.sessionID)!)
  const diff = createMemo(() => sync.data.session_diff[props.sessionID] ?? [])
  const todo = createMemo(() => sync.data.todo[props.sessionID] ?? [])
  const messages = createMemo(() => sync.data.message[props.sessionID] ?? [])

  const [expanded, setExpanded] = createStore({
    mcp: true,
    diff: true,
    todo: true,
    lsp: true,
  })

  // Sort MCP servers alphabetically for consistent display order
  const mcpEntries = createMemo(() => Object.entries(sync.data.mcp).sort(([a], [b]) => a.localeCompare(b)))

  // Count connected and error MCP servers for collapsed header display
  const connectedMcpCount = createMemo(() => mcpEntries().filter(([_, item]) => item.status === "connected").length)
  const errorMcpCount = createMemo(
    () =>
      mcpEntries().filter(
        ([_, item]) =>
          item.status === "failed" || item.status === "needs_auth" || item.status === "needs_client_registration",
      ).length,
  )

  const cost = createMemo(() => {
    const total = messages().reduce((sum, x) => sum + (x.role === "assistant" ? x.cost : 0), 0)
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    }).format(total)
  })

  const context = createMemo(() => {
    const last = messages().findLast((x) => x.role === "assistant" && x.tokens.output > 0) as AssistantMessage
    if (!last) return
    const total =
      last.tokens.input + last.tokens.output + last.tokens.reasoning + last.tokens.cache.read + last.tokens.cache.write
    const model = sync.data.provider.find((x) => x.id === last.providerID)?.models[last.modelID]
    return {
      tokens: total.toLocaleString(),
      percentage: model?.limit.context ? Math.round((total / model.limit.context) * 100) : null,
    }
  })

  const directory = useDirectory()
  const kv = useKV()

  const hasProviders = createMemo(() => sync.data.provider.length > 0)
  const gettingStartedDismissed = createMemo(() => kv.get("dismissed_getting_started", false))

  return (
    <Show when={session()}>
      <box
        backgroundColor={theme.backgroundPanel}
        width={42}
        height="100%"
        paddingTop={1}
        paddingBottom={1}
        paddingLeft={2}
        paddingRight={2}
        position={props.overlay ? "absolute" : "relative"}
      >
        <scrollbox
          flexGrow={1}
          verticalScrollbarOptions={{
            trackOptions: {
              backgroundColor: theme.background,
              foregroundColor: theme.borderActive,
            },
          }}
        >
          <box flexShrink={0} gap={1} paddingRight={1}>
            <box paddingRight={1}>
              <text fg={theme.text}>
                <b>{session().title}</b>
              </text>
              <Show when={session().share?.url}>
                <text fg={theme.textMuted}>{session().share?.url}</text>
              </Show>
            </box>
            <box>
              <text fg={theme.text}>
                <b>Context</b>
              </text>
              <text fg={theme.textMuted}>{context()?.tokens ?? 0} tokens</text>
              <text fg={theme.textMuted}>{context()?.percentage ?? 0}% used</text>
              <text fg={theme.textMuted}>{cost()} spent</text>
            </box>
            <McpSection
              entries={mcpEntries()}
              connectedCount={connectedMcpCount()}
              errorCount={errorMcpCount()}
              expanded={expanded.mcp}
              onToggle={() => setExpanded("mcp", !expanded.mcp)}
              theme={theme}
            />
            <LspSection
              lspItems={sync.data.lsp}
              lspDisabled={sync.data.config.lsp === false}
              expanded={expanded.lsp}
              onToggle={() => setExpanded("lsp", !expanded.lsp)}
              theme={theme}
            />
            <TodoSection
              items={todo()}
              expanded={expanded.todo}
              onToggle={() => setExpanded("todo", !expanded.todo)}
              theme={theme}
            />
            <DiffSection
              items={diff()}
              expanded={expanded.diff}
              onToggle={() => setExpanded("diff", !expanded.diff)}
              theme={theme}
            />
          </box>
        </scrollbox>

        <box flexShrink={0} gap={1} paddingTop={1}>
          <Show when={!hasProviders() && !gettingStartedDismissed()}>
            <GettingStartedPanel onDismiss={() => kv.set("dismissed_getting_started", true)} theme={theme} />
          </Show>
          <text>
            <span style={{ fg: theme.textMuted }}>{directory().split("/").slice(0, -1).join("/")}/</span>
            <span style={{ fg: theme.text }}>{directory().split("/").at(-1)}</span>
          </text>
          <text fg={theme.textMuted}>
            <span style={{ fg: theme.success }}>•</span> <b>Open</b>
            <span style={{ fg: theme.text }}>
              <b>Code</b>
            </span>{" "}
            <span>{Installation.VERSION}</span>
          </text>
        </box>
      </box>
    </Show>
  )
}
