import type { Prompt } from "@/context/prompt"
import { getCursorPosition } from "./editor-dom"
import { canNavigateHistoryAtCursor, promptLength } from "./history"
import type { AtOption, SlashCommand } from "./slash-popover"

type PopoverState = "at" | "slash" | null
type ModeState = "normal" | "shell"

type KeyboardHandlerInput = {
  editorRef: () => HTMLDivElement
  mode: () => ModeState
  popover: () => PopoverState
  working: () => boolean
  historyIndex: () => number
  currentPrompt: () => Prompt
  escBlur: () => boolean
  atOnKeyDown: (event: KeyboardEvent) => void
  slashOnKeyDown: (event: KeyboardEvent) => void
  selectPopoverActive: () => void
  closePopover: () => void
  setMode: (mode: ModeState) => void
  setPopover: (popover: PopoverState) => void
  addNewline: () => void
  abort: () => void
  handleSubmit: (event: KeyboardEvent) => void
  pick: () => void
  navigateHistory: (direction: "up" | "down") => boolean
}

export function createKeyboardHandler(input: KeyboardHandlerInput) {
  return (event: KeyboardEvent): void => {
    if ((event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "u") {
      event.preventDefault()
      if (input.mode() !== "normal") return
      input.pick()
      return
    }

    if (event.key === "Backspace") {
      const selection = window.getSelection()
      if (selection && selection.isCollapsed) {
        const node = selection.anchorNode
        const offset = selection.anchorOffset
        if (node && node.nodeType === Node.TEXT_NODE) {
          const text = node.textContent ?? ""
          if (/^\u200B+$/.test(text) && offset > 0) {
            const range = document.createRange()
            range.setStart(node, 0)
            range.collapse(true)
            selection.removeAllRanges()
            selection.addRange(range)
          }
        }
      }
    }

    if (event.key === "!" && input.mode() === "normal") {
      const cursorPosition = getCursorPosition(input.editorRef())
      if (cursorPosition === 0) {
        input.setMode("shell")
        input.setPopover(null)
        event.preventDefault()
        return
      }
    }

    if (event.key === "Escape") {
      if (input.popover()) {
        input.closePopover()
        event.preventDefault()
        event.stopPropagation()
        return
      }

      if (input.mode() === "shell") {
        input.setMode("normal")
        event.preventDefault()
        event.stopPropagation()
        return
      }

      if (input.working()) {
        input.abort()
        event.preventDefault()
        event.stopPropagation()
        return
      }

      if (input.escBlur()) {
        input.editorRef().blur()
        event.preventDefault()
        event.stopPropagation()
        return
      }
    }

    if (input.mode() === "shell") {
      const selection = window.getSelection()
      const textLength = promptLength(input.currentPrompt())
      const collapsed = selection?.isCollapsed ?? false
      const cursorPosition = selection ? getCursorPosition(input.editorRef()) : 0
      if (event.key === "Backspace" && collapsed && cursorPosition === 0 && textLength === 0) {
        input.setMode("normal")
        event.preventDefault()
        return
      }
    }

    // Handle Shift+Enter BEFORE IME check - Shift+Enter is never used for IME input
    if (event.key === "Enter" && event.shiftKey) {
      input.addNewline()
      event.preventDefault()
      return
    }

    if (event.key === "Enter" && (event.isComposing || event.keyCode === 229)) {
      return
    }

    const ctrl = event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey

    if (input.popover()) {
      if (event.key === "Tab") {
        input.selectPopoverActive()
        event.preventDefault()
        return
      }
      const nav = event.key === "ArrowUp" || event.key === "ArrowDown" || event.key === "Enter"
      const ctrlNav = ctrl && (event.key === "n" || event.key === "p")
      if (nav || ctrlNav) {
        if (input.popover() === "at") {
          input.atOnKeyDown(event)
          event.preventDefault()
          return
        }
        if (input.popover() === "slash") {
          input.slashOnKeyDown(event)
        }
        event.preventDefault()
        return
      }
    }

    if (ctrl && event.code === "KeyG") {
      if (input.popover()) {
        input.closePopover()
        event.preventDefault()
        return
      }
      if (input.working()) {
        input.abort()
        event.preventDefault()
      }
      return
    }

    if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      if (event.altKey || event.ctrlKey || event.metaKey) return
      const selection = window.getSelection()
      if (!selection?.isCollapsed) return

      const cursorPosition = getCursorPosition(input.editorRef())
      const textContent = input
        .currentPrompt()
        .map((part) => ("content" in part ? part.content : ""))
        .join("")
      const direction = event.key === "ArrowUp" ? "up" : "down"
      if (!canNavigateHistoryAtCursor(direction, textContent, cursorPosition, input.historyIndex() >= 0)) return
      if (input.navigateHistory(direction)) {
        event.preventDefault()
      }
      return
    }

    // Note: Shift+Enter is handled earlier, before IME check
    if (event.key === "Enter" && !event.shiftKey) {
      input.handleSubmit(event)
    }
  }
}
