import type { TextareaRenderable, PasteEvent } from "@opentui/core"
import type { SetStoreFunction } from "solid-js/store"
import { produce } from "solid-js/store"
import { useRenderer } from "@opentui/solid"
import { useSync } from "@tui/context/sync"
import { useCommandDialog } from "../dialog-command"
import { Filesystem } from "@/util/filesystem"
import { Clipboard } from "../../util/clipboard"
import type { FilePart } from "@librecode/sdk/v2"
import path from "path"
import { normalizeLineEndings } from "./prompt-helpers"
import type { PromptInfo } from "./history"

// ---------------------------------------------------------------------------
// Paste handler logic extracted to reduce Prompt component size
// ---------------------------------------------------------------------------

type PasteStore = {
  prompt: PromptInfo
  extmarkToPartIndex: Map<number, number>
}

type PasteHandlerDeps = {
  getInput: () => TextareaRenderable
  store: PasteStore
  setStore: SetStoreFunction<PasteStore & Record<string, unknown>>
  pasteStyleId: number
  getPromptPartTypeId: () => number
}

export function usePromptPaste(deps: PasteHandlerDeps) {
  const sync = useSync()
  const command = useCommandDialog()
  const renderer = useRenderer()

  function pasteText(text: string, virtualText: string) {
    const input = deps.getInput()
    const currentOffset = input.visualCursor.offset
    const extmarkStart = currentOffset
    const extmarkEnd = extmarkStart + virtualText.length

    input.insertText(virtualText + " ")

    const extmarkId = input.extmarks.create({
      start: extmarkStart,
      end: extmarkEnd,
      virtual: true,
      styleId: deps.pasteStyleId,
      typeId: deps.getPromptPartTypeId(),
    })

    deps.setStore(
      produce((draft: PasteStore) => {
        const partIndex = draft.prompt.parts.length
        draft.prompt.parts.push({
          type: "text" as const,
          text,
          source: {
            text: {
              start: extmarkStart,
              end: extmarkEnd,
              value: virtualText,
            },
          },
        })
        draft.extmarkToPartIndex.set(extmarkId, partIndex)
      }),
    )
  }

  async function pasteImage(file: { filename?: string; content: string; mime: string }) {
    const input = deps.getInput()
    const currentOffset = input.visualCursor.offset
    const extmarkStart = currentOffset
    const count = deps.store.prompt.parts.filter((x) => x.type === "file" && x.mime.startsWith("image/")).length
    const virtualText = `[Image ${count + 1}]`
    const extmarkEnd = extmarkStart + virtualText.length
    const textToInsert = virtualText + " "

    input.insertText(textToInsert)

    const extmarkId = input.extmarks.create({
      start: extmarkStart,
      end: extmarkEnd,
      virtual: true,
      styleId: deps.pasteStyleId,
      typeId: deps.getPromptPartTypeId(),
    })

    const part: Omit<FilePart, "id" | "messageID" | "sessionID"> = {
      type: "file" as const,
      mime: file.mime,
      filename: file.filename,
      url: `data:${file.mime};base64,${file.content}`,
      source: {
        type: "file",
        path: file.filename ?? "",
        text: {
          start: extmarkStart,
          end: extmarkEnd,
          value: virtualText,
        },
      },
    }
    deps.setStore(
      produce((draft: PasteStore) => {
        const partIndex = draft.prompt.parts.length
        draft.prompt.parts.push(part)
        draft.extmarkToPartIndex.set(extmarkId, partIndex)
      }),
    )
  }

  async function handleKeyDownPaste(e: { preventDefault(): void }): Promise<boolean> {
    const content = await Clipboard.read()
    if (content?.mime.startsWith("image/")) {
      e.preventDefault()
      await pasteImage({ filename: "clipboard", mime: content.mime, content: content.data })
      return true
    }
    return false
  }

  async function handlePasteSvg(
    filepath: string,
    filename: string,
    event: { preventDefault(): void },
  ): Promise<boolean> {
    event.preventDefault()
    const content = await Filesystem.readText(filepath).catch(() => {})
    if (content) {
      pasteText(content, `[SVG: ${filename ?? "image"}]`)
      return true
    }
    return false
  }

  async function handlePasteRasterImage(
    filepath: string,
    filename: string,
    mime: string,
    event: { preventDefault(): void },
  ): Promise<boolean> {
    event.preventDefault()
    const content = await Filesystem.readArrayBuffer(filepath)
      .then((buffer) => Buffer.from(buffer).toString("base64"))
      .catch(() => {})
    if (content) {
      await pasteImage({ filename, mime, content })
      return true
    }
    return false
  }

  async function handlePasteFilePath(filepath: string, event: { preventDefault(): void }): Promise<boolean> {
    try {
      const mime = Filesystem.mimeType(filepath)
      const filename = path.basename(filepath)
      if (mime === "image/svg+xml") return await handlePasteSvg(filepath, filename, event)
      if (mime.startsWith("image/")) return await handlePasteRasterImage(filepath, filename, mime, event)
    } catch {}
    return false
  }

  function shouldSummarizePaste(pastedContent: string): boolean {
    const lineCount = (pastedContent.match(/\n/g)?.length ?? 0) + 1
    const tooLong = lineCount >= 3 || pastedContent.length > 150
    return tooLong && !sync.data.config.experimental?.disable_paste_summary
  }

  function triggerLayoutUpdate(): void {
    const input = deps.getInput()
    setTimeout(() => {
      // setTimeout is a workaround and needs to be addressed properly
      if (!input || input.isDestroyed) return
      input.getLayoutNode().markDirty()
      renderer.requestRender()
    }, 0)
  }

  async function onPaste(event: PasteEvent, isDisabled: boolean): Promise<void> {
    if (isDisabled) {
      event.preventDefault()
      return
    }

    // Normalize line endings — Windows ConPTY/Terminal often sends CR-only newlines
    const pastedContent = normalizeLineEndings(event.text).trim()
    if (!pastedContent) {
      command.trigger("prompt.paste")
      return
    }

    // trim ' from beginning/end; unescape spaces for file paths
    const filepath = pastedContent.replace(/^'+|'+$/g, "").replace(/\\ /g, " ")
    const isUrl = /^(https?):\/\//.test(filepath)
    if (!isUrl) {
      const handled = await handlePasteFilePath(filepath, event)
      if (handled) return
    }

    if (shouldSummarizePaste(pastedContent)) {
      const lineCount = (pastedContent.match(/\n/g)?.length ?? 0) + 1
      event.preventDefault()
      pasteText(pastedContent, `[Pasted ~${lineCount} lines]`)
      return
    }

    triggerLayoutUpdate()
  }

  return { pasteText, pasteImage, handleKeyDownPaste, onPaste }
}
