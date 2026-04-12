import path from "node:path"
import type { PermissionRequest } from "@librecode/sdk/v2"
import type { TextareaRenderable } from "@opentui/core"
import { type JSX, Portal, useKeyboard, useRenderer, useTerminalDimensions } from "@opentui/solid"
import { createMemo, For, Match, Show, Switch } from "solid-js"
import { createStore } from "solid-js/store"
import { Global } from "@/global"
import { LANGUAGE_EXTENSIONS } from "@/lsp/language"
import { Keybind } from "@/util/keybind"
import { Locale } from "@/util/locale"
import { SplitBorder } from "../../component/border"
import { useTextareaKeybindings } from "../../component/textarea-keybindings"
import { useKeybind } from "../../context/keybind"
import { useSDK } from "../../context/sdk"
import { useSync } from "../../context/sync"
import { selectedForeground, useTheme } from "../../context/theme"
import { useTuiConfig } from "../../context/tui-config"
import { useDialog } from "../../ui/dialog"

type PermissionStage = "permission" | "always" | "reject"

function normalizePath(input?: string) {
  if (!input) return ""

  const cwd = process.cwd()
  const home = Global.Path.home
  const absolute = path.isAbsolute(input) ? input : path.resolve(cwd, input)
  const relative = path.relative(cwd, absolute)

  if (!relative) return "."
  if (!relative.startsWith("..")) return relative

  // outside cwd - use ~ or absolute
  if (home && (absolute === home || absolute.startsWith(home + path.sep))) {
    return absolute.replace(home, "~")
  }
  return absolute
}

function filetype(input?: string) {
  if (!input) return "none"
  const ext = path.extname(input)
  const language = LANGUAGE_EXTENSIONS[ext]
  if (["typescriptreact", "javascriptreact", "javascript"].includes(language)) return "typescript"
  return language
}

function EditBody(props: { request: PermissionRequest }) {
  const themeState = useTheme()
  const theme = themeState.theme
  const syntax = themeState.syntax
  const config = useTuiConfig()
  const dimensions = useTerminalDimensions()

  const filepath = createMemo(() => (props.request.metadata?.filepath as string) ?? "")
  const diff = createMemo(() => (props.request.metadata?.diff as string) ?? "")

  const view = createMemo(() => {
    const diffStyle = config.diff_style
    if (diffStyle === "stacked") return "unified"
    return dimensions().width > 120 ? "split" : "unified"
  })

  const ft = createMemo(() => filetype(filepath()))

  return (
    <box flexDirection="column" gap={1}>
      <Show when={diff()}>
        <scrollbox
          height="100%"
          verticalScrollbarOptions={{
            trackOptions: {
              backgroundColor: theme.background,
              foregroundColor: theme.borderActive,
            },
          }}
        >
          <diff
            diff={diff()}
            view={view()}
            filetype={ft()}
            syntaxStyle={syntax()}
            showLineNumbers={true}
            width="100%"
            wrapMode="word"
            fg={theme.text}
            addedBg={theme.diffAddedBg}
            removedBg={theme.diffRemovedBg}
            contextBg={theme.diffContextBg}
            addedSignColor={theme.diffHighlightAdded}
            removedSignColor={theme.diffHighlightRemoved}
            lineNumberFg={theme.diffLineNumber}
            lineNumberBg={theme.diffContextBg}
            addedLineNumberBg={theme.diffAddedLineNumberBg}
            removedLineNumberBg={theme.diffRemovedLineNumberBg}
          />
        </scrollbox>
      </Show>
      <Show when={!diff()}>
        <box paddingLeft={1}>
          <text fg={theme.textMuted}>No diff provided</text>
        </box>
      </Show>
    </box>
  )
}

function TextBody(props: { title: string; description?: string; icon?: string }) {
  const { theme } = useTheme()
  return (
    <>
      <box flexDirection="row" gap={1} paddingLeft={1}>
        <Show when={props.icon}>
          <text fg={theme.textMuted} flexShrink={0}>
            {props.icon}
          </text>
        </Show>
        <text fg={theme.textMuted}>{props.title}</text>
      </box>
      <Show when={props.description}>
        <box paddingLeft={1}>
          <text fg={theme.text}>{props.description}</text>
        </box>
      </Show>
    </>
  )
}

// ---------------------------------------------------------------------------
// Permission info helpers — one function per permission type
// ---------------------------------------------------------------------------

type PermissionInfo = { icon: string; title: string; body: JSX.Element }

type PermissionContext = {
  request: PermissionRequest
  // biome-ignore lint/suspicious/noExplicitAny: permission data shape varies by tool type
  data: Record<string, any>
  theme: ReturnType<typeof useTheme>["theme"]
}

