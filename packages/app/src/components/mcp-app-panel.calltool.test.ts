import { describe, expect, mock, test } from "bun:test"
import { createCallToolHandler } from "./mcp-app-panel"

/**
 * Tests for the AppBridge `oncalltool` handler that proxies an iframe
 * tools/call request to the host's /session/:id/mcp-apps/tool endpoint.
 *
 * The handler MUST always resolve to a CallToolResult-shaped object
 * (never reject), because rejecting would tear down the bridge mid-call.
 * In-band failures (HTTP error, network drop, missing session) become
 * `{isError: true, content: [...]}`.
 */
describe("createCallToolHandler", () => {
  function setup(opts: { fetch?: ReturnType<typeof mock>; sessionID?: string | null } = {}) {
    const fetchFn = opts.fetch ?? mock()
    const handler = createCallToolHandler({
      fetchFn,
      baseUrl: "http://host.example",
      // null = explicitly absent for the "no session" case; undefined =
      // not provided, default to a real id.
      sessionID: opts.sessionID === null ? undefined : (opts.sessionID ?? "ses_abc"),
      server: "acme-weather",
      uri: "ui://acme/weather",
    })
    return { handler, fetchFn }
  }

  test("happy path: POSTs to the right URL with the right body, returns server JSON", async () => {
    const fakeResult = { content: [{ type: "text", text: "72F" }] }
    const fetchFn = mock(
      async () =>
        new Response(JSON.stringify(fakeResult), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    )
    const { handler } = setup({ fetch: fetchFn })

    const result = await handler({ name: "get_forecast", arguments: { location: "NYC" } })

    expect(fetchFn).toHaveBeenCalledTimes(1)
    const [calledUrl, init] = fetchFn.mock.calls[0]
    expect(String(calledUrl)).toBe("http://host.example/session/ses_abc/mcp-apps/tool")
    expect(init.method).toBe("POST")
    expect(init.headers).toEqual({ "Content-Type": "application/json" })
    const body = JSON.parse(init.body as string)
    expect(body).toEqual({
      server: "acme-weather",
      uri: "ui://acme/weather",
      name: "get_forecast",
      arguments: { location: "NYC" },
    })

    expect(result).toEqual(fakeResult)
  })

  test("missing session: resolves with isError, never hits the network", async () => {
    const fetchFn = mock()
    const { handler } = setup({ fetch: fetchFn, sessionID: null })

    const result = await handler({ name: "echo", arguments: {} })
    expect(fetchFn).toHaveBeenCalledTimes(0)
    expect(result.isError).toBe(true)
    expect((result.content[0] as { text: string }).text).toContain("no active session")
  })

  test("HTTP non-2xx: maps to in-band isError result, doesn't throw", async () => {
    const fetchFn = mock(async () => new Response("nope", { status: 403 }))
    const { handler } = setup({ fetch: fetchFn })

    const result = await handler({ name: "rm", arguments: {} })
    expect(result.isError).toBe(true)
    expect((result.content[0] as { text: string }).text).toContain("403")
  })

  test("transport error (fetch throws): maps to isError, doesn't propagate", async () => {
    const fetchFn = mock(async () => {
      throw new Error("network unreachable")
    })
    const { handler } = setup({ fetch: fetchFn })

    const result = await handler({ name: "echo" })
    expect(result.isError).toBe(true)
    expect((result.content[0] as { text: string }).text).toContain("network unreachable")
  })

  test("missing arguments: serializes as empty object", async () => {
    const fetchFn = mock(async () => new Response(JSON.stringify({ content: [] }), { status: 200 }))
    const { handler } = setup({ fetch: fetchFn })
    await handler({ name: "ping" })
    const body = JSON.parse(fetchFn.mock.calls[0][1].body as string)
    expect(body.arguments).toEqual({})
  })
})
