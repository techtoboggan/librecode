import type { McpAppResource } from "@/components/mcp-app-panel/types"

/** UI-level status — derived from MCP status + built-in synthesis. */
export type PaneStatusKind = "connected" | "connecting" | "failed" | "needs_auth" | "disabled"

export interface PaneStatus {
  kind: PaneStatusKind
  /** Human-readable label for the tooltip + accessibility text. */
  label: string
  /** Optional error detail (failed / needs_client_registration). */
  error?: string
  /** Whether this status indicates a recoverable problem (Reconnect button shown). */
  recoverable: boolean
}

const BUILTIN_SERVER = "__builtin__"

/**
 * Compute the UI status for a docked pane given the app and the live
 * sync.data.mcp map keyed by server name.
 *
 * - Built-in apps (`server === "__builtin__"`) always render as
 *   connected. They have no MCP server backing them.
 * - Missing entry in `mcpStatusMap` means the server hasn't reported
 *   yet — show as "connecting".
 * - All other statuses map per the table inside.
 *
 * Pure: same inputs always produce the same output.
 */
export function deriveStatus(
  app: Pick<McpAppResource, "server">,
  mcpStatusMap: Record<string, { status: string; error?: string } | undefined>,
): PaneStatus {
  if (app.server === BUILTIN_SERVER) {
    return { kind: "connected", label: "Connected (built-in)", recoverable: false }
  }
  const raw = mcpStatusMap[app.server]
  if (!raw) return { kind: "connecting", label: "Connecting…", recoverable: false }
  switch (raw.status) {
    case "connected":
      return { kind: "connected", label: "Connected", recoverable: false }
    case "disabled":
      return { kind: "disabled", label: "Disabled", recoverable: false }
    case "needs_auth":
      return { kind: "needs_auth", label: "Needs authentication", recoverable: true }
    case "needs_client_registration":
      return {
        kind: "failed",
        label: "Client registration required",
        error: raw.error,
        recoverable: true,
      }
    case "failed":
      return {
        kind: "failed",
        label: raw.error ? `Failed: ${raw.error}` : "Failed",
        error: raw.error,
        recoverable: true,
      }
    default:
      return { kind: "disabled", label: `Unknown status: ${raw.status}`, recoverable: false }
  }
}

/**
 * Tailwind class for the status dot. Pure — exported for test coverage
 * + so the dot component stays a thin shell.
 */
export function statusDotClass(kind: PaneStatusKind): string {
  switch (kind) {
    case "connected":
      return "bg-green-500"
    case "connecting":
      return "bg-yellow-500 animate-pulse"
    case "failed":
      return "bg-red-500"
    case "needs_auth":
      return "bg-amber-500"
    case "disabled":
      return "bg-text-weaker"
  }
}
