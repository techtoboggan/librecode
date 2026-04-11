import {
  type FileContents,
  File as PierreFile,
  type FileOptions,
  type LineAnnotation,
  type SelectedLineRange,
  VirtualizedFile,
} from "@pierre/diffs"
import { ComponentProps, createEffect, createMemo, onCleanup, Show, splitProps } from "solid-js"
import { createDefaultOptions, styleVariables } from "../../pierre"
import { markCommentedFileLines } from "../../pierre/commented-lines"
import { createFileFind } from "../../pierre/file-find"
import { findCodeSelectionSide, findFileLineNumber, readShadowLineSelection } from "../../pierre/file-selection"
import { restoreShadowTextSelection } from "../../pierre/selection-bridge"
import { getWorkerPool } from "../../pierre/worker"
import { FileSearchBar } from "../file-search"
import { FileMedia, type FileMediaOptions } from "../file-media"
import type { FileSearchControl, TextFileProps } from "../file"
import {
  codeMetrics,
  createLineCallbacks,
  createLocalVirtualStrategy,
  mouseHit,
  notifyRendered,
  parseLine,
  renderViewer,
  useAnnotationRerender,
  useModeViewer,
  useSearchHandle,
  VIRTUALIZE_BYTES,
  type ModeAdapter,
  type MouseHit,
  type Viewer,
} from "./viewer-hooks"

// ---------------------------------------------------------------------------
// Shared JSX shell (used by both TextViewer and DiffViewer)
// ---------------------------------------------------------------------------

export function ViewerShell(props: {
  mode: "text" | "diff"
  viewer: Viewer
  class: string | undefined
  classList: ComponentProps<"div">["classList"] | undefined
}): JSX.Element {
  return (
    <div
      data-component="file"
      data-mode={props.mode}
      style={styleVariables}
      class="relative outline-none"
      classList={{
        ...(props.classList || {}),
        [props.class ?? ""]: !!props.class,
      }}
      ref={(el) => (props.viewer.wrapper = el)}
      tabIndex={0}
      onPointerDown={props.viewer.find.onPointerDown}
      onFocus={props.viewer.find.onFocus}
    >
      <Show when={props.viewer.find.open()}>
        <FileSearchBar
          pos={props.viewer.find.pos}
          query={props.viewer.find.query}
          count={props.viewer.find.count}
          index={props.viewer.find.index}
          setInput={props.viewer.find.setInput}
          onInput={props.viewer.find.setQuery}
          onKeyDown={props.viewer.find.onInputKeyDown}
          onClose={props.viewer.find.close}
          onPrev={() => props.viewer.find.next(-1)}
          onNext={() => props.viewer.find.next(1)}
        />
      </Show>
      <div ref={(el) => (props.viewer.container = el)} />
      <div ref={(el) => (props.viewer.overlay = el)} class="pointer-events-none absolute inset-0 z-0" />
    </div>
  )
}

// Need JSX type
import type { JSX } from "solid-js"

const textKeys = [
  "file",
  "mode",
  "media",
  "class",
  "classList",
  "annotations",
  "selectedLines",
  "commentedLines",
  "search",
  "onLineSelected",
  "onLineSelectionEnd",
  "onLineNumberSelectionEnd",
  "onRendered",
  "preloadedDiff",
] as const

// ---------------------------------------------------------------------------
// TextViewer
// ---------------------------------------------------------------------------

