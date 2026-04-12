import { createMemo, Show } from "solid-js"
import type { Tool } from "@/tool/tool"
import type { GlobTool } from "@/tool/glob"
import type { GrepTool } from "@/tool/grep"
import type { ListTool } from "@/tool/ls"
import type { WebFetchTool } from "@/tool/webfetch"
import { InlineTool, normalizePath, type ToolProps } from "./shared"

export function Glob(props: ToolProps<typeof GlobTool>) {
  return (
    <InlineTool icon="✱" pending="Finding files..." complete={props.input.pattern} part={props.part}>
      Glob "{props.input.pattern}" <Show when={props.input.path}>in {normalizePath(props.input.path)} </Show>
      <Show when={props.metadata.count}>
        ({props.metadata.count} {props.metadata.count === 1 ? "match" : "matches"})
      </Show>
    </InlineTool>
  )
}

export function Grep(props: ToolProps<typeof GrepTool>) {
  return (
    <InlineTool icon="✱" pending="Searching content..." complete={props.input.pattern} part={props.part}>
      Grep "{props.input.pattern}" <Show when={props.input.path}>in {normalizePath(props.input.path)} </Show>
      <Show when={props.metadata.matches}>
        ({props.metadata.matches} {props.metadata.matches === 1 ? "match" : "matches"})
      </Show>
    </InlineTool>
  )
}

export function List(props: ToolProps<typeof ListTool>) {
  const dir = createMemo(() => {
    if (props.input.path) {
      return normalizePath(props.input.path)
    }
    return ""
  })
  return (
    <InlineTool icon="→" pending="Listing directory..." complete={props.input.path !== undefined} part={props.part}>
      List {dir()}
    </InlineTool>
  )
}

export function WebFetch(props: ToolProps<typeof WebFetchTool>) {
  return (
    <InlineTool icon="%" pending="Fetching from the web..." complete={props.input.url} part={props.part}>
      WebFetch {props.input.url}
    </InlineTool>
  )
}

type SearchInput = { query?: string }
type CodeSearchMetadata = { results?: number }
type WebSearchMetadata = { numResults?: number }

export function CodeSearch(props: { input: SearchInput; metadata: CodeSearchMetadata; part: ToolProps<Tool.Info>["part"] }) {
  return (
    <InlineTool icon="◇" pending="Searching code..." complete={props.input.query} part={props.part}>
      Exa Code Search "{props.input.query}" <Show when={props.metadata.results}>({props.metadata.results} results)</Show>
    </InlineTool>
  )
}

export function WebSearch(props: { input: SearchInput; metadata: WebSearchMetadata; part: ToolProps<Tool.Info>["part"] }) {
  return (
    <InlineTool icon="◈" pending="Searching web..." complete={props.input.query} part={props.part}>
      Exa Web Search "{props.input.query}" <Show when={props.metadata.numResults}>({props.metadata.numResults} results)</Show>
    </InlineTool>
  )
}
