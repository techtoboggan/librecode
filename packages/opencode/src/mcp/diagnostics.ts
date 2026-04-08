/**
 * MCP Server Diagnostics
 *
 * Provides human-readable error messages and troubleshooting suggestions
 * for common MCP server failures.
 */

import { Log } from "@/util/log"

const log = Log.create({ service: "mcp.diagnostics" })

export interface DiagnosticResult {
  /** Short error summary */
  summary: string

  /** Detailed explanation of what went wrong */
  detail: string

  /** Suggested actions to fix the issue */
  suggestions: string[]

  /** Error category for programmatic handling */
  category:
    | "auth"
    | "connection"
    | "timeout"
    | "process"
    | "config"
    | "protocol"
    | "unknown"
}

/**
 * Analyze an MCP server error and produce actionable diagnostics.
 */
export function diagnose(serverName: string, error: unknown, context?: { type?: "local" | "remote"; url?: string; command?: string[] }): DiagnosticResult {
  const message = error instanceof Error ? error.message : String(error)
  const lower = message.toLowerCase()

  // ── Auth errors ──
  if (lower.includes("unauthorized") || lower.includes("401") || lower.includes("oauth")) {
    return {
      summary: `Authentication required for "${serverName}"`,
      detail: message,
      category: "auth",
      suggestions: [
        `Run: librecode mcp auth ${serverName}`,
        "Check if the server requires an API key in headers",
        "If using OAuth, verify the callback URL is accessible (http://localhost:19876/mcp/oauth/callback)",
      ],
    }
  }

  if (lower.includes("client_registration") || lower.includes("dynamic registration")) {
    return {
      summary: `Server "${serverName}" requires a pre-registered OAuth client`,
      detail: message,
      category: "auth",
      suggestions: [
        `This server doesn't support dynamic client registration (RFC 7591).`,
        `Add clientId and clientSecret to your librecode.json: "mcpServers": { "${serverName}": { "oauth": { "clientId": "...", "clientSecret": "..." } } }`,
        "Contact the server administrator for client credentials.",
      ],
    }
  }

  // ── Connection errors ──
  if (lower.includes("econnrefused") || lower.includes("econnreset") || lower.includes("connection refused")) {
    if (context?.type === "remote") {
      return {
        summary: `Cannot reach "${serverName}" at ${context.url ?? "unknown URL"}`,
        detail: message,
        category: "connection",
        suggestions: [
          "Verify the server URL is correct",
          "Check if the server is running and accepting connections",
          "Check your network connection and any proxy/firewall settings",
          `Run: librecode mcp debug ${serverName} — to test connectivity`,
        ],
      }
    }
    return {
      summary: `Local server "${serverName}" refused connection`,
      detail: message,
      category: "connection",
      suggestions: [
        "The server process may have crashed after starting",
        "Check stderr output in the logs for startup errors",
        `Run the command manually to test: ${context?.command?.join(" ") ?? "(unknown)"}`,
      ],
    }
  }

  // ── Timeout errors ──
  if (lower.includes("timeout") || lower.includes("timed out") || lower.includes("abort")) {
    return {
      summary: `Server "${serverName}" timed out`,
      detail: message,
      category: "timeout",
      suggestions: [
        "The server may be slow to start — increase the timeout in librecode.json",
        `"mcpServers": { "${serverName}": { "timeout": 60000 } }`,
        "For local servers, check if the command takes a long time to initialize",
        "For remote servers, check network latency",
      ],
    }
  }

  // ── Process errors (local servers) ──
  if (lower.includes("enoent") || lower.includes("not found") || lower.includes("spawn")) {
    return {
      summary: `Command not found for "${serverName}"`,
      detail: message,
      category: "process",
      suggestions: [
        `Verify the command is installed: ${context?.command?.[0] ?? "unknown"}`,
        "Check that the command is in your PATH",
        "For npx commands, ensure the package exists: npx <package> --help",
        "Try specifying the full path to the command",
      ],
    }
  }

  if (lower.includes("permission denied") || lower.includes("eacces")) {
    return {
      summary: `Permission denied running "${serverName}"`,
      detail: message,
      category: "process",
      suggestions: [
        `Check file permissions on: ${context?.command?.[0] ?? "the command"}`,
        "If using a script, ensure it's executable: chmod +x <script>",
      ],
    }
  }

  // ── Protocol errors ──
  if (lower.includes("invalid json") || lower.includes("parse error") || lower.includes("unexpected token")) {
    return {
      summary: `Protocol error from "${serverName}" — invalid response`,
      detail: message,
      category: "protocol",
      suggestions: [
        "The server may not implement the MCP protocol correctly",
        "Check if the server version is compatible with MCP SDK 1.x",
        "For local servers, check that stdout is only used for MCP messages (no debug output)",
      ],
    }
  }

  if (lower.includes("method not found") || lower.includes("not implemented")) {
    return {
      summary: `Server "${serverName}" doesn't support a required MCP method`,
      detail: message,
      category: "protocol",
      suggestions: [
        "The server may be using an older MCP protocol version",
        "Check for server updates",
      ],
    }
  }

  // ── Config errors ──
  if (lower.includes("invalid url") || lower.includes("invalid config")) {
    return {
      summary: `Invalid configuration for "${serverName}"`,
      detail: message,
      category: "config",
      suggestions: [
        "Check your librecode.json mcpServers configuration",
        "Verify the URL format (must include protocol: https://)",
        `Run: librecode mcp debug ${serverName}`,
      ],
    }
  }

  // ── Unknown ──
  log.warn("unclassified MCP error", { server: serverName, error: message })
  return {
    summary: `Server "${serverName}" failed`,
    detail: message,
    category: "unknown",
    suggestions: [
      `Run: librecode mcp debug ${serverName} — for detailed diagnostics`,
      "Check the log file for more details",
      "Try disconnecting and reconnecting: librecode mcp list",
    ],
  }
}
