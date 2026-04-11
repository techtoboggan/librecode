import { sampledChecksum } from "@librecode/util/encode"
import {
  type DiffLineAnnotation,
  type FileDiffOptions,
  type LineAnnotation,
  type SelectedLineRange,
  type VirtualFileMetrics,
  DEFAULT_VIRTUAL_FILE_METRICS,
  Virtualizer,
} from "@pierre/diffs"
import { createEffect, createSignal, onCleanup, onMount } from "solid-js"
import {
  applyViewerScheme,
  clearReadyWatcher,
  createReadyWatcher,
  getViewerHost,
  getViewerRoot,
  notifyShadowReady,
  observeViewerScheme,
} from "../../pierre/file-runtime"
import { findElement } from "../../pierre/file-selection"
import { findDiffSide, type DiffSelectionSide } from "../../pierre/diff-selection"
import { createFileFind } from "../../pierre/file-find"
import { createLineNumberSelectionBridge } from "../../pierre/selection-bridge"
import { acquireVirtualizer, virtualMetrics as _virtualMetrics } from "../../pierre/virtualizer"
import type { FileSearchControl, FileSearchHandle } from "../file"

export { _virtualMetrics as virtualMetrics }

export const VIRTUALIZE_BYTES = 500_000

export const codeMetrics = {
  ...DEFAULT_VIRTUAL_FILE_METRICS,
  lineHeight: 24,
  fileGap: 0,
} satisfies Partial<VirtualFileMetrics>

// ---------------------------------------------------------------------------
// Types shared across viewer implementations
// ---------------------------------------------------------------------------

export type MouseHit = {
  line: number | undefined
  numberColumn: boolean
  side?: DiffSelectionSide
}

export type ViewerConfig = {
  enableLineSelection: () => boolean
  selectedLines: () => SelectedLineRange | null | undefined
  commentedLines: () => SelectedLineRange[]
  onLineSelectionEnd: (range: SelectedLineRange | null) => void

  // mode-specific callbacks
  lineFromMouseEvent: (event: MouseEvent) => MouseHit
  setSelectedLines: (range: SelectedLineRange | null, preserve?: { root: ShadowRoot; text: Range }) => void
  updateSelection: (preserveTextSelection: boolean) => void
  buildDragSelection: () => SelectedLineRange | undefined
  buildClickSelection: () => SelectedLineRange | undefined
  onDragStart: (hit: MouseHit) => void
  onDragMove: (hit: MouseHit) => void
  onDragReset: () => void
  markCommented: (root: ShadowRoot, ranges: SelectedLineRange[]) => void
}

export type Viewer = ReturnType<typeof useFileViewer>

export type ModeAdapter = Omit<ViewerConfig, "enableLineSelection" | "selectedLines" | "commentedLines" | "onLineSelectionEnd">

export type ModeConfig = {
  enableLineSelection: () => boolean
  selectedLines: () => SelectedLineRange | null | undefined
  commentedLines: () => SelectedLineRange[] | undefined
  onLineSelectionEnd: (range: SelectedLineRange | null) => void
}

export type RenderTarget = {
  cleanUp: () => void
}

export type AnnotationTarget<A> = {
  setLineAnnotations: (annotations: A[]) => void
  rerender: () => void
}

export type VirtualStrategy = {
  get: () => Virtualizer | undefined
  cleanup: () => void
}

// ---------------------------------------------------------------------------
// Core viewer hook
// ---------------------------------------------------------------------------

