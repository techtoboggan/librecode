import type { useDialog } from "@librecode/ui/context/dialog"
import type { useTerminal } from "@/context/terminal"
import type { useLayout } from "@/context/layout"
import type { createSessionComposerState } from "@/pages/session/composer"
import { focusTerminalById } from "@/pages/session/helpers"

type PageKeydownInput = {
  dialog: ReturnType<typeof useDialog>
  terminal: ReturnType<typeof useTerminal>
  view: () => ReturnType<ReturnType<typeof useLayout>["view"]>
  composer: ReturnType<typeof createSessionComposerState>
  inputRef: () => HTMLDivElement | undefined
  markScrollGesture: () => void
}

const isEditableTarget = (target: EventTarget | null | undefined): boolean => {
  if (!(target instanceof HTMLElement)) return false
  return /^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(target.tagName) || target.isContentEditable
}

const deepActiveElement = (): HTMLElement | undefined => {
  let current: Element | null = document.activeElement
  while (current instanceof HTMLElement && current.shadowRoot?.activeElement) {
    current = current.shadowRoot.activeElement
  }
  return current instanceof HTMLElement ? current : undefined
}

export function createPageKeydownHandler(input: PageKeydownInput): (event: KeyboardEvent) => void {
  return (event: KeyboardEvent) => {
    const path = event.composedPath()
    const target = path.find((item): item is HTMLElement => item instanceof HTMLElement)
    const activeElement = deepActiveElement()

    const protectedTarget = path.some(
      (item) => item instanceof HTMLElement && item.closest("[data-prevent-autofocus]") !== null,
    )
    if (protectedTarget || isEditableTarget(target)) return

    if (activeElement) {
      const isProtected = activeElement.closest("[data-prevent-autofocus]")
      const isInput = isEditableTarget(activeElement)
      if (isProtected || isInput) return
    }
    if (input.dialog.active) return

    const ref = input.inputRef()
    if (activeElement === ref) {
      if (event.key === "Escape") ref?.blur()
      return
    }

    // Prefer the open terminal over the composer when it can take focus
    if (input.view().terminal.opened()) {
      const id = input.terminal.active()
      if (id && focusTerminalById(id)) return
    }

    // Only treat explicit scroll keys as potential "user scroll" gestures.
    if (event.key === "PageUp" || event.key === "PageDown" || event.key === "Home" || event.key === "End") {
      input.markScrollGesture()
      return
    }

    if (event.key.length === 1 && event.key !== "Unidentified" && !(event.ctrlKey || event.metaKey)) {
      if (input.composer.blocked()) return
      ref?.focus()
    }
  }
}