function editPermissionInfo(ctx: PermissionContext): PermissionInfo {
  const raw = ctx.request.metadata?.filepath
  const filepath = typeof raw === "string" ? raw : ""
  return {
    icon: "→",
    title: `Edit ${normalizePath(filepath)}`,
    body: <EditBody request={ctx.request} />,
  }
}

function readPermissionInfo(ctx: PermissionContext): PermissionInfo {
  const raw = ctx.data.filePath
  const filePath = typeof raw === "string" ? raw : ""
  return {
    icon: "→",
    title: `Read ${normalizePath(filePath)}`,
    body: (
      <Show when={filePath}>
        <box paddingLeft={1}>
          <text fg={ctx.theme.textMuted}>{`Path: ${normalizePath(filePath)}`}</text>
        </box>
      </Show>
    ),
  }
}

function patternPermissionInfo(
  _permission: string,
  icon: string,
  label: string,
  ctx: PermissionContext,
): PermissionInfo {
  const pattern = typeof ctx.data.pattern === "string" ? ctx.data.pattern : ""
  return {
    icon,
    title: `${label} "${pattern}"`,
    body: (
      <Show when={pattern}>
        <box paddingLeft={1}>
          <text fg={ctx.theme.textMuted}>{`Pattern: ${pattern}`}</text>
        </box>
      </Show>
    ),
  }
}

function listPermissionInfo(ctx: PermissionContext): PermissionInfo {
  const raw = ctx.data.path
  const dir = typeof raw === "string" ? raw : ""
  return {
    icon: "→",
    title: `List ${normalizePath(dir)}`,
    body: (
      <Show when={dir}>
        <box paddingLeft={1}>
          <text fg={ctx.theme.textMuted}>{`Path: ${normalizePath(dir)}`}</text>
        </box>
      </Show>
    ),
  }
}

function bashPermissionInfo(ctx: PermissionContext): PermissionInfo {
  const title =
    typeof ctx.data.description === "string" && ctx.data.description ? ctx.data.description : "Shell command"
  const command = typeof ctx.data.command === "string" ? ctx.data.command : ""
  return {
    icon: "#",
    title,
    body: (
      <Show when={command}>
        <box paddingLeft={1}>
          <text fg={ctx.theme.text}>{`$ ${command}`}</text>
        </box>
      </Show>
    ),
  }
}

function taskPermissionInfo(ctx: PermissionContext): PermissionInfo {
  const type = typeof ctx.data.subagent_type === "string" ? ctx.data.subagent_type : "Unknown"
  const desc = typeof ctx.data.description === "string" ? ctx.data.description : ""
  return {
    icon: "#",
    title: `${Locale.titlecase(type)} Task`,
    body: (
      <Show when={desc}>
        <box paddingLeft={1}>
          <text fg={ctx.theme.text}>{`◉ ${desc}`}</text>
        </box>
      </Show>
    ),
  }
}

function webfetchPermissionInfo(ctx: PermissionContext): PermissionInfo {
  const url = typeof ctx.data.url === "string" ? ctx.data.url : ""
  return {
    icon: "%",
    title: `WebFetch ${url}`,
    body: (
      <Show when={url}>
        <box paddingLeft={1}>
          <text fg={ctx.theme.textMuted}>{`URL: ${url}`}</text>
        </box>
      </Show>
    ),
  }
}

function queryPermissionInfo(_permission: string, icon: string, label: string, ctx: PermissionContext): PermissionInfo {
  const query = typeof ctx.data.query === "string" ? ctx.data.query : ""
  return {
    icon,
    title: `${label} "${query}"`,
    body: (
      <Show when={query}>
        <box paddingLeft={1}>
          <text fg={ctx.theme.textMuted}>{`Query: ${query}`}</text>
        </box>
      </Show>
    ),
  }
}

function externalDirPermissionInfo(ctx: PermissionContext): PermissionInfo {
  const meta = ctx.request.metadata ?? {}
  const parent = typeof meta.parentDir === "string" ? meta.parentDir : undefined
  const filepath = typeof meta.filepath === "string" ? meta.filepath : undefined
  const pattern = ctx.request.patterns?.[0]
  const derived = typeof pattern === "string" ? (pattern.includes("*") ? path.dirname(pattern) : pattern) : undefined
  const raw = parent ?? filepath ?? derived
  const dir = normalizePath(raw)
  const patterns = (ctx.request.patterns ?? []).filter((p): p is string => typeof p === "string")
  return {
    icon: "←",
    title: `Access external directory ${dir}`,
    body: (
      <Show when={patterns.length > 0}>
        <box paddingLeft={1} gap={1}>
          <text fg={ctx.theme.textMuted}>Patterns</text>
          <box>
            <For each={patterns}>{(p) => <text fg={ctx.theme.text}>{`- ${p}`}</text>}</For>
          </box>
        </box>
      </Show>
    ),
  }
}