export function useFileViewer(config: ViewerConfig): Viewer {
  let wrapper!: HTMLDivElement
  let container!: HTMLDivElement
  let overlay!: HTMLDivElement
  let selectionFrame: number | undefined
  let dragFrame: number | undefined
  let dragStart: number | undefined
  let dragEnd: number | undefined
  let dragMoved = false
  let lastSelection: SelectedLineRange | null = null
  let pendingSelectionEnd = false

  const ready = createReadyWatcher()
  const bridge = createLineNumberSelectionBridge()
  const [rendered, setRendered] = createSignal(0)

  const getRoot = () => getViewerRoot(container)
  const getHost = () => getViewerHost(container)

  const find = createFileFind({
    wrapper: () => wrapper,
    overlay: () => overlay,
    getRoot,
  })

  const scheduleSelectionUpdate = () => {
    if (selectionFrame !== undefined) return
    selectionFrame = requestAnimationFrame(() => {
      selectionFrame = undefined
      const finishing = pendingSelectionEnd
      config.updateSelection(finishing)
      if (!pendingSelectionEnd) return
      pendingSelectionEnd = false
      config.onLineSelectionEnd(lastSelection)
    })
  }

  const scheduleDragUpdate = () => {
    if (dragFrame !== undefined) return
    dragFrame = requestAnimationFrame(() => {
      dragFrame = undefined
      const selected = config.buildDragSelection()
      if (selected) config.setSelectedLines(selected)
    })
  }

  const handleMouseDown = (event: MouseEvent) => {
    if (!config.enableLineSelection()) return
    if (event.button !== 0) return

    const hit = config.lineFromMouseEvent(event)
    if (hit.numberColumn) {
      bridge.begin(true, hit.line)
      return
    }
    if (hit.line === undefined) return

    bridge.begin(false, hit.line)
    dragStart = hit.line
    dragEnd = hit.line
    dragMoved = false
    config.onDragStart(hit)
  }

  const handleMouseMove = (event: MouseEvent) => {
    if (!config.enableLineSelection()) return

    const hit = config.lineFromMouseEvent(event)
    if (bridge.track(event.buttons, hit.line)) return
    if (dragStart === undefined) return

    if ((event.buttons & 1) === 0) {
      dragStart = undefined
      dragEnd = undefined
      dragMoved = false
      config.onDragReset()
      bridge.finish()
      return
    }

    if (hit.line === undefined) return
    dragEnd = hit.line
    dragMoved = true
    config.onDragMove(hit)
    scheduleDragUpdate()
  }

  const handleMouseUp = () => {
    if (!config.enableLineSelection()) return
    if (bridge.finish() === "numbers") return
    if (dragStart === undefined) return

    if (!dragMoved) {
      pendingSelectionEnd = false
      const selected = config.buildClickSelection()
      if (selected) config.setSelectedLines(selected)
      config.onLineSelectionEnd(lastSelection)
      dragStart = undefined
      dragEnd = undefined
      dragMoved = false
      config.onDragReset()
      return
    }

    pendingSelectionEnd = true
    scheduleDragUpdate()
    scheduleSelectionUpdate()

    dragStart = undefined
    dragEnd = undefined
    dragMoved = false
    config.onDragReset()
  }

  const handleSelectionChange = () => {
    if (!config.enableLineSelection()) return
    if (dragStart === undefined) return
    const selection = window.getSelection()
    if (!selection || selection.isCollapsed) return
    scheduleSelectionUpdate()
  }

  onMount(() => {
    onCleanup(observeViewerScheme(getHost))
  })

  createEffect(() => {
    rendered()
    const ranges = config.commentedLines()
    requestAnimationFrame(() => {
      const root = getRoot()
      if (!root) return
      config.markCommented(root, ranges)
    })
  })

  createEffect(() => {
    config.setSelectedLines(config.selectedLines() ?? null)
  })

  createEffect(() => {
    if (!config.enableLineSelection()) return

    container.addEventListener("mousedown", handleMouseDown)
    container.addEventListener("mousemove", handleMouseMove)
    window.addEventListener("mouseup", handleMouseUp)
    document.addEventListener("selectionchange", handleSelectionChange)

    onCleanup(() => {
      container.removeEventListener("mousedown", handleMouseDown)
      container.removeEventListener("mousemove", handleMouseMove)
      window.removeEventListener("mouseup", handleMouseUp)
      document.removeEventListener("selectionchange", handleSelectionChange)
    })
  })

  onCleanup(() => {
    clearReadyWatcher(ready)

    if (selectionFrame !== undefined) cancelAnimationFrame(selectionFrame)
    if (dragFrame !== undefined) cancelAnimationFrame(dragFrame)

    selectionFrame = undefined
    dragFrame = undefined
    dragStart = undefined
    dragEnd = undefined
    dragMoved = false
    bridge.reset()
    lastSelection = null
    pendingSelectionEnd = false
  })

  return {
    get wrapper() {
      return wrapper
    },
    set wrapper(v: HTMLDivElement) {
      wrapper = v
    },
    get container() {
      return container
    },
    set container(v: HTMLDivElement) {
      container = v
    },
    get overlay() {
      return overlay
    },
    set overlay(v: HTMLDivElement) {
      overlay = v
    },
    get dragStart() {
      return dragStart
    },
    get dragEnd() {
      return dragEnd
    },
    get lastSelection() {
      return lastSelection
    },
    set lastSelection(v: SelectedLineRange | null) {
      lastSelection = v
    },
    ready,
    bridge,
    rendered,
    setRendered,
    getRoot,
    getHost,
    find,
    scheduleSelectionUpdate,
  }
}

