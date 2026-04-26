/**
 * v0.9.76 — Typed REST client for the Multica backend (https://github.com/multica-ai/multica).
 *
 * Implements the minimal subset the MCP-app tools need:
 *   - createIssue(title, description?, projectId?, priority?, status?)
 *   - updateIssueStatus(identifier, status)
 *   - addComment(identifier, body)
 *   - listProjects()
 *
 * Authentication: Personal Access Token (`mul_...` prefix) passed via
 * `Authorization: Bearer <token>` + `X-Workspace-Slug: <slug>` per
 * Multica's REST docs. Token + slug + base URL come from env / config
 * — see `index.ts` for the resolution chain.
 *
 * The package is deliberately self-contained: no LibreCode imports.
 * When this directory becomes its own repo, the file moves over
 * unchanged.
 */

export type IssueStatus = "backlog" | "todo" | "in_progress" | "in_review" | "done" | "blocked" | "cancelled"
export type IssuePriority = "no_priority" | "urgent" | "high" | "medium" | "low"

export interface Issue {
  id: string
  number: number
  identifier: string
  title: string
  description?: string
  status: IssueStatus
  priority?: IssuePriority
  workspace_id: string
  project_id?: string
  url?: string
}

export interface Project {
  id: string
  name: string
  description?: string
  workspace_id: string
}

export interface ClientOptions {
  baseUrl: string
  token: string
  workspaceSlug: string
  /** Optional fetch override — useful for tests + custom platforms. */
  fetchFn?: typeof fetch
}

export class MulticaError extends Error {
  override readonly name = "MulticaError"
  readonly status: number
  readonly endpoint: string
  constructor(opts: { message: string; status: number; endpoint: string }) {
    super(opts.message)
    this.status = opts.status
    this.endpoint = opts.endpoint
  }
}

export class MulticaClient {
  private readonly baseUrl: string
  private readonly token: string
  private readonly workspaceSlug: string
  private readonly fetchFn: typeof fetch

  constructor(opts: ClientOptions) {
    if (!opts.baseUrl) throw new Error("MulticaClient: baseUrl is required")
    if (!opts.token) throw new Error("MulticaClient: token is required (PAT with `mul_` prefix)")
    if (!opts.workspaceSlug) throw new Error("MulticaClient: workspaceSlug is required")
    // Trim trailing slash so request paths concatenate cleanly.
    this.baseUrl = opts.baseUrl.replace(/\/+$/, "")
    this.token = opts.token
    this.workspaceSlug = opts.workspaceSlug
    this.fetchFn = opts.fetchFn ?? fetch
  }

  /**
   * `GET /healthz` proxy — returns `true` when Multica responds 2xx.
   * Used by LibreCode's Control Panel to surface a green/red dot for
   * "Is the configured Multica instance reachable?"
   */
  async healthz(): Promise<boolean> {
    try {
      const res = await this.fetchFn(`${this.baseUrl}/healthz`, { method: "GET" })
      return res.ok
    } catch {
      return false
    }
  }

  async listProjects(): Promise<Project[]> {
    const body = await this.request<{ projects?: Project[] }>("GET", "/api/projects")
    return body.projects ?? []
  }

  async createIssue(input: {
    title: string
    description?: string
    projectId?: string
    priority?: IssuePriority
    status?: IssueStatus
  }): Promise<Issue> {
    if (!input.title) throw new Error("createIssue: title is required")
    const body = await this.request<{ issue: Issue }>("POST", "/api/issues", {
      title: input.title,
      description: input.description,
      project_id: input.projectId,
      priority: input.priority ?? "no_priority",
      status: input.status ?? "todo",
    })
    return body.issue
  }

  async updateIssueStatus(identifier: string, status: IssueStatus): Promise<Issue> {
    if (!identifier) throw new Error("updateIssueStatus: identifier is required")
    const body = await this.request<{ issue: Issue }>("PATCH", `/api/issues/${encodeURIComponent(identifier)}`, {
      status,
    })
    return body.issue
  }

  async addComment(identifier: string, content: string): Promise<{ ok: true; commentId?: string }> {
    if (!identifier) throw new Error("addComment: identifier is required")
    if (!content) throw new Error("addComment: content is required")
    const body = await this.request<{ comment?: { id?: string } }>(
      "POST",
      `/api/issues/${encodeURIComponent(identifier)}/comments`,
      { content },
    )
    return { ok: true, commentId: body.comment?.id }
  }

  // ── private ───────────────────────────────────────────────────────────

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const url = `${this.baseUrl}${path}`
    const init: RequestInit = {
      method,
      headers: this.headers(),
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }
    const res = await this.fetchFn(url, init)
    if (!res.ok) {
      const text = await res.text().catch(() => "")
      throw new MulticaError({
        message: text || `${method} ${path} failed with HTTP ${res.status}`,
        status: res.status,
        endpoint: path,
      })
    }
    if (res.status === 204) return {} as T
    return (await res.json()) as T
  }

  private headers(): Record<string, string> {
    return {
      authorization: `Bearer ${this.token}`,
      "x-workspace-slug": this.workspaceSlug,
      accept: "application/json",
      "content-type": "application/json",
    }
  }
}