function doomLoopPermissionInfo(ctx: PermissionContext): PermissionInfo {
  return {
    icon: "⟳",
    title: "Continue after repeated failures",
    body: (
      <box paddingLeft={1}>
        <text fg={ctx.theme.textMuted}>This keeps the session running despite repeated failures.</text>
      </box>
    ),
  }
}

function buildPermissionInfo(ctx: PermissionContext): PermissionInfo {
  const { permission } = ctx.request
  if (permission === "edit") return editPermissionInfo(ctx)
  if (permission === "read") return readPermissionInfo(ctx)
  if (permission === "glob") return patternPermissionInfo(permission, "✱", "Glob", ctx)
  if (permission === "grep") return patternPermissionInfo(permission, "✱", "Grep", ctx)
  if (permission === "list") return listPermissionInfo(ctx)
  if (permission === "bash") return bashPermissionInfo(ctx)
  if (permission === "task") return taskPermissionInfo(ctx)
  if (permission === "webfetch") return webfetchPermissionInfo(ctx)
  if (permission === "websearch") return queryPermissionInfo(permission, "◈", "Exa Web Search", ctx)
  if (permission === "codesearch") return queryPermissionInfo(permission, "◇", "Exa Code Search", ctx)
  if (permission === "external_directory") return externalDirPermissionInfo(ctx)
  if (permission === "doom_loop") return doomLoopPermissionInfo(ctx)
  return {
    icon: "⚙",
    title: `Call tool ${permission}`,
    body: (
      <box paddingLeft={1}>
        <text fg={ctx.theme.textMuted}>{`Tool: ${permission}`}</text>
      </box>
    ),
  }
}

// ---------------------------------------------------------------------------
// PermissionStagePrompt — renders the main permission decision UI
// ---------------------------------------------------------------------------

type PermissionStagePromptProps = {
  request: PermissionRequest
  // biome-ignore lint/suspicious/noExplicitAny: permission input shape varies by tool type
  input: Record<string, any>
  session: { parentID?: string } | undefined
  onAlways: () => void
  onReject: () => void
  onOnce: () => void
}

function PermissionStagePrompt(props: PermissionStagePromptProps) {
  const { theme } = useTheme()
  const info = buildPermissionInfo({ request: props.request, data: props.input, theme })

  const header = (
    <box flexDirection="column" gap={0}>
      <box flexDirection="row" gap={1} flexShrink={0}>
        <text fg={theme.warning}>{"△"}</text>
        <text fg={theme.text}>Permission required</text>
      </box>
      <box flexDirection="row" gap={1} paddingLeft={2} flexShrink={0}>
        <text fg={theme.textMuted} flexShrink={0}>
          {info.icon}
        </text>
        <text fg={theme.text}>{info.title}</text>
      </box>
    </box>
  )

  return (
    <Prompt
      title="Permission required"
      header={header}
      body={info.body}
      options={{ once: "Allow once", always: "Allow always", reject: "Reject" }}
      escapeKey="reject"
      fullscreen
      onSelect={(option) => {
        if (option === "always") {
          props.onAlways()
          return
        }
        if (option === "reject") {
          props.onReject()
          return
        }
        props.onOnce()
      }}
    />
  )
}

