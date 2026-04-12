import { TextAttributes, type RGBA } from "@opentui/core"
import { For, type JSX } from "solid-js"
import { useTheme, tint } from "@tui/context/theme"
import { logo, marks } from "@/cli/logo"

// Shadow markers (rendered chars in parens):
// _ = full shadow cell (space with bg=shadow)
// ^ = letter top, shadow bottom (▀ with fg=letter, bg=shadow)
// ~ = shadow top only (▀ with fg=shadow)
const SHADOW_MARKER = new RegExp(`[${marks}]`)

type RenderOpts = { fg: RGBA; shadow: RGBA; attrs: number | undefined }

function renderMarker(marker: string, opts: RenderOpts): JSX.Element | null {
  const { fg, shadow, attrs } = opts
  if (marker === "_") {
    return (
      <text fg={fg} bg={shadow} attributes={attrs} selectable={false}>
        {" "}
      </text>
    )
  }
  if (marker === "^") {
    return (
      <text fg={fg} bg={shadow} attributes={attrs} selectable={false}>
        ▀
      </text>
    )
  }
  if (marker === "~") {
    return (
      <text fg={shadow} attributes={attrs} selectable={false}>
        ▀
      </text>
    )
  }
  return null
}

function renderLine(line: string, fg: RGBA, shadow: RGBA, attrs: number | undefined): JSX.Element[] {
  const opts: RenderOpts = { fg, shadow, attrs }
  const elements: JSX.Element[] = []
  let i = 0

  while (i < line.length) {
    const rest = line.slice(i)
    const markerIndex = rest.search(SHADOW_MARKER)

    if (markerIndex === -1) {
      elements.push(
        <text fg={fg} attributes={attrs} selectable={false}>
          {rest}
        </text>,
      )
      break
    }

    if (markerIndex > 0) {
      elements.push(
        <text fg={fg} attributes={attrs} selectable={false}>
          {rest.slice(0, markerIndex)}
        </text>,
      )
    }

    const elem = renderMarker(rest[markerIndex], opts)
    if (elem) elements.push(elem)
    i += markerIndex + 1
  }

  return elements
}

export function Logo() {
  const { theme } = useTheme()

  return (
    <box>
      <For each={logo.left}>
        {(line, index) => {
          const shadowMuted = tint(theme.background, theme.textMuted, 0.25)
          const shadowText = tint(theme.background, theme.text, 0.25)
          return (
            <box flexDirection="row" gap={1}>
              <box flexDirection="row">{renderLine(line, theme.textMuted, shadowMuted, undefined)}</box>
              <box flexDirection="row">
                {renderLine(logo.right[index()], theme.text, shadowText, TextAttributes.BOLD)}
              </box>
            </box>
          )
        }}
      </For>
    </box>
  )
}
