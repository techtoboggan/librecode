/**
 * Handler integration for the v0.9.46 ui/message bridge handler.
 * Pure helpers (validation + summarisation) are exercised by
 * mcp-app-message.test.ts; here we exercise the network shape
 * + failure mapping the AppBridge sees.
 */
import { describe, expect, mock, test } from "bun:test"
import { createUiMessageHandler, createUpdateContextHandler, summarizeContextContent } from "./mcp-app-message"

const baseUrl = "http://host.example"
const sessionID = "ses_abc"
const server = "acme"
const uri = "ui://acme/notifier"

function setup(opts?: { fetch?: ReturnType<typeof mock>; sessionID?: string | null; charLimit?: number }) {
  const fetchFn = opts?.fetch ?? mock()
  const handler = createUiMessageHandler({
    fetchFn,
    baseUrl,
    sessionID: opts?.sessionID === null ? undefined : (opts?.sessionID ?? sessionID),
    server,
    uri,
    charLimit: opts?.charLimit,
  })
  return { handler, fetchFn }
}

describe("createUiMessageHandler", () => {
  test("happy path: POSTs to /session/:id/mcp-apps/message with summarised text", async () => {
    const fetchFn = mock(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }))
    const { handler } = setup({ fetch: fetchFn })

    const result = await handler({
      content: [
        { type: "text", text: "Hello" },
        { type: "text", text: "world" },
      ],
    })

    expect(result.isError).toBeUndefined()
    expect(fetchFn).toHaveBeenCalledTimes(1)
    const call = fetchFn.mock.calls[0] as unknown as [string, RequestInit]
    expect(call[0]).toBe(`${baseUrl}/session/${sessionID}/mcp-apps/message`)
    const body = JSON.parse(call[1]?.body as string)
    expect(body).toEqual({ server, uri, text: "Hello\nworld" })
  })

  test("missing session: in-band isError, no fetch", async () => {
    const fetchFn = mock()
    const { handler } = setup({ fetch: fetchFn, sessionID: null })
    const result = await handler({ content: [{ type: "text", text: "hi" }] })
    expect(result.isError).toBe(true)
    expect(fetchFn).toHaveBeenCalledTimes(0)
  })

  test("over-limit content rejected client-side, never hits the network", async () => {
    const fetchFn = mock()
    const { handler } = setup({ fetch: fetchFn, charLimit: 5 })
    const result = await handler({ content: [{ type: "text", text: "this is too long" }] })
    expect(result.isError).toBe(true)
    expect(fetchFn).toHaveBeenCalledTimes(0)
  })

  test("HTTP non-2xx → isError", async () => {
    const fetchFn = mock(async () => new Response("nope", { status: 403 }))
    const { handler } = setup({ fetch: fetchFn })
    const result = await handler({ content: [{ type: "text", text: "hi" }] })
    expect(result.isError).toBe(true)
  })

  test("server returns isError → isError", async () => {
    const fetchFn = mock(async () => new Response(JSON.stringify({ isError: true }), { status: 200 }))
    const { handler } = setup({ fetch: fetchFn })
    const result = await handler({ content: [{ type: "text", text: "hi" }] })
    expect(result.isError).toBe(true)
  })

  test("transport throw → isError, no propagation", async () => {
    const fetchFn = mock(async () => {
      throw new Error("net down")
    })
    const { handler } = setup({ fetch: fetchFn })
    const result = await handler({ content: [{ type: "text", text: "hi" }] })
    expect(result.isError).toBe(true)
  })
})

describe("summarizeContextContent", () => {
  test("plain string passes through", () => {
    expect(summarizeContextContent("hello world")).toBe("hello world")
  })

  test("array of content blocks summarises like ui/message text", () => {
    expect(
      summarizeContextContent([
        { type: "text", text: "Hello" },
        { type: "text", text: "world" },
      ]),
    ).toBe("Hello\nworld")
  })

  test("undefined / non-array / non-string → empty string", () => {
    expect(summarizeContextContent(undefined)).toBe("")
    expect(summarizeContextContent(123)).toBe("")
    expect(summarizeContextContent({})).toBe("")
  })
})

describe("createUpdateContextHandler", () => {
  function setupCtx(opts?: { fetch?: ReturnType<typeof mock>; sessionID?: string | null }) {
    const fetchFn = opts?.fetch ?? mock(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }))
    const handler = createUpdateContextHandler({
      fetchFn,
      baseUrl: "http://host.example",
      sessionID: opts?.sessionID === null ? undefined : (opts?.sessionID ?? "ses_abc"),
      server: "acme",
      uri: "ui://acme/notes",
    })
    return { handler, fetchFn }
  }

  test("happy path: POSTs {server, uri, content, structuredContent}", async () => {
    const { handler, fetchFn } = setupCtx()
    await handler({ content: "hello", structuredContent: { score: 1 } })

    const call = fetchFn.mock.calls[0] as unknown as [string, RequestInit]
    expect(call[0]).toBe("http://host.example/session/ses_abc/mcp-apps/context")
    const body = JSON.parse(call[1]?.body as string)
    expect(body).toEqual({ server: "acme", uri: "ui://acme/notes", content: "hello", structuredContent: { score: 1 } })
  })

  test("missing session: spec-compliant {} return, no fetch", async () => {
    const { handler, fetchFn } = setupCtx({ sessionID: null })
    const result = await handler({ content: "x" })
    expect(result).toEqual({})
    expect(fetchFn).toHaveBeenCalledTimes(0)
  })

  test("transport throw: spec-compliant {} return — host failure does not propagate", async () => {
    const fetchFn = mock(async () => {
      throw new Error("network unreachable")
    })
    const { handler } = setupCtx({ fetch: fetchFn })
    const result = await handler({ content: "x" })
    expect(result).toEqual({})
  })

  test("array content is summarised before being sent", async () => {
    const { handler, fetchFn } = setupCtx()
    await handler({
      content: [
        { type: "text", text: "First line" },
        { type: "text", text: "Second line" },
      ] as unknown,
    })
    const body = JSON.parse((fetchFn.mock.calls[0] as unknown as [string, RequestInit])[1]?.body as string)
    expect(body.content).toBe("First line\nSecond line")
  })
})