// ---------------------------------------------------------------------------
// Composable helpers
// ---------------------------------------------------------------------------

export function useModeViewer(config: ModeConfig, adapter: ModeAdapter): Viewer {
  return useFileViewer({
    enableLineSelection: config.enableLineSelection,
    selectedLines: config.selectedLines,
    commentedLines: () => config.commentedLines() ?? [],
    onLineSelectionEnd: config.onLineSelectionEnd,
    ...adapter,
  })
}

export function useSearchHandle(opts: {
  search: () => FileSearchControl | undefined
  find: ReturnType<typeof createFileFind>
}): void {
  createEffect(() => {
    const search = opts.search()
    if (!search) return

    const handle = {
      focus: () => opts.find.focus(),
    } satisfies FileSearchHandle

    search.register(handle)
    onCleanup(() => search.register(null))
  })
}

export function createLineCallbacks(opts: {
  viewer: Viewer
  normalize?: (range: SelectedLineRange | null) => SelectedLineRange | null | undefined
  onLineSelected?: (range: SelectedLineRange | null) => void
  onLineSelectionEnd?: (range: SelectedLineRange | null) => void
  onLineNumberSelectionEnd?: (selection: SelectedLineRange | null) => void
}): {
  onLineSelected: (range: SelectedLineRange | null) => void
  onLineSelectionEnd: (range: SelectedLineRange | null) => void
} {
  const select = (range: SelectedLineRange | null) => {
    if (!opts.normalize) return range
    const next = opts.normalize(range)
    if (next !== undefined) return next
    return range
  }

  return {
    onLineSelected: (range: SelectedLineRange | null) => {
      const next = select(range)
      opts.viewer.lastSelection = next
      opts.onLineSelected?.(next)
    },
    onLineSelectionEnd: (range: SelectedLineRange | null) => {
      const next = select(range)
      opts.viewer.lastSelection = next
      opts.onLineSelectionEnd?.(next)
      if (!opts.viewer.bridge.consume(next)) return
      requestAnimationFrame(() => opts.onLineNumberSelectionEnd?.(next))
    },
  }
}

export function useAnnotationRerender<A>(opts: {
  viewer: Viewer
  current: () => AnnotationTarget<A> | undefined
  annotations: () => A[]
}): void {
  createEffect(() => {
    opts.viewer.rendered()
    const active = opts.current()
    if (!active) return
    active.setLineAnnotations(opts.annotations())
    active.rerender()
    requestAnimationFrame(() => opts.viewer.find.refresh({ reset: true }))
  })
}

export function notifyRendered(opts: {
  viewer: Viewer
  isReady: (root: ShadowRoot) => boolean
  settleFrames?: number
  onReady: () => void
}): void {
  notifyShadowReady({
    state: opts.viewer.ready,
    container: opts.viewer.container,
    getRoot: opts.viewer.getRoot,
    isReady: opts.isReady,
    settleFrames: opts.settleFrames,
    onReady: opts.onReady,
  })
}

export function renderViewer<I extends RenderTarget>(opts: {
  viewer: Viewer
  current: I | undefined
  create: () => I
  assign: (value: I) => void
  draw: (value: I) => void
  onReady: () => void
}): void {
  clearReadyWatcher(opts.viewer.ready)
  opts.current?.cleanUp()
  const next = opts.create()
  opts.assign(next)

  opts.viewer.container.innerHTML = ""
  opts.draw(next)

  applyViewerScheme(opts.viewer.getHost())
  opts.viewer.setRendered((value) => value + 1)
  opts.onReady()
}