export function PermissionPrompt(props: { request: PermissionRequest }) {
  const sdk = useSDK()
  const sync = useSync()
  const [store, setStore] = createStore({
    stage: "permission" as PermissionStage,
  })

  const session = createMemo(() => sync.data.session.find((s) => s.id === props.request.sessionID))

  const input = createMemo(() => {
    const tool = props.request.tool
    if (!tool) return {}
    const parts = sync.data.part[tool.messageID] ?? []
    for (const part of parts) {
      if (part.type === "tool" && part.callID === tool.callID && part.state.status !== "pending") {
        return part.state.input ?? {}
      }
    }
    return {}
  })

  const { theme } = useTheme()

  return (
    <Switch>
      <Match when={store.stage === "always"}>
        <Prompt
          title="Always allow"
          body={
            <Switch>
              <Match when={props.request.always.length === 1 && props.request.always[0] === "*"}>
                <TextBody title={`This will allow ${props.request.permission} until LibreCode is restarted.`} />
              </Match>
              <Match when={true}>
                <box paddingLeft={1} gap={1}>
                  <text fg={theme.textMuted}>This will allow the following patterns until LibreCode is restarted</text>
                  <box>
                    <For each={props.request.always}>
                      {(pattern) => (
                        <text fg={theme.text}>
                          {"- "}
                          {pattern}
                        </text>
                      )}
                    </For>
                  </box>
                </box>
              </Match>
            </Switch>
          }
          options={{ confirm: "Confirm", cancel: "Cancel" }}
          escapeKey="cancel"
          onSelect={(option) => {
            setStore("stage", "permission")
            if (option === "cancel") return
            sdk.client.permission.reply({
              reply: "always",
              requestID: props.request.id,
            })
          }}
        />
      </Match>
      <Match when={store.stage === "reject"}>
        <RejectPrompt
          onConfirm={(message) => {
            sdk.client.permission.reply({
              reply: "reject",
              requestID: props.request.id,
              message: message || undefined,
            })
          }}
          onCancel={() => {
            setStore("stage", "permission")
          }}
        />
      </Match>
      <Match when={store.stage === "permission"}>
        <PermissionStagePrompt
          request={props.request}
          input={input()}
          session={session()}
          onAlways={() => setStore("stage", "always")}
          onReject={() => {
            if (session()?.parentID) {
              setStore("stage", "reject")
              return
            }
            sdk.client.permission.reply({ reply: "reject", requestID: props.request.id })
          }}
          onOnce={() => sdk.client.permission.reply({ reply: "once", requestID: props.request.id })}
        />
      </Match>
    </Switch>
  )
}

function RejectPrompt(props: { onConfirm: (message: string) => void; onCancel: () => void }) {
  let input: TextareaRenderable
  const { theme } = useTheme()
  const keybind = useKeybind()
  const textareaKeybindings = useTextareaKeybindings()
  const dimensions = useTerminalDimensions()
  const narrow = createMemo(() => dimensions().width < 80)
  const dialog = useDialog()

  useKeyboard((evt) => {
    if (dialog.stack.length > 0) return

    if (evt.name === "escape" || keybind.match("app_exit", evt)) {
      evt.preventDefault()
      props.onCancel()
      return
    }
    if (evt.name === "return") {
      evt.preventDefault()
      props.onConfirm(input.plainText)
    }
  })

  return (
    <box
      backgroundColor={theme.backgroundPanel}
      border={["left"]}
      borderColor={theme.error}
      customBorderChars={SplitBorder.customBorderChars}
    >
      <box gap={1} paddingLeft={1} paddingRight={3} paddingTop={1} paddingBottom={1}>
        <box flexDirection="row" gap={1} paddingLeft={1}>
          <text fg={theme.error}>{"△"}</text>
          <text fg={theme.text}>Reject permission</text>
        </box>
        <box paddingLeft={1}>
          <text fg={theme.textMuted}>Tell LibreCode what to do differently</text>
        </box>
      </box>
      <box
        flexDirection={narrow() ? "column" : "row"}
        flexShrink={0}
        paddingTop={1}
        paddingLeft={2}
        paddingRight={3}
        paddingBottom={1}
        backgroundColor={theme.backgroundElement}
        justifyContent={narrow() ? "flex-start" : "space-between"}
        alignItems={narrow() ? "flex-start" : "center"}
        gap={1}
      >
        <textarea
          ref={(val: TextareaRenderable) => (input = val)}
          focused
          textColor={theme.text}
          focusedTextColor={theme.text}
          cursorColor={theme.primary}
          keyBindings={textareaKeybindings()}
        />
        <box flexDirection="row" gap={2} flexShrink={0}>
          <text fg={theme.text}>
            enter <span style={{ fg: theme.textMuted }}>confirm</span>
          </text>
          <text fg={theme.text}>
            esc <span style={{ fg: theme.textMuted }}>cancel</span>
          </text>
        </box>
      </box>
    </box>
  )
}

