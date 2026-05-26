import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"
import type { Span, Tracer } from "@opentelemetry/api"
import { trace } from "@opentelemetry/api"

/**
 * Tests for dock-pane telemetry gate + attribute mapping.
 *
 * Mocks the OTel global tracer so no real spans are emitted.
 * Phase 50.
 */

// ── Fake span + tracer ────────────────────────────────────────────────────────

interface SpanCall {
  name: string
  attributes: Record<string, string | number | undefined>
  ended: boolean
}

function makeFakeTracer(): { tracer: Tracer; calls: SpanCall[] } {
  const calls: SpanCall[] = []

  const fakeSpan: Span = {
    setAttribute(key: string, value: unknown) {
      const current = calls[calls.length - 1]
      if (current) current.attributes[key] = value as string | number
      return this
    },
    end() {
      const current = calls[calls.length - 1]
      if (current) current.ended = true
    },
    // minimal stubs for Span interface
    setAttributes: () => fakeSpan,
    addEvent: () => fakeSpan,
    addLink: () => fakeSpan,
    setStatus: () => fakeSpan,
    updateName: () => fakeSpan,
    recordException: () => undefined,
    isRecording: () => true,
    spanContext: () => ({ traceId: "", spanId: "", traceFlags: 0 }),
  } as unknown as Span

  const fakeTracer: Tracer = {
    startSpan(name: string) {
      calls.push({ name, attributes: {}, ended: false })
      return fakeSpan
    },
    startActiveSpan: () => undefined,
  } as unknown as Tracer

  return { tracer: fakeTracer, calls }
}

// ── Setup ─────────────────────────────────────────────────────────────────────

let originalGetTracer: typeof trace.getTracer
let tracerCalls: SpanCall[]

beforeEach(() => {
  const { tracer, calls } = makeFakeTracer()
  tracerCalls = calls
  originalGetTracer = trace.getTracer.bind(trace)
  // Override the global getTracer
  ;(trace as { getTracer: typeof trace.getTracer }).getTracer = () => tracer
})

afterEach(() => {
  ;(trace as { getTracer: typeof trace.getTracer }).getTracer = originalGetTracer
  tracerCalls = []
})

// Import AFTER mock setup so the module's tracer() factory sees the mock.
// We use dynamic import reset via the re-import pattern below.
// Because bun caches modules, we instead call the tested function directly.

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("emitDockEvent — disabled gate", () => {
  test("emitDockEvent(false, ...) is a no-op: no startSpan called", async () => {
    const { emitDockEvent } = await import("./telemetry")
    emitDockEvent(false, "mounted", { paneURI: "ui://a", appName: "App A" })
    expect(tracerCalls).toHaveLength(0)
  })
})

describe("emitDockEvent — enabled path", () => {
  test("emitDockEvent(true, 'mounted', ...) calls startSpan with correct name", async () => {
    const { emitDockEvent } = await import("./telemetry")
    emitDockEvent(true, "mounted", { paneURI: "ui://a", appName: "App A" })
    expect(tracerCalls).toHaveLength(1)
    expect(tracerCalls[0]!.name).toBe("librecode.dock.pane.mounted")
  })

  test("span has pane.uri and pane.app_name attributes", async () => {
    const { emitDockEvent } = await import("./telemetry")
    emitDockEvent(true, "collapsed", { paneURI: "ui://b", appName: "Session Stats" })
    const span = tracerCalls[0]!
    expect(span.attributes["pane.uri"]).toBe("ui://b")
    expect(span.attributes["pane.app_name"]).toBe("Session Stats")
  })

  test("optional msSinceDockOpen is set when provided", async () => {
    const { emitDockEvent } = await import("./telemetry")
    emitDockEvent(true, "iframe_ready", { paneURI: "ui://c", appName: "C", msSinceDockOpen: 420 })
    const span = tracerCalls[0]!
    expect(span.attributes["pane.ms_since_dock_open"]).toBe(420)
  })

  test("optional msSinceDockOpen is NOT set when undefined", async () => {
    const { emitDockEvent } = await import("./telemetry")
    emitDockEvent(true, "mounted", { paneURI: "ui://d", appName: "D" })
    const span = tracerCalls[0]!
    expect(Object.keys(span.attributes)).not.toContain("pane.ms_since_dock_open")
  })

  test("optional sessionID is set when provided", async () => {
    const { emitDockEvent } = await import("./telemetry")
    emitDockEvent(true, "detached", { paneURI: "ui://e", appName: "E", sessionID: "sess-123" })
    const span = tracerCalls[0]!
    expect(span.attributes["session.id"]).toBe("sess-123")
  })

  test("optional sessionID is NOT set when undefined", async () => {
    const { emitDockEvent } = await import("./telemetry")
    emitDockEvent(true, "mounted", { paneURI: "ui://f", appName: "F" })
    const span = tracerCalls[0]!
    expect(Object.keys(span.attributes)).not.toContain("session.id")
  })

  test("span is ended after emit", async () => {
    const { emitDockEvent } = await import("./telemetry")
    emitDockEvent(true, "unmounted", { paneURI: "ui://g", appName: "G" })
    expect(tracerCalls[0]!.ended).toBe(true)
  })
})
