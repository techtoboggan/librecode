/**
 * v0.9.50 — tests for the pure MCP-app origin detector used to show
 * the "Posted by <app>" badge on user messages.
 *
 * The function must never throw on unexpected shapes — user-message
 * rendering runs for every part in the timeline, and a crash here
 * would blank the whole session view.
 */
import { describe, expect, test } from "bun:test"
import { getMcpAppOrigin } from "./mcp-app-origin"

describe("getMcpAppOrigin", () => {
  test("returns {server, uri} when the part has _meta.mcpApp with both", () => {
    expect(
      getMcpAppOrigin({
        type: "text",
        text: "hi",
        _meta: { mcpApp: { server: "acme", uri: "ui://acme/x" } },
      }),
    ).toEqual({ server: "acme", uri: "ui://acme/x" })
  })

  test("returns undefined when _meta is missing", () => {
    expect(getMcpAppOrigin({ type: "text", text: "hi" })).toBeUndefined()
  })

  test("returns undefined when _meta has no mcpApp key", () => {
    expect(getMcpAppOrigin({ type: "text", text: "hi", _meta: { other: true } })).toBeUndefined()
  })

  test("returns undefined when server or uri is missing", () => {
    expect(getMcpAppOrigin({ _meta: { mcpApp: { server: "acme" } } })).toBeUndefined()
    expect(getMcpAppOrigin({ _meta: { mcpApp: { uri: "ui://x" } } })).toBeUndefined()
  })

  test("returns undefined when server or uri is empty string", () => {
    expect(getMcpAppOrigin({ _meta: { mcpApp: { server: "", uri: "ui://x" } } })).toBeUndefined()
    expect(getMcpAppOrigin({ _meta: { mcpApp: { server: "acme", uri: "" } } })).toBeUndefined()
  })

  test("returns undefined when types are wrong (defensive against misbehaving servers)", () => {
    expect(getMcpAppOrigin({ _meta: { mcpApp: { server: 123, uri: "ui://x" } } })).toBeUndefined()
    expect(getMcpAppOrigin({ _meta: { mcpApp: "not-an-object" } })).toBeUndefined()
    expect(getMcpAppOrigin({ _meta: "not-an-object" })).toBeUndefined()
  })

  test("never throws on non-object / null / undefined inputs", () => {
    expect(getMcpAppOrigin(undefined)).toBeUndefined()
    expect(getMcpAppOrigin(null)).toBeUndefined()
    expect(getMcpAppOrigin("string")).toBeUndefined()
    expect(getMcpAppOrigin(42)).toBeUndefined()
  })
})