function Prompt<const T extends Record<string, string>>(props: {
  title: string
  header?: JSX.Element
  body: JSX.Element
  options: T
  escapeKey?: keyof T
  fullscreen?: boolean
  onSelect: (option: keyof T) => void
}) {
  const { theme } = useTheme()
  const keybind = useKeybind()
  const dimensions = useTerminalDimensions()
  const keys = Object.keys(props.options) as (keyof T)[]
  const [store, setStore] = createStore({
    selected: keys[0],
    expanded: false,
  })
  const diffKey = Keybind.parse("ctrl+f")[0]
  const narrow = createMemo(() => dimensions().width < 80)
  const dialog = useDialog()

  function movePrev() {
    const idx = keys.indexOf(store.selected)
    setStore("selected", keys[(idx - 1 + keys.length) % keys.length])
  }

  function moveNext() {
    const idx = keys.indexOf(store.selected)
    setStore("selected", keys[(idx + 1) % keys.length])
  }

  function isEscapeKey(evt: Parameters<Parameters<typeof useKeyboard>[0]>[0]) {
    return evt.name === "escape" || keybind.match("app_exit", evt)
  }

  function isDiffToggle(evt: Parameters<Parameters<typeof useKeyboard>[0]>[0]) {
    return props.fullscreen && diffKey && Keybind.match(diffKey, keybind.parse(evt))
  }

  function handlePromptNav(evt: Parameters<Parameters<typeof useKeyboard>[0]>[0]): boolean {
    if (evt.name === "left" || evt.name === "h") {
      evt.preventDefault()
      movePrev()
      return true
    }
    if (evt.name === "right" || evt.name === "l") {
      evt.preventDefault()
      moveNext()
      return true
    }
    return false
  }

  function handlePromptKey(evt: Parameters<Parameters<typeof useKeyboard>[0]>[0]) {
    if (handlePromptNav(evt)) return
    if (evt.name === "return") {
      evt.preventDefault()
      props.onSelect(store.selected)
      return
    }
    if (props.escapeKey && isEscapeKey(evt)) {
      evt.preventDefault()
      props.onSelect(props.escapeKey)
      return
    }
    if (isDiffToggle(evt)) {
      evt.preventDefault()
      evt.stopPropagation()
      setStore("expanded", (v) => !v)
    }
  }

  useKeyboard((evt) => {
    if (dialog.stack.length > 0) return
    handlePromptKey(evt)
  })

  const hint = createMemo(() => (store.expanded ? "minimize" : "fullscreen"))
  const _renderer = useRenderer()

  const content = () => (
    <box
      backgroundColor={theme.backgroundPanel}
      border={["left"]}
      borderColor={theme.warning}
      customBorderChars={SplitBorder.customBorderChars}
      {...(store.expanded
        ? { top: dimensions().height * -1 + 1, bottom: 1, left: 2, right: 2, position: "absolute" }
        : {
            top: 0,
            maxHeight: 15,
            bottom: 0,
            left: 0,
            right: 0,
            position: "relative",
          })}
    >
      <box gap={1} paddingLeft={1} paddingRight={3} paddingTop={1} paddingBottom={1} flexGrow={1}>
        <Show
          when={props.header}
          fallback={
            <box flexDirection="row" gap={1} paddingLeft={1} flexShrink={0}>
              <text fg={theme.warning}>{"△"}</text>
              <text fg={theme.text}>{props.title}</text>
            </box>
          }
        >
          <box paddingLeft={1} flexShrink={0}>
            {props.header}
          </box>
        </Show>
        {props.body}
      </box>
      <box
        flexDirection={narrow() ? "column" : "row"}
        flexShrink={0}
        gap={1}
        paddingTop={1}
        paddingLeft={2}
        paddingRight={3}
        paddingBottom={1}
        backgroundColor={theme.backgroundElement}
        justifyContent={narrow() ? "flex-start" : "space-between"}
        alignItems={narrow() ? "flex-start" : "center"}
      >
        <box flexDirection="row" gap={1} flexShrink={0}>
          <For each={keys}>
            {(option) => (
              <box
                paddingLeft={1}
                paddingRight={1}
                backgroundColor={option === store.selected ? theme.warning : theme.backgroundMenu}
                onMouseOver={() => setStore("selected", option)}
                onMouseUp={() => {
                  setStore("selected", option)
                  props.onSelect(option)
                }}
              >
                <text fg={option === store.selected ? selectedForeground(theme, theme.warning) : theme.textMuted}>
                  {props.options[option]}
                </text>
              </box>
            )}
          </For>
        </box>
        <box flexDirection="row" gap={2} flexShrink={0}>
          <Show when={props.fullscreen}>
            <text fg={theme.text}>
              {"ctrl+f"} <span style={{ fg: theme.textMuted }}>{hint()}</span>
            </text>
          </Show>
          <text fg={theme.text}>
            {"⇆"} <span style={{ fg: theme.textMuted }}>select</span>
          </text>
          <text fg={theme.text}>
            enter <span style={{ fg: theme.textMuted }}>confirm</span>
          </text>
        </box>
      </box>
    </box>
  )

  return (
    <Show when={!store.expanded} fallback={<Portal>{content()}</Portal>}>
      {content()}
    </Show>
  )
}
