import {
  FileDiff,
  type FileDiffOptions,
  type DiffLineAnnotation,
  type SelectedLineRange,
  VirtualizedFileDiff,
} from "@pierre/diffs"
import { createMediaQuery } from "@solid-primitives/media"
import { type JSX, createEffect, createMemo, onCleanup, splitProps } from "solid-js"
import { createDefaultOptions } from "../../pierre"
import { markCommentedDiffLines } from "../../pierre/commented-lines"
import { fixDiffSelection } from "../../pierre/diff-selection"
import { findDiffLineNumber, readShadowLineSelection } from "../../pierre/file-selection"
import { restoreShadowTextSelection } from "../../pierre/selection-bridge"
import { virtualMetrics } from "../../pierre/virtualizer"
import { getWorkerPool } from "../../pierre/worker"
import type { DiffFileProps } from "../file"
import {
  createLineCallbacks,
  createSharedVirtualStrategy,
  diffMouseSide,
  diffSelectionSide,
  mouseHit,
  notifyRendered,
  preserve,
  renderViewer,
  sampledChecksum,
  useAnnotationRerender,
  useModeViewer,
  useSearchHandle,
  type ModeAdapter,
  type MouseHit,
  type Viewer,
} from "./viewer-hooks"
import { ViewerShell } from "./text-viewer"
import type { FileMediaOptions } from "../file-media"
import { FileMedia } from "../file-media"

const diffKeys = ["before", "after", "mode", "media", "class", "classList", "annotations", "selectedLines",
  "commentedLines", "search", "onLineSelected", "onLineSelectionEnd", "onLineNumberSelectionEnd", "onRendered",
  "preloadedDiff"] as const

