/** A discoverable MCP App as listed by `GET /mcp/apps`. */
export interface McpAppResource {
  server: string
  name: string
  uri: string
  description?: string
}
