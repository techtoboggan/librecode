/**
 * v0.9.76 — Multica MCP server-glue tests.
 *
 * Covers the pure helpers (`loadConfigFromEnv`, `renderBoardHtml`)
 * and the tool handlers (formatToolError + the run* functions
 * driven against a fake fetch). The full stdio transport path
 * isn't wired up — that's an integration concern owned by the host
 * and exercised manually.
 */
import { describe, expect, test } from "bun:test"
import { MulticaClient } from "../src/multica/client"
import { formatToolError, runAddComment, runCreateIssue, runUpdateStatus } from "../src/mcp/tools"
import { loadConfigFromEnv, renderBoardHtml } from "../src/mcp/server"

function fakeClient(handler: (url: string, init: RequestInit) => Response | Promise<Response>): MulticaClient {
  const fetchFn = async (input: RequestInfo | URL, init?: RequestInit) => handler(input.toString(), init ?? {})
  return new MulticaClient({
    baseUrl: "http://multica.local:8080",
    token: "mul_test",
    workspaceSlug: "acme",
    fetchFn: fetchFn as typeof fetch,
  })
}

describe("loadConfigFromEnv", () => {
  test("accepts a complete env + applies sensible defaults for optional fields", () => {
    const config = loadConfigFromEnv({
      MULTICA_BASE_URL: "http://localhost:8080",
      MULTICA_TOKEN: "mul_x",
      MULTICA_WORKSPACE_SLUG: "acme",
    })
    expect(config.baseUrl).toBe("http://localhost:8080")
    expect(config.token).toBe("mul_x")
    expect(config.workspaceSlug).toBe("acme")
    // Defaults match what a fresh self-hosted Multica install exposes.
    expect(config.webUrl).toBe("http://localhost:3000")
    expect(config.boardPath).toBe("/board")
  })

  test("respects MULTICA_WEB_URL and MULTICA_BOARD_PATH overrides", () => {
    const config = loadConfigFromEnv({
      MULTICA_BASE_URL: "http://localhost:8080",
      MULTICA_TOKEN: "mul_x",
      MULTICA_WORKSPACE_SLUG: "acme",
      MULTICA_WEB_URL: "https://multica.acme.com",
      MULTICA_BOARD_PATH: "/issues?view=board",
    })
    expect(config.webUrl).toBe("https://multica.acme.com")
    expect(config.boardPath).toBe("/issues?view=board")
  })

  test("throws naming exactly which env vars are missing", () => {
    expect(() => loadConfigFromEnv({})).toThrow(/MULTICA_BASE_URL.*MULTICA_TOKEN.*MULTICA_WORKSPACE_SLUG/)
  })

  test("naming: only the missing vars are listed", () => {
    expect(() =>
      loadConfigFromEnv({
        MULTICA_BASE_URL: "http://localhost:8080",
        MULTICA_TOKEN: "mul_x",
      }),
    ).toThrow(/MULTICA_WORKSPACE_SLUG/)
  })
})

describe("renderBoardHtml", () => {
  const baseConfig = {
    baseUrl: "http://localhost:8080",
    token: "mul_x",
    workspaceSlug: "acme",
    webUrl: "http://localhost:3000",
    boardPath: "/board",
  }

  test("injects the three meta tags so the iframe knows where to point", () => {
    const out = renderBoardHtml("<html><head></head><body></body></html>", baseConfig)
    expect(out).toContain('name="multica-board:web-url"')
    expect(out).toContain('content="http://localhost:3000"')
    expect(out).toContain('name="multica-board:workspace-slug"')
    expect(out).toContain('content="acme"')
    expect(out).toContain('name="multica-board:path"')
    expect(out).toContain('content="/board"')
  })

  test("HTML-escapes config values so a quote in the workspace slug can't break out", () => {
    const out = renderBoardHtml("<html><head></head></html>", { ...baseConfig, workspaceSlug: 'evil"slug' })
    expect(out).toContain("&quot;")
    expect(out).not.toContain('content="evil"slug"')
  })

  test("falls back to creating a head block when the template has no <head>", () => {
    const out = renderBoardHtml("<html><body>hi</body></html>", baseConfig)
    expect(out).toContain("<head>")
    expect(out).toContain("multica-board:workspace-slug")
  })
})

describe("formatToolError", () => {
  test("wraps an Error with the tool name", () => {
    const result = formatToolError(new Error("boom"), "multica_create_issue")
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toBe("multica_create_issue failed: boom")
  })

  test("stringifies non-Error throws", () => {
    const result = formatToolError("oops", "multica_add_comment")
    expect(result.content[0].text).toBe("multica_add_comment failed: oops")
  })
})

describe("runCreateIssue", () => {
  test("happy path: returns identifier + status in the human-readable text", async () => {
    const client = fakeClient(
      () =>
        new Response(
          JSON.stringify({
            issue: {
              id: "iss-1",
              identifier: "ACME-1",
              number: 1,
              title: "Hello",
              status: "todo",
              workspace_id: "ws-1",
            },
          }),
        ),
    )
    const result = await runCreateIssue(client, { title: "Hello" })
    expect(result.isError).toBeUndefined()
    expect(result.content[0].text).toContain("ACME-1")
    expect(result.content[0].text).toContain("todo")
    expect((result._meta?.issue as { identifier: string } | undefined)?.identifier).toBe("ACME-1")
  })

  test("server error: returns an isError result with the message", async () => {
    const client = fakeClient(() => new Response("forbidden", { status: 403 }))
    const result = await runCreateIssue(client, { title: "Hello" })
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain("forbidden")
  })
})

describe("runUpdateStatus", () => {
  test("happy path: confirms the new status", async () => {
    const client = fakeClient(
      () =>
        new Response(
          JSON.stringify({
            issue: { id: "iss-1", identifier: "ACME-1", number: 1, title: "X", status: "done", workspace_id: "ws-1" },
          }),
        ),
    )
    const result = await runUpdateStatus(client, { identifier: "ACME-1", status: "done" })
    expect(result.isError).toBeUndefined()
    expect(result.content[0].text).toContain("ACME-1")
    expect(result.content[0].text).toContain("done")
  })
})

describe("runAddComment", () => {
  test("happy path: confirms the comment landed", async () => {
    const client = fakeClient(() => new Response(JSON.stringify({ comment: { id: "cm-1" } })))
    const result = await runAddComment(client, { identifier: "ACME-1", content: "Hello" })
    expect(result.isError).toBeUndefined()
    expect(result.content[0].text).toContain("Added comment")
    expect(result._meta?.commentId).toBe("cm-1")
  })
})
