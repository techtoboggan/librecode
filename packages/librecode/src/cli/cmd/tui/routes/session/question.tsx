import type { QuestionAnswer, QuestionInfo, QuestionRequest } from "@librecode/sdk/v2"
import type { TextareaRenderable } from "@opentui/core"
import { useKeyboard } from "@opentui/solid"
import { createMemo, createSignal, For, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { SplitBorder } from "../../component/border"
import { useTextareaKeybindings } from "../../component/textarea-keybindings"
import { useKeybind } from "../../context/keybind"
import { useSDK } from "../../context/sdk"
import { selectedForeground, tint, useTheme } from "../../context/theme"
import { useDialog } from "../../ui/dialog"

export function QuestionPrompt(props: { request: QuestionRequest }) {
  const sdk = useSDK()
  const { theme } = useTheme()
  const keybind = useKeybind()
  const bindings = useTextareaKeybindings()

  const questions = createMemo(() => props.request.questions)
  const single = createMemo(() => questions().length === 1 && questions()[0]?.multiple !== true)
  const tabs = createMemo(() => (single() ? 1 : questions().length + 1)) // questions + confirm tab (no confirm for single select)
  const [tabHover, setTabHover] = createSignal<number | "confirm" | null>(null)
  const [store, setStore] = createStore({
    tab: 0,
    answers: [] as QuestionAnswer[],
    custom: [] as string[],
    selected: 0,
    editing: false,
  })

  let textarea: TextareaRenderable | undefined

  const question = createMemo(() => questions()[store.tab])
  const confirm = createMemo(() => !single() && store.tab === questions().length)
  const options = createMemo(() => question()?.options ?? [])
  const custom = createMemo(() => question()?.custom !== false)
  const other = createMemo(() => custom() && store.selected === options().length)
  const input = createMemo(() => store.custom[store.tab] ?? "")
  const multi = createMemo(() => question()?.multiple === true)
  const customPicked = createMemo(() => {
    const value = input()
    if (!value) return false
    return store.answers[store.tab]?.includes(value) ?? false
  })

  function submit() {
    const answers = questions().map((_, i) => store.answers[i] ?? [])
    sdk.client.question.reply({
      requestID: props.request.id,
      answers,
    })
  }

  function reject() {
    sdk.client.question.reject({
      requestID: props.request.id,
    })
  }

  function pick(answer: string, custom: boolean = false) {
    const answers = [...store.answers]
    answers[store.tab] = [answer]
    setStore("answers", answers)
    if (custom) {
      const inputs = [...store.custom]
      inputs[store.tab] = answer
      setStore("custom", inputs)
    }
    if (single()) {
      sdk.client.question.reply({
        requestID: props.request.id,
        answers: [[answer]],
      })
      return
    }
    setStore("tab", store.tab + 1)
    setStore("selected", 0)
  }

  function toggle(answer: string) {
    const existing = store.answers[store.tab] ?? []
    const next = [...existing]
    const index = next.indexOf(answer)
    if (index === -1) next.push(answer)
    if (index !== -1) next.splice(index, 1)
    const answers = [...store.answers]
    answers[store.tab] = next
    setStore("answers", answers)
  }

  function moveTo(index: number) {
    setStore("selected", index)
  }

  function selectTab(index: number) {
    setStore("tab", index)
    setStore("selected", 0)
  }

  function selectOtherOption() {
    if (!multi()) {
      setStore("editing", true)
      return
    }
    const value = input()
    if (value && customPicked()) {
      toggle(value)
      return
    }
    setStore("editing", true)
  }

  function selectRegularOption() {
    const opt = options()[store.selected]
    if (!opt) return
    if (multi()) {
      toggle(opt.label)
      return
    }
    pick(opt.label)
  }

  function selectOption() {
    if (other()) {
      selectOtherOption()
      return
    }
    selectRegularOption()
  }

  const dialog = useDialog()

  function commitMultiCustomEdit(text: string) {
    const prev = store.custom[store.tab]
    const inputs = [...store.custom]
    inputs[store.tab] = text
    setStore("custom", inputs)
    const existing = store.answers[store.tab] ?? []
    const next = [...existing]
    if (prev) {
      const idx = next.indexOf(prev)
      if (idx !== -1) next.splice(idx, 1)
    }
    if (!next.includes(text)) next.push(text)
    const answers = [...store.answers]
    answers[store.tab] = next
    setStore("answers", answers)
    setStore("editing", false)
  }

  function commitCustomEdit(text: string) {
    if (multi()) {
      commitMultiCustomEdit(text)
      return
    }
    pick(text, true)
    setStore("editing", false)
  }

  function clearCustomEdit() {
    const prev = store.custom[store.tab]
    if (prev) {
      const inputs = [...store.custom]
      inputs[store.tab] = ""
      setStore("custom", inputs)
      const answers = [...store.answers]
      answers[store.tab] = (answers[store.tab] ?? []).filter((x) => x !== prev)
      setStore("answers", answers)
    }
    setStore("editing", false)
  }

  function handleEditingClear(evt: Parameters<Parameters<typeof useKeyboard>[0]>[0]) {
    evt.preventDefault()
    const text = textarea?.plainText ?? ""
    if (!text) {
      setStore("editing", false)
      return
    }
    textarea?.setText("")
  }

  function handleEditingReturn(evt: Parameters<Parameters<typeof useKeyboard>[0]>[0]) {
    evt.preventDefault()
    const text = textarea?.plainText?.trim() ?? ""
    if (!text) {
      clearCustomEdit()
      return
    }
    commitCustomEdit(text)
  }

  function handleEditingKey(evt: Parameters<Parameters<typeof useKeyboard>[0]>[0]) {
    if (evt.name === "escape") {
      evt.preventDefault()
      setStore("editing", false)
      return
    }
    if (keybind.match("input_clear", evt)) {
      handleEditingClear(evt)
      return
    }
    if (evt.name === "return") {
      handleEditingReturn(evt)
      return
    }
    // Let textarea handle all other keys
  }

  function handleOptionNav(evt: Parameters<Parameters<typeof useKeyboard>[0]>[0], total: number): boolean {
    if (evt.name === "up" || evt.name === "k") {
      evt.preventDefault()
      moveTo((store.selected - 1 + total) % total)
      return true
    }
    if (evt.name === "down" || evt.name === "j") {
      evt.preventDefault()
      moveTo((store.selected + 1) % total)
      return true
    }
    return false
  }

  function handleOptionKey(evt: Parameters<Parameters<typeof useKeyboard>[0]>[0]) {
    const total = options().length + (custom() ? 1 : 0)
    const digit = Number(evt.name)
    const max = Math.min(total, 9)

    if (!Number.isNaN(digit) && digit >= 1 && digit <= max) {
      evt.preventDefault()
      moveTo(digit - 1)
      selectOption()
      return
    }
    if (handleOptionNav(evt, total)) return
    if (evt.name === "return") {
      evt.preventDefault()
      selectOption()
      return
    }
    if (evt.name === "escape" || keybind.match("app_exit", evt)) {
      evt.preventDefault()
      reject()
    }
  }

  function handleConfirmKey(evt: Parameters<Parameters<typeof useKeyboard>[0]>[0]) {
    if (evt.name === "return") {
      evt.preventDefault()
      submit()
      return
    }
    if (evt.name === "escape" || keybind.match("app_exit", evt)) {
      evt.preventDefault()
      reject()
    }
  }

  function handleTabNav(evt: Parameters<Parameters<typeof useKeyboard>[0]>[0]): boolean {
    if (evt.name === "left" || evt.name === "h") {
      evt.preventDefault()
      selectTab((store.tab - 1 + tabs()) % tabs())
      return true
    }
    if (evt.name === "right" || evt.name === "l") {
      evt.preventDefault()
      selectTab((store.tab + 1) % tabs())
      return true
    }
    if (evt.name === "tab") {
      evt.preventDefault()
      const direction = evt.shift ? -1 : 1
      selectTab((store.tab + direction + tabs()) % tabs())
      return true
    }
    return false
  }

  useKeyboard((evt) => {
    if (dialog.stack.length > 0) return
    if (store.editing && !confirm()) {
      handleEditingKey(evt)
      return
    }
    if (handleTabNav(evt)) return
    if (confirm()) {
      handleConfirmKey(evt)
    } else {
      handleOptionKey(evt)
    }
  })

  function optionLabelFg(active: () => boolean, picked: () => boolean) {
    if (active()) return theme.secondary
    if (picked()) return theme.success
    return theme.text
  }

  function renderOption(opt: { label: string; description?: string }, i: () => number) {
    const active = () => i() === store.selected
    const picked = () => store.answers[store.tab]?.includes(opt.label) ?? false
    const multiLabel = () => `[${picked() ? "✓" : " "}] ${opt.label}`
    const label = () => (multi() ? multiLabel() : opt.label)
    return (
      <box onMouseOver={() => moveTo(i())} onMouseDown={() => moveTo(i())} onMouseUp={() => selectOption()}>
        <box flexDirection="row">
          <box backgroundColor={active() ? theme.backgroundElement : undefined} paddingRight={1}>
            <text fg={active() ? tint(theme.textMuted, theme.secondary, 0.6) : theme.textMuted}>{`${i() + 1}.`}</text>
          </box>
          <box backgroundColor={active() ? theme.backgroundElement : undefined}>
            <text fg={optionLabelFg(active, picked)}>{label()}</text>
          </box>
          <Show when={!multi()}>
            <text fg={theme.success}>{picked() ? "✓" : ""}</text>
          </Show>
        </box>
        <box paddingLeft={3}>
          <text fg={theme.textMuted}>{opt.description}</text>
        </box>
      </box>
    )
  }

  function tabBg(index: () => number) {
    if (index() === store.tab) return theme.accent
    if (tabHover() === index()) return theme.backgroundElement
    return theme.backgroundPanel
  }

  function tabFg(index: () => number) {
    const isActive = index() === store.tab
    const isAnswered = (store.answers[index()]?.length ?? 0) > 0
    if (isActive) return selectedForeground(theme, theme.accent)
    if (isAnswered) return theme.text
    return theme.textMuted
  }

  function renderTab(q: QuestionInfo, index: () => number) {
    return (
      <box
        paddingLeft={1}
        paddingRight={1}
        backgroundColor={tabBg(index)}
        onMouseOver={() => setTabHover(index())}
        onMouseOut={() => setTabHover(null)}
        onMouseUp={() => selectTab(index())}
      >
        <text fg={tabFg(index)}>{q.header}</text>
      </box>
    )
  }

  function customOptionFg() {
    if (other()) return theme.secondary
    if (customPicked()) return theme.success
    return theme.text
  }

  function renderCustomOption() {
    const customLabel = () =>
      multi() ? `[${customPicked() ? "✓" : " "}] Type your own answer` : "Type your own answer"
    return (
      <box
        onMouseOver={() => moveTo(options().length)}
        onMouseDown={() => moveTo(options().length)}
        onMouseUp={() => selectOption()}
      >
        <box flexDirection="row">
          <box backgroundColor={other() ? theme.backgroundElement : undefined} paddingRight={1}>
            <text fg={other() ? tint(theme.textMuted, theme.secondary, 0.6) : theme.textMuted}>
              {`${options().length + 1}.`}
            </text>
          </box>
          <box backgroundColor={other() ? theme.backgroundElement : undefined}>
            <text fg={customOptionFg()}>{customLabel()}</text>
          </box>
          <Show when={!multi()}>
            <text fg={theme.success}>{customPicked() ? "✓" : ""}</text>
          </Show>
        </box>
        <Show when={store.editing}>
          <box paddingLeft={3}>
            <textarea
              ref={(val: TextareaRenderable) => {
                textarea = val
                queueMicrotask(() => {
                  val.focus()
                  val.gotoLineEnd()
                })
              }}
              initialValue={input()}
              placeholder="Type your own answer"
              minHeight={1}
              maxHeight={6}
              textColor={theme.text}
              focusedTextColor={theme.text}
              cursorColor={theme.primary}
              keyBindings={bindings()}
            />
          </box>
        </Show>
        <Show when={!store.editing && input()}>
          <box paddingLeft={3}>
            <text fg={theme.textMuted}>{input()}</text>
          </box>
        </Show>
      </box>
    )
  }

  return (
    <box
      backgroundColor={theme.backgroundPanel}
      border={["left"]}
      borderColor={theme.accent}
      customBorderChars={SplitBorder.customBorderChars}
    >
      <box gap={1} paddingLeft={1} paddingRight={3} paddingTop={1} paddingBottom={1}>
        <Show when={!single()}>
          <box flexDirection="row" gap={1} paddingLeft={1}>
            <For each={questions()}>{renderTab}</For>
            <box
              paddingLeft={1}
              paddingRight={1}
              backgroundColor={
                confirm() ? theme.accent : tabHover() === "confirm" ? theme.backgroundElement : theme.backgroundPanel
              }
              onMouseOver={() => setTabHover("confirm")}
              onMouseOut={() => setTabHover(null)}
              onMouseUp={() => selectTab(questions().length)}
            >
              <text fg={confirm() ? selectedForeground(theme, theme.accent) : theme.textMuted}>Confirm</text>
            </box>
          </box>
        </Show>

        <Show when={!confirm()}>
          <box paddingLeft={1} gap={1}>
            <box>
              <text fg={theme.text}>
                {question()?.question}
                {multi() ? " (select all that apply)" : ""}
              </text>
            </box>
            <box>
              <For each={options()}>{renderOption}</For>
              <Show when={custom()}>{renderCustomOption()}</Show>
            </box>
          </box>
        </Show>

        <Show when={confirm() && !single()}>
          <box paddingLeft={1}>
            <text fg={theme.text}>Review</text>
          </box>
          <For each={questions()}>
            {(q, index) => {
              const value = () => store.answers[index()]?.join(", ") ?? ""
              const answered = () => Boolean(value())
              return (
                <box paddingLeft={1}>
                  <text>
                    <span style={{ fg: theme.textMuted }}>{q.header}:</span>{" "}
                    <span style={{ fg: answered() ? theme.text : theme.error }}>
                      {answered() ? value() : "(not answered)"}
                    </span>
                  </text>
                </box>
              )
            }}
          </For>
        </Show>
      </box>
      <box
        flexDirection="row"
        flexShrink={0}
        gap={1}
        paddingLeft={2}
        paddingRight={3}
        paddingBottom={1}
        justifyContent="space-between"
      >
        <box flexDirection="row" gap={2}>
          <Show when={!single()}>
            <text fg={theme.text}>
              {"⇆"} <span style={{ fg: theme.textMuted }}>tab</span>
            </text>
          </Show>
          <Show when={!confirm()}>
            <text fg={theme.text}>
              {"↑↓"} <span style={{ fg: theme.textMuted }}>select</span>
            </text>
          </Show>
          <text fg={theme.text}>
            enter{" "}
            <span style={{ fg: theme.textMuted }}>
              {confirm() ? "submit" : multi() ? "toggle" : single() ? "submit" : "confirm"}
            </span>
          </text>

          <text fg={theme.text}>
            esc <span style={{ fg: theme.textMuted }}>dismiss</span>
          </text>
        </box>
      </box>
    </box>
  )
}
