/**
 * Tool capability and dependency declarations.
 *
 * Capabilities describe WHAT a tool can do (side effects).
 * Dependencies describe WHAT a tool needs to function.
 *
 * These declarations serve multiple purposes:
 * - Permission system: auto-classify tools by risk level
 * - Agent planning: know which tools are read-only vs mutating
 * - Dependency checking: verify required binaries exist before offering tool
 * - Documentation: self-describing tools for MCP server exposure
 * - Audit logging: tag operations with capability categories
 *
 * ## Usage
 *
 * ```typescript
 * import { Tool } from "./tool"
 * import { Capabilities } from "./capabilities"
 *
 * export const GrepTool = Tool.define("grep", {
 *   description: "Search file contents using ripgrep",
 *   capabilities: Capabilities.declare({
 *     reads: ["filesystem"],
 *     sideEffects: false,
 *   }),
 *   dependencies: Capabilities.requires({
 *     binaries: ["rg"],
 *   }),
 *   parameters: z.object({ ... }),
 *   async execute(args, ctx) { ... },
 * })
 * ```
 */

/**
 * Resource categories that a tool can read from.
 */
export type ReadableResource =
  | "filesystem" // Reads files/directories
  | "network" // Makes HTTP/network requests
  | "process" // Reads process info (env vars, cwd)
  | "database" // Reads from local database
  | "clipboard" // Reads clipboard contents

/**
 * Resource categories that a tool can write to.
 */
export type WritableResource =
  | "filesystem" // Creates/modifies/deletes files
  | "network" // Sends data over network
  | "process" // Spawns processes, modifies env
  | "database" // Writes to local database
  | "clipboard" // Writes to clipboard
  | "git" // Modifies git state (commits, branches)

/**
 * Declares what a tool can do.
 */
export interface ToolCapabilities {
  /** Resources this tool reads from */
  reads: ReadableResource[]

  /** Resources this tool writes to. Empty = read-only tool. */
  writes: WritableResource[]

  /**
   * Whether this tool has side effects beyond its return value.
   * - `false`: Safe to retry, cache, or skip. Pure read operation.
   * - `true`: Executes commands, modifies state, sends data.
   */
  sideEffects: boolean

  /**
   * Whether this tool can execute arbitrary code.
   * Tools with `executesCode: true` get stricter permission checks.
   */
  executesCode?: boolean

  /**
   * Human-readable risk level for permission UI.
   * Derived from other fields if not specified.
   */
  risk?: "low" | "medium" | "high"
}

/**
 * Declares what a tool needs to function.
 */
export interface ToolDependencies {
  /** External binaries that must be in PATH */
  binaries?: string[]

  /** Environment variables that must be set (any one suffices per group) */
  env?: string[][]

  /** Other tools that this tool delegates to */
  tools?: string[]

  /** Minimum capabilities of the runtime environment */
  runtime?: {
    /** Requires network access */
    network?: boolean
    /** Requires filesystem write access */
    fsWrite?: boolean
    /** Requires shell access */
    shell?: boolean
  }
}

/**
 * Helper to declare tool capabilities with defaults.
 */
export function declareCapabilities(caps: Partial<ToolCapabilities> & Pick<ToolCapabilities, "sideEffects">): ToolCapabilities {
  const result: ToolCapabilities = {
    reads: caps.reads ?? [],
    writes: caps.writes ?? [],
    sideEffects: caps.sideEffects,
    executesCode: caps.executesCode,
  }

  // Derive risk level if not specified
  if (!caps.risk) {
    if (result.executesCode) {
      result.risk = "high"
    } else if (result.writes.length > 0 || result.sideEffects) {
      result.risk = "medium"
    } else {
      result.risk = "low"
    }
  } else {
    result.risk = caps.risk
  }

  return result
}

/**
 * Helper to declare tool dependencies.
 */
export function requireDependencies(deps: ToolDependencies): ToolDependencies {
  return deps
}

/**
 * Pre-defined capability profiles for common tool types.
 */
export const ToolProfiles = {
  /** Read-only filesystem access (grep, glob, read, ls) */
  fileReader: declareCapabilities({
    reads: ["filesystem"],
    sideEffects: false,
  }),

  /** File modification (edit, write, patch) */
  fileWriter: declareCapabilities({
    reads: ["filesystem"],
    writes: ["filesystem"],
    sideEffects: true,
  }),

  /** Shell command execution (bash) */
  shellExecutor: declareCapabilities({
    reads: ["filesystem", "process", "network"],
    writes: ["filesystem", "process", "network", "git"],
    sideEffects: true,
    executesCode: true,
  }),

  /** Network-only access (web fetch, web search) */
  networkReader: declareCapabilities({
    reads: ["network"],
    sideEffects: false,
  }),

  /** Pure computation (no I/O) */
  pure: declareCapabilities({
    sideEffects: false,
  }),
} as const
