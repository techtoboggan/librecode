import { describe, expect, mock, test } from "bun:test"
import {
  createListPromptsHandler,
  createListResourceTemplatesHandler,
  createListResourcesHandler,
  createReadResourceHandler,
} from "./mcp-app-panel"

/**
 * Tests for the read-only proxy handlers added in v0.9.41.
 * Each one MUST resolve (never reject) so the AppBridge stays alive
 * even on transport failure — the in-band {isError, content} shape is
 * the contract.
 */

const baseUrl = "http://host.example"
const sessionID = "ses_abc"
const server = "acme-weather"

function okResponse(json: unknown) {
  return new Response(JSON.stringify(json), { status: 200, headers: { "Content-Type": "application/json" } })
}

describe("createListResourcesHandler", () => {
  test("GETs /session/:id/mcp-apps/resources?server=…, returns server JSON", async () => {
    const fakeList = { resources: [{ uri: "lctest://x", name: "x" }] }
    const fetchFn = mock(async () => okResponse(fakeList))
    const handler = createListResourcesHandler({ fetchFn, baseUrl, sessionID, server })

    const result = await handler()

    expect(fetchFn).toHaveBeenCalledTimes(1)
    const call = fetchFn.mock.calls[0] as unknown as [string, RequestInit]
    expect(call[0]).toBe(`${baseUrl}/session/${sessionID}/mcp-apps/resources?server=${encodeURIComponent(server)}`)
    expect(call[1]?.method).toBe("GET")
    expect(result).toEqual(fakeList)
  })

  test("missing session: in-band isError, no fetch", async () => {
    const fetchFn = mock()
    const handler = createListResourcesHandler({ fetchFn, baseUrl, sessionID: undefined, server })
    const result = (await handler()) as { isError?: boolean; content: Array<{ text: string }> }
    expect(fetchFn).toHaveBeenCalledTimes(0)
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain("No active session")
  })

  test("HTTP 5xx: in-band isError preserves the status code in the message", async () => {
    const fetchFn = mock(async () => new Response("oops", { status: 503 }))
    const handler = createListResourcesHandler({ fetchFn, baseUrl, sessionID, server })
    const result = (await handler()) as { isError?: boolean; content: Array<{ text: string }> }
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain("503")
  })
})

describe("createReadResourceHandler", () => {
  test("POSTs {server, uri} to the read route, returns server JSON", async () => {
    const fakeRead = { contents: [{ uri: "lctest://x", text: "hello" }] }
    const fetchFn = mock(async () => okResponse(fakeRead))
    const handler = createReadResourceHandler({ fetchFn, baseUrl, sessionID, server })

    const result = await handler({ uri: "lctest://x" })

    expect(fetchFn).toHaveBeenCalledTimes(1)
    const call = fetchFn.mock.calls[0] as unknown as [string, RequestInit]
    expect(call[0]).toBe(`${baseUrl}/session/${sessionID}/mcp-apps/resources/read`)
    expect(call[1]?.method).toBe("POST")
    expect(JSON.parse(call[1]?.body as string)).toEqual({ server, uri: "lctest://x" })
    expect(result).toEqual(fakeRead)
  })

  test("transport throw: in-band isError, no propagation", async () => {
    const fetchFn = mock(async () => {
      throw new Error("net down")
    })
    const handler = createReadResourceHandler({ fetchFn, baseUrl, sessionID, server })
    const result = (await handler({ uri: "lctest://x" })) as { isError?: boolean; content: Array<{ text: string }> }
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain("net down")
  })
})

describe("createListResourceTemplatesHandler", () => {
  test("GETs /session/:id/mcp-apps/resource-templates?server=…", async () => {
    const fakeList = { resourceTemplates: [] }
    const fetchFn = mock(async () => okResponse(fakeList))
    const handler = createListResourceTemplatesHandler({ fetchFn, baseUrl, sessionID, server })

    const result = await handler()

    const call = fetchFn.mock.calls[0] as unknown as [string, RequestInit]
    expect(call[0]).toBe(
      `${baseUrl}/session/${sessionID}/mcp-apps/resource-templates?server=${encodeURIComponent(server)}`,
    )
    expect(call[1]?.method).toBe("GET")
    expect(result).toEqual(fakeList)
  })
})

describe("createListPromptsHandler", () => {
  test("GETs /session/:id/mcp-apps/prompts?server=…", async () => {
    const fakeList = { prompts: [{ name: "hello" }] }
    const fetchFn = mock(async () => okResponse(fakeList))
    const handler = createListPromptsHandler({ fetchFn, baseUrl, sessionID, server })

    const result = await handler()

    const call = fetchFn.mock.calls[0] as unknown as [string, RequestInit]
    expect(call[0]).toBe(`${baseUrl}/session/${sessionID}/mcp-apps/prompts?server=${encodeURIComponent(server)}`)
    expect(call[1]?.method).toBe("GET")
    expect(result).toEqual(fakeList)
  })

  test("missing session: in-band isError", async () => {
    const fetchFn = mock()
    const handler = createListPromptsHandler({ fetchFn, baseUrl, sessionID: undefined, server })
    const result = (await handler()) as { isError?: boolean; content: Array<{ text: string }> }
    expect(fetchFn).toHaveBeenCalledTimes(0)
    expect(result.isError).toBe(true)
  })
})
