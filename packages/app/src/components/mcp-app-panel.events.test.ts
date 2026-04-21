import { describe, expect, test, mock } from "bun:test"
import { createEventForwarder, FORWARDED_EVENT_TYPES, shouldForwardEvent } from "./mcp-app-panel"

describe("FORWARDED_EVENT_TYPES", () => {
  test("covers the four event classes the built-in apps consume", () => {
    // activity graph depends on activity.updated; session stats on
    // message.part.updated. streaming-indicator + session-status round out
    // the set. If a type here changes name upstream, this test fires first.
    expect(FORWARDED_EVENT_TYPES.has("activity.updated")).toBe(true)
    expect(FORWARDED_EVENT_TYPES.has("message.part.updated")).toBe(true)
    expect(FORWARDED_EVENT_TYPES.has("message.part.delta")).toBe(true)
    expect(FORWARDED_EVENT_TYPES.has("session.status")).toBe(true)
  })

  test("does not accidentally forward noisy or sensitive events", () => {
    // If a new event type becomes forwarded, it should be an explicit
    // decision — not a drive-by. These are the ones we're sure we do NOT
    // want leaking into third-party iframes.
    for (const type of [
      "session.created",
      "session.updated",
      "session.deleted",
      "permission.request",
      "installation.updated",
    ]) {
      expect(FORWARDED_EVENT_TYPES.has(type)).toBe(false)
    }
  })
})

describe("shouldForwardEvent", () => {
  test("accepts the four forwarded types", () => {
    expect(shouldForwardEvent({ type: "activity.updated", properties: {} })).toBe(true)
    expect(shouldForwardEvent({ type: "message.part.updated", properties: {} })).toBe(true)
    expect(shouldForwardEvent({ type: "message.part.delta", properties: {} })).toBe(true)
    expect(shouldForwardEvent({ type: "session.status", properties: {} })).toBe(true)
  })

  test("rejects non-forwarded types", () => {
    expect(shouldForwardEvent({ type: "session.created" })).toBe(false)
    expect(shouldForwardEvent({ type: "permission.request" })).toBe(false)
  })

  test("rejects malformed payloads without throwing", () => {
    expect(shouldForwardEvent(undefined)).toBe(false)
    expect(shouldForwardEvent(null)).toBe(false)
    expect(shouldForwardEvent("activity.updated")).toBe(false)
    expect(shouldForwardEvent(42)).toBe(false)
    expect(shouldForwardEvent({})).toBe(false)
  })
})

describe("createEventForwarder", () => {
  type Listener = (e: { name: string; details: unknown }) => void

  function makeBus() {
    const listeners = new Set<Listener>()
    return {
      listen: (cb: Listener) => {
        listeners.add(cb)
        return () => listeners.delete(cb)
      },
      emit: (details: unknown, name = "default") => {
        for (const cb of listeners) cb({ name, details })
      },
      size: () => listeners.size,
    }
  }

  test("posts forwarded events to the iframe target", () => {
    const bus = makeBus()
    const postMessage = mock()
    const target = { postMessage }
    createEventForwarder(bus.listen, () => target)

    const payload = { type: "activity.updated", properties: { files: {}, agents: {} } }
    bus.emit(payload)

    expect(postMessage).toHaveBeenCalledTimes(1)
    expect(postMessage.mock.calls[0][0]).toEqual(payload)
    expect(postMessage.mock.calls[0][1]).toBe("*")
  })

  test("drops non-forwarded event types before touching the iframe", () => {
    const bus = makeBus()
    const postMessage = mock()
    createEventForwarder(bus.listen, () => ({ postMessage }))

    bus.emit({ type: "session.created", properties: {} })
    bus.emit({ type: "installation.updated" })

    expect(postMessage).toHaveBeenCalledTimes(0)
  })

  test("tolerates a null target (iframe detached mid-stream)", () => {
    const bus = makeBus()
    // getTarget returns null — simulates the iframe being torn down between
    // the SSE event arriving and our listener firing. The forwarder must
    // not throw or break the subscription.
    createEventForwarder(bus.listen, () => null)

    expect(() => bus.emit({ type: "activity.updated" })).not.toThrow()
  })

  test("swallows postMessage failures so one broken iframe doesn't kill the bus", () => {
    const bus = makeBus()
    const postMessage = mock(() => {
      throw new Error("iframe detached")
    })
    createEventForwarder(bus.listen, () => ({ postMessage }))

    expect(() => bus.emit({ type: "activity.updated" })).not.toThrow()

    const good = mock()
    createEventForwarder(bus.listen, () => ({ postMessage: good }))
    bus.emit({ type: "message.part.updated", properties: {} })
    expect(good).toHaveBeenCalledTimes(1)
  })

  test("unsubscribe stops forwarding", () => {
    const bus = makeBus()
    const postMessage = mock()
    const unsub = createEventForwarder(bus.listen, () => ({ postMessage }))

    bus.emit({ type: "activity.updated" })
    expect(postMessage).toHaveBeenCalledTimes(1)

    unsub()
    expect(bus.size()).toBe(0)

    bus.emit({ type: "activity.updated" })
    expect(postMessage).toHaveBeenCalledTimes(1)
  })
})
