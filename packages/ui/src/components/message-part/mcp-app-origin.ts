/**
 * v0.9.50 — detect MCP-app-origin metadata on a text part.
 *
 * Messages posted via the v0.9.46 `ui/message` bridge handler carry
 * `_meta.mcpApp = {server, uri}` on the text part. The message
 * renderer uses this to show a "Posted by <app>" badge so the user
 * can tell at a glance which messages came from the agent chat vs
 * from an MCP app running in the sidebar.
 *
 * Pure function — exported for unit coverage without pulling in the
 * Solid / Kobalte stack.
 */

export interface McpAppOrigin {
  server: string
  uri: string
}

/**
 * Returns the McpAppOrigin if the part was posted by an MCP app,
 * undefined otherwise. Defensive about missing / malformed metadata —
 * an app can't control what ends up on the wire, but the renderer
 * must never crash on unexpected shapes.
 */
export function getMcpAppOrigin(part: unknown): McpAppOrigin | undefined {
  if (!part || typeof part !== "object") return undefined
  const meta = (part as { _meta?: unknown })._meta
  if (!meta || typeof meta !== "object") return undefined
  const mcp = (meta as { mcpApp?: unknown }).mcpApp
  if (!mcp || typeof mcp !== "object") return undefined
  const server = (mcp as { server?: unknown }).server
  const uri = (mcp as { uri?: unknown }).uri
  if (typeof server !== "string" || typeof uri !== "string") return undefined
  if (server.length === 0 || uri.length === 0) return undefined
  return { server, uri }
}
