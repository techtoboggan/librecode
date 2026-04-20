import { describe, expect, test } from "bun:test"
import { makeAuthedFetch } from "./global-sdk"

describe("makeAuthedFetch", () => {
  test("passes through when server has no password", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = []
    const stub = (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), init })
      return Promise.resolve(new Response("ok", { status: 200 }))
    }
    const f = makeAuthedFetch(() => ({ url: "http://localhost:4096" }), stub)
    await f("http://localhost:4096/mcp/apps")

    expect(calls).toHaveLength(1)
    const headers = new Headers(calls[0].init?.headers)
    expect(headers.has("Authorization")).toBe(false)
  })

  test("attaches Basic auth when server has a password", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = []
    const stub = (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), init })
      return Promise.resolve(new Response("ok", { status: 200 }))
    }
    const f = makeAuthedFetch(() => ({ url: "http://localhost:4096", password: "secret-123" }), stub)
    await f("http://localhost:4096/mcp/apps")

    expect(calls).toHaveLength(1)
    const headers = new Headers(calls[0].init?.headers)
    const auth = headers.get("Authorization")
    expect(auth).toBe(`Basic ${btoa("librecode:secret-123")}`)
  })

  test("honors custom username", async () => {
    const calls: Array<{ init?: RequestInit }> = []
    const stub = (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ init })
      return Promise.resolve(new Response("ok"))
    }
    const f = makeAuthedFetch(
      () => ({
        url: "http://localhost:4096",
        username: "admin",
        password: "pw",
      }),
      stub,
    )
    await f("http://localhost:4096/mcp/apps")

    const headers = new Headers(calls[0].init?.headers)
    expect(headers.get("Authorization")).toBe(`Basic ${btoa("admin:pw")}`)
  })

  test("does not overwrite an explicit Authorization header", async () => {
    const calls: Array<{ init?: RequestInit }> = []
    const stub = (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ init })
      return Promise.resolve(new Response("ok"))
    }
    const f = makeAuthedFetch(() => ({ url: "http://localhost:4096", password: "secret" }), stub)
    await f("http://localhost:4096/mcp/apps", {
      headers: { Authorization: "Bearer token-from-caller" },
    })

    const headers = new Headers(calls[0].init?.headers)
    expect(headers.get("Authorization")).toBe("Bearer token-from-caller")
  })

  test("preserves caller-supplied headers alongside auth", async () => {
    const calls: Array<{ init?: RequestInit }> = []
    const stub = (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ init })
      return Promise.resolve(new Response("ok"))
    }
    const f = makeAuthedFetch(() => ({ url: "http://localhost:4096", password: "pw" }), stub)
    await f("http://localhost:4096/mcp/apps", {
      headers: { "x-librecode-directory": "/home/user/project" },
    })

    const headers = new Headers(calls[0].init?.headers)
    expect(headers.get("Authorization")).toBe(`Basic ${btoa("librecode:pw")}`)
    expect(headers.get("x-librecode-directory")).toBe("/home/user/project")
  })

  test("re-evaluates credentials on each call (reactive getHttp)", async () => {
    const calls: Array<{ init?: RequestInit }> = []
    const stub = (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ init })
      return Promise.resolve(new Response("ok"))
    }
    let password: string | undefined
    const f = makeAuthedFetch(() => ({ url: "http://localhost:4096", password }), stub)

    // First call: no password
    await f("http://localhost:4096/mcp/apps")
    expect(new Headers(calls[0].init?.headers).has("Authorization")).toBe(false)

    // Credentials appear (simulates the async sidecar-ready race)
    password = "late-arriving-pw"
    await f("http://localhost:4096/mcp/apps")
    expect(new Headers(calls[1].init?.headers).get("Authorization")).toBe(`Basic ${btoa("librecode:late-arriving-pw")}`)
  })

  test("falls back to platformFetch when provided", async () => {
    let platformCalled = 0
    const platformFetch = (input: RequestInfo | URL, init?: RequestInit) => {
      platformCalled++
      return Promise.resolve(new Response("pf"))
    }
    const f = makeAuthedFetch(() => ({ url: "http://localhost:4096", password: "pw" }), platformFetch)
    await f("http://localhost:4096/mcp/apps")
    expect(platformCalled).toBe(1)
  })
})