export function TextViewer<T>(props: TextFileProps<T>): JSX.Element {
  let instance: PierreFile<T> | VirtualizedFile<T> | undefined
  let viewer!: Viewer

  const [local, others] = splitProps(props, textKeys)

  const text = () => {
    const value = local.file.contents as unknown
    if (typeof value === "string") return value
    if (Array.isArray(value)) return value.join("\n")
    if (value == null) return ""
    return String(value)
  }

  const lineCount = () => {
    const value = text()
    const total = value.split("\n").length - (value.endsWith("\n") ? 1 : 0)
    return Math.max(1, total)
  }

  const bytes = createMemo(() => {
    const value = local.file.contents as unknown
    if (typeof value === "string") return value.length
    if (Array.isArray(value)) {
      return value.reduce(
        (sum, part) => sum + (typeof part === "string" ? part.length + 1 : String(part).length + 1),
        0,
      )
    }
    if (value == null) return 0
    return String(value).length
  })

  const virtual = createMemo(() => bytes() > VIRTUALIZE_BYTES)

  const virtuals = createLocalVirtualStrategy(() => viewer.wrapper, virtual)

  const lineFromMouseEvent = (event: MouseEvent): MouseHit => mouseHit(event, parseLine)

  const applySelection = (range: SelectedLineRange | null) => {
    const current = instance
    if (!current) return false

    if (virtual()) {
      current.setSelectedLines(range)
      return true
    }

    const root = viewer.getRoot()
    if (!root) return false

    const total = lineCount()
    if (root.querySelectorAll("[data-line]").length < total) return false

    if (!range) {
      current.setSelectedLines(null)
      return true
    }

    const start = Math.min(range.start, range.end)
    const end = Math.max(range.start, range.end)
    if (start < 1 || end > total) {
      current.setSelectedLines(null)
      return true
    }

    if (!root.querySelector(`[data-line="${start}"]`) || !root.querySelector(`[data-line="${end}"]`)) {
      current.setSelectedLines(null)
      return true
    }

    const normalized = (() => {
      if (range.endSide != null) return { start: range.start, end: range.end }
      if (range.side !== "deletions") return range
      if (root.querySelector("[data-deletions]") != null) return range
      return { start: range.start, end: range.end }
    })()

    current.setSelectedLines(normalized)
    return true
  }

  const setSelectedLines = (range: SelectedLineRange | null) => {
    viewer.lastSelection = range
    applySelection(range)
  }

  const adapter: ModeAdapter = {
    lineFromMouseEvent,
    setSelectedLines,
    updateSelection: (preserveTextSelection) => {
      const root = viewer.getRoot()
      if (!root) return

      const selected = readShadowLineSelection({
        root,
        lineForNode: findFileLineNumber,
        sideForNode: findCodeSelectionSide,
        preserveTextSelection,
      })
      if (!selected) return

      setSelectedLines(selected.range)
      if (!preserveTextSelection || !selected.text) return
      restoreShadowTextSelection(root, selected.text)
    },
    buildDragSelection: () => {
      if (viewer.dragStart === undefined || viewer.dragEnd === undefined) return
      return { start: Math.min(viewer.dragStart, viewer.dragEnd), end: Math.max(viewer.dragStart, viewer.dragEnd) }
    },
    buildClickSelection: () => {
      if (viewer.dragStart === undefined) return
      return { start: viewer.dragStart, end: viewer.dragStart }
    },
    onDragStart: () => {},
    onDragMove: () => {},
    onDragReset: () => {},
    markCommented: markCommentedFileLines,
  }

  viewer = useModeViewer(
    {
      enableLineSelection: () => props.enableLineSelection === true,
      selectedLines: () => local.selectedLines,
      commentedLines: () => local.commentedLines,
      onLineSelectionEnd: (range) => local.onLineSelectionEnd?.(range),
    },
    adapter,
  )

  const lineCallbacks = createLineCallbacks({
    viewer,
    onLineSelected: (range) => local.onLineSelected?.(range),
    onLineSelectionEnd: (range) => local.onLineSelectionEnd?.(range),
    onLineNumberSelectionEnd: (range) => local.onLineNumberSelectionEnd?.(range),
  })

  const options = createMemo(() => ({
    ...createDefaultOptions<T>("unified"),
    ...others,
    ...lineCallbacks,
  }))

  const notify = () => {
    notifyRendered({
      viewer,
      isReady: (root) => {
        if (virtual()) return root.querySelector("[data-line]") != null
        return root.querySelectorAll("[data-line]").length >= lineCount()
      },
      onReady: () => {
        applySelection(viewer.lastSelection)
        viewer.find.refresh({ reset: true })
        local.onRendered?.()
      },
    })
  }

  useSearchHandle({
    search: () => local.search as FileSearchControl | undefined,
    find: viewer.find,
  })

  createEffect(() => {
    const opts = options()
    const workerPool = getWorkerPool("unified")
    const isVirtual = virtual()

    const virtualizer = virtuals.get()

    renderViewer({
      viewer,
      current: instance,
      create: () =>
        isVirtual && virtualizer
          ? new VirtualizedFile<T>(opts, virtualizer, codeMetrics, workerPool)
          : new PierreFile<T>(opts, workerPool),
      assign: (value) => {
        instance = value
      },
      draw: (value) => {
        const contents = text()
        value.render({
          file: typeof local.file.contents === "string" ? local.file : { ...local.file, contents },
          lineAnnotations: [],
          containerWrapper: viewer.container,
        })
      },
      onReady: notify,
    })
  })

  useAnnotationRerender<LineAnnotation<T>>({
    viewer,
    current: () => instance,
    annotations: () => (local.annotations as LineAnnotation<T>[] | undefined) ?? [],
  })

  onCleanup(() => {
    instance?.cleanUp()
    instance = undefined
    virtuals.cleanup()
  })

  return <ViewerShell mode="text" viewer={viewer} class={local.class} classList={local.classList} />
}

export function TextFileViewer<T>(props: TextFileProps<T> & { media?: FileMediaOptions }): JSX.Element {
  return <FileMedia media={props.media} fallback={() => TextViewer(props)} />
}
