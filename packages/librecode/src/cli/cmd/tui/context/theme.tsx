import { RGBA } from "@opentui/core"
import path from "path"
import { createEffect, createMemo, onMount } from "solid-js"
import { createSimpleContext } from "./helper"
import { Glob } from "../../../../util/glob"
import { useKV } from "./kv"
import { useRenderer } from "@opentui/solid"
import { createStore, produce } from "solid-js/store"
import { Global } from "@/global"
import { Filesystem } from "@/util/filesystem"
import { useTuiConfig } from "./tui-config"
import {
  DEFAULT_THEMES,
  generateSubtleSyntax,
  generateSyntax,
  generateSystem,
  resolveTheme,
  type Theme,
  type ThemeColors,
  type ThemeJson,
} from "./theme-tokens"

// Re-export types and utilities that callers depend on
export type { Theme, ThemeColors, ThemeJson }
export { DEFAULT_THEMES, tint, selectedForeground } from "./theme-tokens"

export const { use: useTheme, provider: ThemeProvider } = createSimpleContext({
  name: "Theme",
  init: (props: { mode: "dark" | "light" }) => {
    const config = useTuiConfig()
    const kv = useKV()
    const [store, setStore] = createStore({
      themes: DEFAULT_THEMES,
      mode: kv.get("theme_mode", props.mode),
      active: (config.theme ?? kv.get("theme", "librecode")) as string,
      ready: false,
    })

    createEffect(() => {
      const theme = config.theme
      if (theme) setStore("active", theme)
    })

    const renderer = useRenderer()

    function resolveSystemTheme() {
      console.log("resolveSystemTheme")
      renderer
        .getPalette({
          size: 16,
        })
        .then((colors) => {
          console.log(colors.palette)
          if (!colors.palette[0]) {
            if (store.active === "system") {
              setStore(
                produce((draft) => {
                  draft.active = "librecode"
                  draft.ready = true
                }),
              )
            }
            return
          }
          setStore(
            produce((draft) => {
              draft.themes.system = generateSystem(colors, store.mode)
              if (store.active === "system") {
                draft.ready = true
              }
            }),
          )
        })
    }

    function init() {
      resolveSystemTheme()
      getCustomThemes()
        .then((custom) => {
          setStore(
            produce((draft) => {
              Object.assign(draft.themes, custom)
            }),
          )
        })
        .catch(() => {
          setStore("active", "librecode")
        })
        .finally(() => {
          if (store.active !== "system") {
            setStore("ready", true)
          }
        })
    }

    onMount(init)

    process.on("SIGUSR2", async () => {
      renderer.clearPaletteCache()
      init()
    })

    const values = createMemo(() => {
      return resolveTheme(store.themes[store.active] ?? store.themes.librecode, store.mode)
    })

    const syntax = createMemo(() => generateSyntax(values()))
    const subtleSyntax = createMemo(() => generateSubtleSyntax(values()))

    return {
      theme: new Proxy(values(), {
        get(_target, prop) {
          // @ts-expect-error
          return values()[prop]
        },
      }),
      get selected() {
        return store.active
      },
      all() {
        return store.themes
      },
      syntax,
      subtleSyntax,
      mode() {
        return store.mode
      },
      setMode(mode: "dark" | "light") {
        setStore("mode", mode)
        kv.set("theme_mode", mode)
      },
      set(theme: string) {
        setStore("active", theme)
        kv.set("theme", theme)
      },
      get ready() {
        return store.ready
      },
    }
  },
})

async function getCustomThemes(): Promise<Record<string, ThemeJson>> {
  const directories = [
    Global.Path.config,
    ...(await Array.fromAsync(
      Filesystem.up({
        targets: [".librecode"],
        start: process.cwd(),
      }),
    )),
  ]

  const result: Record<string, ThemeJson> = {}
  for (const dir of directories) {
    for (const item of await Glob.scan("themes/*.json", {
      cwd: dir,
      absolute: true,
      dot: true,
      symlink: true,
    })) {
      const name = path.basename(item, ".json")
      result[name] = await Filesystem.readJson(item)
    }
  }
  return result
}