export function preserve(viewer: Viewer): () => void {
  const root = scrollParent(viewer.wrapper)
  if (!root) return () => {}

  const high = viewer.container.getBoundingClientRect().height
  if (!high) return () => {}

  const top = viewer.wrapper.getBoundingClientRect().top - root.getBoundingClientRect().top
  const prev = viewer.container.style.minHeight
  viewer.container.style.minHeight = `${Math.ceil(high)}px`

  let done = false
  return () => {
    if (done) return
    done = true
    viewer.container.style.minHeight = prev

    const next = viewer.wrapper.getBoundingClientRect().top - root.getBoundingClientRect().top
    const delta = next - top
    if (delta) root.scrollTop += delta
  }
}

export function scrollParent(el: HTMLElement): HTMLElement | undefined {
  let parent = el.parentElement
  while (parent) {
    const style = getComputedStyle(parent)
    if (style.overflowY === "auto" || style.overflowY === "scroll") return parent
    parent = parent.parentElement
  }
  return undefined
}

export function createLocalVirtualStrategy(host: () => HTMLDivElement | undefined, enabled: () => boolean): VirtualStrategy {
  let virtualizer: Virtualizer | undefined
  let root: Document | HTMLElement | undefined

  const release = () => {
    virtualizer?.cleanUp()
    virtualizer = undefined
    root = undefined
  }

  return {
    get: () => {
      if (!enabled()) {
        release()
        return
      }
      if (typeof document === "undefined") return

      const wrapper = host()
      if (!wrapper) return

      const next = scrollParent(wrapper) ?? document
      if (virtualizer && root === next) return virtualizer

      release()
      virtualizer = new Virtualizer()
      root = next
      virtualizer.setup(next, next instanceof Document ? undefined : wrapper)
      return virtualizer
    },
    cleanup: release,
  }
}

export function createSharedVirtualStrategy(host: () => HTMLDivElement | undefined): VirtualStrategy {
  let shared: NonNullable<ReturnType<typeof acquireVirtualizer>> | undefined

  const release = () => {
    shared?.release()
    shared = undefined
  }

  return {
    get: () => {
      if (shared) return shared.virtualizer

      const container = host()
      if (!container) return

      const result = acquireVirtualizer(container)
      if (!result) return
      shared = result
      return result.virtualizer
    },
    cleanup: release,
  }
}

// ---------------------------------------------------------------------------
// Mouse-hit helpers
// ---------------------------------------------------------------------------

export function parseLine(node: HTMLElement): number | undefined {
  if (!node.dataset.line) return
  const value = parseInt(node.dataset.line, 10)
  if (Number.isNaN(value)) return
  return value
}

export function mouseHit(
  event: MouseEvent,
  line: (node: HTMLElement) => number | undefined,
  side?: (node: HTMLElement) => DiffSelectionSide | undefined,
): MouseHit {
  const path = event.composedPath()
  let numberColumn = false
  let value: number | undefined
  let branch: DiffSelectionSide | undefined

  for (const item of path) {
    if (!(item instanceof HTMLElement)) continue

    numberColumn = numberColumn || item.dataset.columnNumber != null
    if (value === undefined) value = line(item)
    if (branch === undefined && side) branch = side(item)

    if (numberColumn && value !== undefined && (side == null || branch !== undefined)) break
  }

  return {
    line: value,
    numberColumn,
    side: branch,
  }
}

export function diffMouseSide(node: HTMLElement): DiffSelectionSide | undefined {
  const type = node.dataset.lineType
  if (type === "change-deletion") return "deletions" satisfies DiffSelectionSide
  if (type === "change-addition" || type === "change-additions") return "additions" satisfies DiffSelectionSide
  if (node.dataset.code == null) return
  return node.hasAttribute("data-deletions") ? "deletions" : "additions"
}

export function diffSelectionSide(node: Node | null): DiffSelectionSide | undefined {
  const el = findElement(node)
  if (!el) return
  return findDiffSide(el)
}

// Re-export sampledChecksum for use in diff-viewer without going through file.tsx
export { sampledChecksum }
