import { createMemo } from "solid-js"
import { selectionFromLines, useFile, type FileSelection, type SelectedLineRange } from "@/context/file"
import { useComments } from "@/context/comments"
import { usePrompt } from "@/context/prompt"
import { useLanguage } from "@/context/language"
import { previewSelectedLines } from "@librecode/ui/pierre/selection-bridge"

type CommentContextInput = {
  file: ReturnType<typeof useFile>
  comments: ReturnType<typeof useComments>
  prompt: ReturnType<typeof usePrompt>
  language: ReturnType<typeof useLanguage>
}

export type AddCommentInput = {
  file: string
  selection: SelectedLineRange
  comment: string
  preview?: string
  origin?: "review" | "file"
}

export type UpdateCommentInput = {
  id: string
  file: string
  selection: SelectedLineRange
  comment: string
  preview?: string
}

export type RemoveCommentInput = {
  id: string
  file: string
}

export function createCommentContext(input: CommentContextInput) {
  const selectionPreview = (path: string, selection: FileSelection) => {
    const content = input.file.get(path)?.content?.content
    if (!content) return undefined
    return previewSelectedLines(content, { start: selection.startLine, end: selection.endLine })
  }

  const addCommentToContext = (add: AddCommentInput) => {
    const selection = selectionFromLines(add.selection)
    const preview = add.preview ?? selectionPreview(add.file, selection)
    const saved = input.comments.add({
      file: add.file,
      selection: add.selection,
      comment: add.comment,
    })
    input.prompt.context.add({
      type: "file",
      path: add.file,
      selection,
      comment: add.comment,
      commentID: saved.id,
      commentOrigin: add.origin,
      preview,
    })
  }

  const updateCommentInContext = (update: UpdateCommentInput) => {
    input.comments.update(update.file, update.id, update.comment)
    input.prompt.context.updateComment(update.file, update.id, {
      comment: update.comment,
      ...(update.preview ? { preview: update.preview } : {}),
    })
  }

  const removeCommentFromContext = (remove: RemoveCommentInput) => {
    input.comments.remove(remove.file, remove.id)
    input.prompt.context.removeComment(remove.file, remove.id)
  }

  const reviewCommentActions = createMemo(() => ({
    moreLabel: input.language.t("common.moreOptions"),
    editLabel: input.language.t("common.edit"),
    deleteLabel: input.language.t("common.delete"),
    saveLabel: input.language.t("common.save"),
  }))

  return { selectionPreview, addCommentToContext, updateCommentInContext, removeCommentFromContext, reviewCommentActions }
}
