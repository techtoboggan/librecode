import { MouseButton, type Renderable, RGBA } from "@opentui/core"
import { useKeyboard, useRenderer, useTerminalDimensions } from "@opentui/solid"
import { useTheme } from "@tui/context/theme"
import { Selection } from "@tui/util/selection"
import { batch, createContext, type JSX, type ParentProps, Show, useContext } from "solid-js"
import { createStore } from "solid-js/store"
import { Flag } from "@/flag/flag"
import { useToast } from "./toast"

export function Dialog(
  props: ParentProps<{
    size?: "medium" | "large"
    onClose: () => void
  }>,
) {
  const dimensions = useTerminalDimensions()
  const { theme } = useTheme()
  const renderer = useRenderer()

  let dismiss = false

  return (
    <box
      onMouseDown={() => {
        dismiss = !!renderer.getSelection()
      }}
      onMouseUp={() => {
        if (dismiss) {
          dismiss = false
          return
        }
        props.onClose?.()
      }}
      width={dimensions().width}
      height={dimensions().height}
      alignItems="center"
      position="absolute"
      paddingTop={dimensions().height / 4}
      left={0}
      top={0}
      backgroundColor={RGBA.fromInts(0, 0, 0, 150)}
    >
      <box
        onMouseUp={(e) => {
          dismiss = false
          e.stopPropagation()
        }}
        width={props.size === "large" ? 80 : 60}
        maxWidth={dimensions().width - 2}
        backgroundColor={theme.backgroundPanel}
        paddingTop={1}
      >
        {props.children}
      </box>
    </box>
  )
}

function init() {
  const [store, setStore] = createStore({
    stack: [] as {
      element: JSX.Element
      onClose?: () => void
    }[],
    size: "medium" as "medium" | "large",
  })

  const renderer = useRenderer()

  let focus: Renderable | null

  function findRenderable(item: Renderable, target: Renderable): boolean {
    for (const child of item.getChildren()) {
      if (child === target) return true
      if (findRenderable(child, target)) return true
    }
    return false
  }

  function refocus() {
    setTimeout(() => {
      if (!focus || focus.isDestroyed) return
      if (!findRenderable(renderer.root, focus)) return
      focus.focus()
    }, 1)
  }

  function isCloseKey(evt: { name: string; ctrl: boolean }): boolean {
    return evt.name === "escape" || (evt.ctrl && evt.name === "c")
  }

  useKeyboard((evt) => {
    if (store.stack.length === 0) return
    if (evt.defaultPrevented) return
    if (!isCloseKey(evt)) return
    if (renderer.getSelection()) return
    const current = store.stack.at(-1)!
    current.onClose?.()
    setStore("stack", store.stack.slice(0, -1))
    evt.preventDefault()
    evt.stopPropagation()
    refocus()
  })

  return {
    clear() {
      for (const item of store.stack) {
        if (item.onClose) item.onClose()
      }
      batch(() => {
        setStore("size", "medium")
        setStore("stack", [])
      })
      refocus()
    },
    replace(input: any, onClose?: () => void) {
      if (store.stack.length === 0) {
        focus = renderer.currentFocusedRenderable
        focus?.blur()
      }
      for (const item of store.stack) {
        if (item.onClose) item.onClose()
      }
      setStore("size", "medium")
      setStore("stack", [
        {
          element: input,
          onClose,
        },
      ])
    },
    get stack() {
      return store.stack
    },
    get size() {
      return store.size
    },
    setSize(size: "medium" | "large") {
      setStore("size", size)
    },
  }
}

export type DialogContext = ReturnType<typeof init>

const ctx = createContext<DialogContext>()

export function DialogProvider(props: ParentProps) {
  const value = init()
  const renderer = useRenderer()
  const toast = useToast()
  return (
    <ctx.Provider value={value}>
      {props.children}
      <box
        position="absolute"
        onMouseDown={(evt) => {
          if (!Flag.LIBRECODE_EXPERIMENTAL_DISABLE_COPY_ON_SELECT) return
          if (evt.button !== MouseButton.RIGHT) return

          if (!Selection.copy(renderer, toast)) return
          evt.preventDefault()
          evt.stopPropagation()
        }}
        onMouseUp={
          !Flag.LIBRECODE_EXPERIMENTAL_DISABLE_COPY_ON_SELECT ? () => Selection.copy(renderer, toast) : undefined
        }
      >
        <Show when={value.stack.length}>
          <Dialog onClose={() => value.clear()} size={value.size}>
            {value.stack.at(-1)?.element}
          </Dialog>
        </Show>
      </box>
    </ctx.Provider>
  )
}

export function useDialog() {
  const value = useContext(ctx)
  if (!value) {
    throw new Error("useDialog must be used within a DialogProvider")
  }
  return value
}
