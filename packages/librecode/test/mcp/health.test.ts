import { beforeEach, describe, expect, test } from "bun:test"
import { type HealthEventData, HealthMonitor } from "../../src/mcp/health"

describe("HealthMonitor", () => {
  let statuses: Record<string, { status: string; error?: string }>
  let pingResults: Record<string, boolean>
  let reconnectResults: Record<string, boolean>
  let events: HealthEventData[]

  beforeEach(() => {
    statuses = {}
    pingResults = {}
    reconnectResults = {}
    events = []
  })

  function createMonitor(overrides?: Partial<Parameters<typeof HealthMonitor.create>[0]>) {
    return HealthMonitor.create({
      interval: 100,
      maxReconnectAttempts: 3,
      reconnectBaseDelay: 10,
      getStatuses: () => statuses,
      ping: async (server) => pingResults[server] ?? true,
      reconnect: async (server) => reconnectResults[server] ?? false,
      onEvent: (e) => events.push(e),
      ...overrides,
    })
  }

  test("marks healthy servers after successful ping", async () => {
    statuses = { "test-server": { status: "connected" } }
    pingResults = { "test-server": true }

    const monitor = createMonitor()
    await monitor.check()

    const health = monitor.getServerHealth("test-server")
    expect(health?.status).toBe("healthy")
    expect(health?.consecutiveFailures).toBe(0)
  })

  test("marks unhealthy after failed ping", async () => {
    statuses = { "test-server": { status: "connected" } }
    pingResults = { "test-server": false }

    const monitor = createMonitor()
    await monitor.check()

    const health = monitor.getServerHealth("test-server")
    expect(health?.status).toBe("unhealthy")
    expect(health?.consecutiveFailures).toBe(1)
    expect(events).toHaveLength(1)
    expect(events[0].type).toBe("check_failed")
  })

  test("tracks consecutive failures", async () => {
    statuses = { "test-server": { status: "connected" } }
    pingResults = { "test-server": false }

    const monitor = createMonitor()
    await monitor.check()
    await monitor.check()
    await monitor.check()

    const health = monitor.getServerHealth("test-server")
    expect(health?.consecutiveFailures).toBe(3)
    expect(events).toHaveLength(3)
  })

  test("recovers after failure then success", async () => {
    statuses = { "test-server": { status: "connected" } }
    pingResults = { "test-server": false }

    const monitor = createMonitor()
    await monitor.check()
    expect(monitor.getServerHealth("test-server")?.status).toBe("unhealthy")

    pingResults["test-server"] = true
    await monitor.check()
    expect(monitor.getServerHealth("test-server")?.status).toBe("healthy")
    expect(monitor.getServerHealth("test-server")?.consecutiveFailures).toBe(0)

    const recovered = events.find((e) => e.type === "recovered")
    expect(recovered).toBeDefined()
  })

  test("skips disabled and needs_auth servers", async () => {
    statuses = {
      disabled: { status: "disabled" },
      auth: { status: "needs_auth" },
      connected: { status: "connected" },
    }
    pingResults = { connected: true }

    const monitor = createMonitor()
    await monitor.check()

    expect(monitor.getServerHealth("disabled")).toBeUndefined()
    expect(monitor.getServerHealth("auth")).toBeUndefined()
    expect(monitor.getServerHealth("connected")?.status).toBe("healthy")
  })

  test("attempts reconnect for failed servers", async () => {
    statuses = { "test-server": { status: "failed", error: "connection lost" } }
    reconnectResults = { "test-server": true }

    const monitor = createMonitor()
    await monitor.check()

    const health = monitor.getServerHealth("test-server")
    expect(health?.status).toBe("healthy")
    expect(health?.reconnectAttempts).toBe(0) // reset after success

    const reconnected = events.find((e) => e.type === "reconnected")
    expect(reconnected).toBeDefined()
  })

  test("getHealth returns all tracked servers", async () => {
    statuses = {
      a: { status: "connected" },
      b: { status: "connected" },
    }

    const monitor = createMonitor()
    await monitor.check()

    const all = monitor.getHealth()
    expect(all.size).toBe(2)
    expect(all.has("a")).toBe(true)
    expect(all.has("b")).toBe(true)
  })

  test("handles ping exceptions gracefully", async () => {
    statuses = { "test-server": { status: "connected" } }

    const monitor = createMonitor({
      ping: async () => {
        throw new Error("network failure")
      },
    })
    await monitor.check()

    const health = monitor.getServerHealth("test-server")
    expect(health?.status).toBe("unhealthy")
    expect(health?.consecutiveFailures).toBe(1)
  })
})
