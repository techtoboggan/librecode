/**
 * Central registries for part components and tool renderers.
 * Kept in its own module to avoid circular imports between message-part.tsx
 * and tool-renders.tsx.
 */
import type { Component } from "solid-js"
import type { MessagePartProps } from "./types"
import type { ToolComponent } from "./shared"

// ---------------------------------------------------------------------------
// Part component registry (keyed by part type string)
// ---------------------------------------------------------------------------

export type PartComponent = Component<MessagePartProps>

export const PART_MAPPING: Record<string, PartComponent | undefined> = {}

export function registerPartComponent(type: string, component: PartComponent) {
  PART_MAPPING[type] = component
}

// ---------------------------------------------------------------------------
// Tool renderer registry
// ---------------------------------------------------------------------------

const toolState: Record<
  string,
  {
    name: string
    render?: ToolComponent
  }
> = {}

export function registerTool(input: { name: string; render?: ToolComponent }) {
  toolState[input.name] = input
  return input
}

export function getTool(name: string) {
  return toolState[name]?.render
}

export const ToolRegistry = {
  register: registerTool,
  render: getTool,
}
