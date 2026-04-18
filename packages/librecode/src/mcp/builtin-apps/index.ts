import _FS_ACTIVITY_GRAPH from "./fs-activity-graph.html" with { type: "text" }
import _SESSION_STATS from "./session-stats.html" with { type: "text" }

// Bun import assertions return the text content, but TypeScript types them
// as an opaque bundle type. Cast to string for the HTML content.
const FS_ACTIVITY_GRAPH = _FS_ACTIVITY_GRAPH as unknown as string
const SESSION_STATS = _SESSION_STATS as unknown as string

export interface BuiltinApp {
  /** Virtual server name for the app */
  server: string
  /** Display name */
  name: string
  /** URI matching the MCP ui:// convention */
  uri: string
  /** Description shown in the start menu */
  description: string
  /** HTML content of the app */
  html: string
}

const BUILTIN_APPS: BuiltinApp[] = [
  {
    server: "__builtin__",
    name: "Activity Graph",
    uri: "ui://builtin/activity-graph",
    description: "Real-time visualization of file system activity and agent operations.",
    html: FS_ACTIVITY_GRAPH,
  },
  {
    server: "__builtin__",
    name: "Session Stats",
    uri: "ui://builtin/session-stats",
    description: "Token usage, tool call distribution, and cost tracking dashboard.",
    html: SESSION_STATS,
  },
]

/** List all built-in apps in the MCP AppResource format */
export function listBuiltinApps(): Array<{
  server: string
  name: string
  uri: string
  description: string
  mimeType: string
  builtin: boolean
}> {
  return BUILTIN_APPS.map((app) => ({
    server: app.server,
    name: app.name,
    uri: app.uri,
    description: app.description,
    mimeType: "text/html;profile=mcp-app",
    builtin: true,
  }))
}

/** Fetch HTML for a built-in app by URI */
export function getBuiltinAppHtml(uri: string): string | undefined {
  return BUILTIN_APPS.find((app) => app.uri === uri)?.html
}
