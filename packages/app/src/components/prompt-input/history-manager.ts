import { type SelectedLineRange, selectionFromLines } from "@/context/file"
import { useComments } from "@/context/comments"
import { usePrompt } from "@/context/prompt"
import { setCursorPosition } from "./editor-dom"
import { type PromptHistoryComment, type PromptHistoryEntry, promptLength } from "./history"
import type { Prompt } from "@/context/prompt"

type HistoryManagerInput = {
  editorRef: () => HTMLDivElement
  comments: ReturnType<typeof useComments>
  prompt: ReturnType<typeof usePrompt>
  queueScroll: () => void
  setApplyingHistory: (value: boolean) => void
}

export function createHistoryManager(input: HistoryManagerInput) {
  const historyComments = (): PromptHistoryComment[] => {
    const byID = new Map(input.comments.all().map((item) => [`${item.file}\n${item.id}`, item] as const))
    return input.prompt.context.items().flatMap((item) => {
      if (item.type !== "file") return []
      const comment = item.comment?.trim()
      if (!comment) return []

      const selection = item.commentID ? byID.get(`${item.path}\n${item.commentID}`)?.selection : undefined
      const nextSelection =
        selection ??
        (item.selection
          ? ({ start: item.selection.startLine, end: item.selection.endLine } satisfies SelectedLineRange)
          : undefined)
      if (!nextSelection) return []

      return [
        {
          id: item.commentID ?? item.key,
          path: item.path,
          selection: { ...nextSelection },
          comment,
          time: item.commentID ? (byID.get(`${item.path}\n${item.commentID}`)?.time ?? Date.now()) : Date.now(),
          origin: item.commentOrigin,
          preview: item.preview,
        } satisfies PromptHistoryComment,
      ]
    })
  }

  const applyHistoryComments = (items: PromptHistoryComment[]) => {
    input.comments.replace(
      items.map((item) => ({
        id: item.id,
        file: item.path,
        selection: { ...item.selection },
        comment: item.comment,
        time: item.time,
      })),
    )
    input.prompt.context.replaceComments(
      items.map((item) => ({
        type: "file" as const,
        path: item.path,
        selection: selectionFromLines(item.selection),
        comment: item.comment,
        commentID: item.id,
        commentOrigin: item.origin,
        preview: item.preview,
      })),
    )
  }

  const applyHistoryPrompt = (entry: PromptHistoryEntry, position: "start" | "end") => {
    const p = entry.prompt
    const length = position === "start" ? 0 : promptLength(p)
    input.setApplyingHistory(true)
    applyHistoryComments(entry.comments)
    input.prompt.set(p, length)
    requestAnimationFrame(() => {
      const editorRef = input.editorRef()
      editorRef.focus()
      setCursorPosition(editorRef, length)
      input.setApplyingHistory(false)
      input.queueScroll()
    })
  }

  return { historyComments, applyHistoryComments, applyHistoryPrompt }
}
