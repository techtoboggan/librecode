import { type JSX } from "solid-js"
import type { ComponentProps } from "solid-js"
import {
  type DiffLineAnnotation,
  type FileContents,
  type FileDiffOptions,
  type FileOptions,
  type LineAnnotation,
  type SelectedLineRange,
} from "@pierre/diffs"
import type { PreloadMultiFileDiffResult } from "@pierre/diffs/ssr"
import type { FileMediaOptions } from "./file-media"
import { TextViewer } from "./file/text-viewer"
import { DiffViewer } from "./file/diff-viewer"
import { FileMedia } from "./file-media"

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type FileSearchHandle = {
  focus: () => void
}

export type FileSearchControl = {
  register: (handle: FileSearchHandle | null) => void
}

type SharedProps<T> = {
  annotations?: LineAnnotation<T>[] | DiffLineAnnotation<T>[]
  selectedLines?: SelectedLineRange | null
  commentedLines?: SelectedLineRange[]
  onLineNumberSelectionEnd?: (selection: SelectedLineRange | null) => void
  onRendered?: () => void
  class?: string
  classList?: ComponentProps<"div">["classList"]
  media?: FileMediaOptions
  search?: FileSearchControl
}

export type TextFileProps<T = {}> = FileOptions<T> &
  SharedProps<T> & {
    mode: "text"
    file: FileContents
    annotations?: LineAnnotation<T>[]
    preloadedDiff?: PreloadMultiFileDiffResult<T>
  }

export type DiffFileProps<T = {}> = FileDiffOptions<T> &
  SharedProps<T> & {
    mode: "diff"
    before: FileContents
    after: FileContents
    annotations?: DiffLineAnnotation<T>[]
    preloadedDiff?: PreloadMultiFileDiffResult<T>
  }

export type FileProps<T = {}> = TextFileProps<T> | DiffFileProps<T>

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function File<T>(props: FileProps<T>): JSX.Element {
  if (props.mode === "text") {
    return <FileMedia media={props.media} fallback={() => TextViewer(props)} />
  }

  return <FileMedia media={props.media} fallback={() => DiffViewer(props)} />
}
