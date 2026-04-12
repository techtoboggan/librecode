import type { ParsedKey, Renderable } from "@opentui/core"
import { useKeyboard, useRenderer } from "@opentui/solid"
import { mapValues, pipe } from "remeda"
import { createMemo } from "solid-js"
import { createStore } from "solid-js/store"
import type { TuiConfig } from "@/config/tui"
import { Keybind } from "@/util/keybind"
import { createSimpleContext } from "./helper"
import { useTuiConfig } from "./tui-config"

export type KeybindKey = keyof NonNullable<TuiConfig.Info["keybinds"]> & string

export const { use: useKeybind, provider: KeybindProvider } = createSimpleContext({
  name: "Keybind",
  init: () => {
    const config = useTuiConfig()
    const keybinds = createMemo<Record<string, Keybind.Info[]>>(() => {
      return pipe(
        (config.keybinds ?? {}) as Record<string, string>,
        mapValues((value) => Keybind.parse(value)),
      )
    })
    const [store, setStore] = createStore({
      leader: false,
    })
    const renderer = useRenderer()

    let focus: Renderable | null
    let timeout: NodeJS.Timeout
    function leader(active: boolean) {
      if (active) {
        setStore("leader", true)
        focus = renderer.currentFocusedRenderable
        focus?.blur()
        if (timeout) clearTimeout(timeout)
        timeout = setTimeout(() => {
          if (!store.leader) return
          leader(false)
          if (!focus || focus.isDestroyed) return
          focus.focus()
        }, 2000)
        return
      }

      if (!active) {
        if (focus && !renderer.currentFocusedRenderable) {
          focus.focus()
        }
        setStore("leader", false)
      }
    }

    useKeyboard(async (evt) => {
      if (!store.leader && result.match("leader", evt)) {
        leader(true)
        return
      }

      if (store.leader && evt.name) {
        setImmediate(() => {
          if (focus && renderer.currentFocusedRenderable === focus) {
            focus.focus()
          }
          leader(false)
        })
      }
    })

    const result = {
      get all() {
        return keybinds()
      },
      get leader() {
        return store.leader
      },
      parse(evt: ParsedKey): Keybind.Info {
        // Handle special case for Ctrl+Underscore (represented as \x1F)
        if (evt.name === "\x1F") {
          return Keybind.fromParsedKey({ ...evt, name: "_", ctrl: true }, store.leader)
        }
        return Keybind.fromParsedKey(evt, store.leader)
      },
      match(key: KeybindKey, evt: ParsedKey) {
        const keybind = keybinds()[key]
        if (!keybind) return false
        const parsed: Keybind.Info = result.parse(evt)
        for (const key of keybind) {
          if (Keybind.match(key, parsed)) {
            return true
          }
        }
      },
      print(key: KeybindKey) {
        const first = keybinds()[key]?.at(0)
        if (!first) return ""
        const result = Keybind.toDisplayString(first)
        const leader = keybinds().leader?.[0]
        return leader ? result.replace("<leader>", Keybind.toDisplayString(leader)) : result
      },
    }
    return result
  },
})
