import { createSignal, onCleanup, type JSX } from "solid-js"

export interface PaneDividerProps {
  /** Called with each pointer-move while dragging. delta > 0 = drag down. */
  onResize: (deltaPx: number) => void
  /** Called once when drag ends. Used to persist the final values. */
  onResizeEnd?: () => void
}

/**
 * Horizontal drag handle between two stacked panes.
 *
 * Pure component — receives onResize/onResizeEnd as callbacks and
 * doesn't reach into dock state directly. The parent is responsible
 * for calling dock.applyDividerDrag with the right URIs.
 */
export function PaneDivider(props: PaneDividerProps): JSX.Element {
  const [dragging, setDragging] = createSignal(false)
  let lastY = 0

  const onPointerDown = (e: PointerEvent) => {
    e.preventDefault()
    const target = e.currentTarget as HTMLElement
    target.setPointerCapture(e.pointerId)
    lastY = e.clientY
    setDragging(true)
  }

  const onPointerMove = (e: PointerEvent) => {
    if (!dragging()) return
    const delta = e.clientY - lastY
    lastY = e.clientY
    props.onResize(delta)
  }

  const onPointerUp = (e: PointerEvent) => {
    if (!dragging()) return
    const target = e.currentTarget as HTMLElement
    target.releasePointerCapture(e.pointerId)
    setDragging(false)
    props.onResizeEnd?.()
  }

  onCleanup(() => setDragging(false))

  return (
    <div
      data-testid="pane-divider"
      class="h-1 cursor-row-resize hover:bg-border-base shrink-0"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    />
  )
}