export function DiffViewer<T>(props: DiffFileProps<T>): JSX.Element {
  let instance: FileDiff<T> | undefined
  let dragSide: ReturnType<typeof diffMouseSide>
  let dragEndSide: ReturnType<typeof diffMouseSide>
  let viewer!: Viewer

  const [local, others] = splitProps(props, diffKeys)

  const mobile = createMediaQuery("(max-width: 640px)")

  const lineFromMouseEvent = (event: MouseEvent): MouseHit => mouseHit(event, findDiffLineNumber, diffMouseSide)

  const setSelectedLines = (range: SelectedLineRange | null, preserveArg?: { root: ShadowRoot; text: Range }) => {
    const active = instance
    if (!active) return

    const fixed = fixDiffSelection(viewer.getRoot(), range)
    if (fixed === undefined) {
      viewer.lastSelection = range
      return
    }

    viewer.lastSelection = fixed
    active.setSelectedLines(fixed)
    restoreShadowTextSelection(preserveArg?.root, preserveArg?.text)
  }

  const adapter: ModeAdapter = {
    lineFromMouseEvent,
    setSelectedLines,
    updateSelection: (preserveTextSelection) => {
      const root = viewer.getRoot()
      if (!root) return

      const selected = readShadowLineSelection({
        root,
        lineForNode: findDiffLineNumber,
        sideForNode: diffSelectionSide,
        preserveTextSelection,
      })
      if (!selected) return

      if (selected.text) {
        setSelectedLines(selected.range, { root, text: selected.text })
        return
      }

      setSelectedLines(selected.range)
    },
    buildDragSelection: () => {
      if (viewer.dragStart === undefined || viewer.dragEnd === undefined) return
      const selected: SelectedLineRange = { start: viewer.dragStart, end: viewer.dragEnd }
      if (dragSide) selected.side = dragSide
      if (dragEndSide && dragSide && dragEndSide !== dragSide) selected.endSide = dragEndSide
      return selected
    },
    buildClickSelection: () => {
      if (viewer.dragStart === undefined) return
      const selected: SelectedLineRange = { start: viewer.dragStart, end: viewer.dragStart }
      if (dragSide) selected.side = dragSide
      return selected
    },
    onDragStart: (hit) => {
      dragSide = hit.side
      dragEndSide = hit.side
    },
    onDragMove: (hit) => {
      dragEndSide = hit.side
    },
    onDragReset: () => {
      dragSide = undefined
      dragEndSide = undefined
    },
    markCommented: markCommentedDiffLines,
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

  const virtuals = createSharedVirtualStrategy(() => viewer.container)

  const large = createMemo(() => {
    const before = typeof local.before?.contents === "string" ? local.before.contents : ""
    const after = typeof local.after?.contents === "string" ? local.after.contents : ""
    return Math.max(before.length, after.length) > 500_000
  })

  const largeOptions = {
    lineDiffType: "none",
    maxLineDiffLength: 0,
    tokenizeMaxLineLength: 1,
  } satisfies Pick<FileDiffOptions<T>, "lineDiffType" | "maxLineDiffLength" | "tokenizeMaxLineLength">

  const lineCallbacks = createLineCallbacks({
    viewer,
    normalize: (range) => fixDiffSelection(viewer.getRoot(), range),
    onLineSelected: (range) => local.onLineSelected?.(range),
    onLineSelectionEnd: (range) => local.onLineSelectionEnd?.(range),
    onLineNumberSelectionEnd: (range) => local.onLineNumberSelectionEnd?.(range),
  })

  const options = createMemo<FileDiffOptions<T>>(() => {
    const base = {
      ...createDefaultOptions(props.diffStyle),
      ...others,
      ...lineCallbacks,
    }

    const perf = large() ? { ...base, ...largeOptions } : base
    if (!mobile()) return perf
    return { ...perf, disableLineNumbers: true }
  })

  const notify = (done?: VoidFunction) => {
    notifyRendered({
      viewer,
      isReady: (root) => root.querySelector("[data-line]") != null,
      settleFrames: 1,
      onReady: () => {
        done?.()
        setSelectedLines(viewer.lastSelection)
        viewer.find.refresh({ reset: true })
        local.onRendered?.()
      },
    })
  }

  useSearchHandle({
    search: () => local.search,
    find: viewer.find,
  })

  createEffect(() => {
    const opts = options()
    const workerPool = large() ? getWorkerPool("unified") : getWorkerPool(props.diffStyle)
    const virtualizer = virtuals.get()
    const beforeContents = typeof local.before?.contents === "string" ? local.before.contents : ""
    const afterContents = typeof local.after?.contents === "string" ? local.after.contents : ""
    const done = preserve(viewer)

    onCleanup(done)

    const cacheKey = (contents: string) => {
      if (!large()) return sampledChecksum(contents, contents.length)
      return sampledChecksum(contents)
    }

    renderViewer({
      viewer,
      current: instance,
      create: () =>
        virtualizer
          ? new VirtualizedFileDiff<T>(opts, virtualizer, virtualMetrics, workerPool)
          : new FileDiff<T>(opts, workerPool),
      assign: (value) => {
        instance = value
      },
      draw: (value) => {
        value.render({
          oldFile: { ...local.before, contents: beforeContents, cacheKey: cacheKey(beforeContents) },
          newFile: { ...local.after, contents: afterContents, cacheKey: cacheKey(afterContents) },
          lineAnnotations: [],
          containerWrapper: viewer.container,
        })
      },
      onReady: () => notify(done),
    })
  })

  useAnnotationRerender<DiffLineAnnotation<T>>({
    viewer,
    current: () => instance,
    annotations: () => (local.annotations as DiffLineAnnotation<T>[] | undefined) ?? [],
  })

  onCleanup(() => {
    instance?.cleanUp()
    instance = undefined
    virtuals.cleanup()
    dragSide = undefined
    dragEndSide = undefined
  })

  return <ViewerShell mode="diff" viewer={viewer} class={local.class} classList={local.classList} />
}

export function DiffFileViewer<T>(props: DiffFileProps<T> & { media?: FileMediaOptions }): JSX.Element {
  return <FileMedia media={props.media} fallback={() => DiffViewer(props)} />
}
