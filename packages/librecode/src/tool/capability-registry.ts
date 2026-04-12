/**
 * Tool Capability Registry
 *
 * Maps each tool ID to its capability and dependency declarations.
 * Used by the permission system, agent planning, and documentation.
 *
 * To add capabilities for a new tool:
 * 1. Import the relevant profiles or use declareCapabilities()
 * 2. Add an entry to TOOL_CAPABILITIES
 * 3. Add an entry to TOOL_DEPENDENCIES if the tool has external deps
 */

import {
  declareCapabilities,
  requireDependencies,
  type ToolCapabilities,
  type ToolDependencies,
  ToolProfiles,
} from "./capabilities"

/**
 * Capability declarations for every built-in tool.
 */
export const TOOL_CAPABILITIES: Record<string, ToolCapabilities> = {
  // ── File readers ──
  read: ToolProfiles.fileReader,
  glob: ToolProfiles.fileReader,
  list: ToolProfiles.fileReader,
  codesearch: ToolProfiles.fileReader,

  grep: declareCapabilities({
    reads: ["filesystem"],
    sideEffects: false,
  }),

  lsp: declareCapabilities({
    reads: ["filesystem", "process"],
    sideEffects: false,
  }),

  // ── File writers ──
  edit: ToolProfiles.fileWriter,
  write: ToolProfiles.fileWriter,
  multiedit: ToolProfiles.fileWriter,
  apply_patch: ToolProfiles.fileWriter,

  // ── Shell execution ──
  bash: ToolProfiles.shellExecutor,

  // ── Network ──
  webfetch: ToolProfiles.networkReader,
  websearch: ToolProfiles.networkReader,

  // ── Agent/session orchestration (pure logic, no I/O) ──
  plan_enter: ToolProfiles.pure,
  plan_exit: ToolProfiles.pure,
  question: ToolProfiles.pure,
  todowrite: ToolProfiles.pure,
  todoread: ToolProfiles.pure,
  invalid: ToolProfiles.pure,

  // ── Delegation tools ──
  task: declareCapabilities({
    reads: ["filesystem", "process", "network"],
    writes: ["filesystem", "process", "network"],
    sideEffects: true,
    executesCode: true,
    risk: "high",
  }),

  skill: declareCapabilities({
    reads: ["filesystem", "process", "network"],
    writes: ["filesystem", "process", "network"],
    sideEffects: true,
    executesCode: true,
    risk: "high",
  }),

  // ── Batch (wraps other tools) ──
  batch: declareCapabilities({
    reads: ["filesystem"],
    writes: ["filesystem"],
    sideEffects: true,
    risk: "medium",
  }),
}

/**
 * Dependency declarations for tools that require external binaries or env vars.
 */
export const TOOL_DEPENDENCIES: Record<string, ToolDependencies> = {
  grep: requireDependencies({
    binaries: ["rg"],
  }),

  bash: requireDependencies({
    runtime: { shell: true },
  }),

  webfetch: requireDependencies({
    runtime: { network: true },
  }),

  websearch: requireDependencies({
    runtime: { network: true },
  }),

  lsp: requireDependencies({
    runtime: { network: false },
  }),

  codesearch: requireDependencies({
    binaries: ["rg"],
  }),
}

/**
 * Look up capabilities for a tool by ID.
 * Returns undefined if the tool has no registered capabilities.
 */
export function getToolCapabilities(toolID: string): ToolCapabilities | undefined {
  return TOOL_CAPABILITIES[toolID]
}

/**
 * Look up dependencies for a tool by ID.
 */
export function getToolDependencies(toolID: string): ToolDependencies | undefined {
  return TOOL_DEPENDENCIES[toolID]
}

/**
 * Check if a tool is read-only (no writes, no side effects).
 */
export function isReadOnly(toolID: string): boolean {
  const caps = TOOL_CAPABILITIES[toolID]
  if (!caps) return false
  return caps.writes.length === 0 && !caps.sideEffects
}

/**
 * Get the risk level for a tool. Defaults to "medium" if not registered.
 */
export function getToolRisk(toolID: string): "low" | "medium" | "high" {
  return TOOL_CAPABILITIES[toolID]?.risk ?? "medium"
}
