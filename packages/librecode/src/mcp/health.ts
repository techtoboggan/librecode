/**
 * MCP Server Health Monitoring
 *
 * Provides periodic health checks for connected MCP servers and
 * automatic reconnection for failed/disconnected servers.
 */

import { Log } from "@/util/log"

const log = Log.create({ service: "mcp.health" })

// ── Health state tracking ──

export interface ServerHealth {
  server: string
  status: "healthy" | "unhealthy" | "reconnecting"
  lastCheck: number
  consecutiveFailures: number
  reconnectAttempts: number
  firstFailure?: number
}

// ── Monitor ──

export interface HealthMonitorOptions {
  /** Milliseconds between health checks (default: 30000) */
  interval?: number
  /** Maximum reconnect attempts before giving up (default: 5) */
  maxReconnectAttempts?: number
  /** Base delay for exponential backoff in ms (default: 5000) */
  reconnectBaseDelay?: number
  /** Function to get current server statuses */
  getStatuses: () => Record<string, { status: string; error?: string }>
  /** Function to ping a server (returns true if healthy) */
  ping: (server: string) => Promise<boolean>
  /** Function to reconnect a server */
  reconnect: (server: string) => Promise<boolean>
  /** Optional callback for health events */
  onEvent?: (event: HealthEventData) => void
}

export type HealthEventData =
  | { type: "check_failed"; server: string; error: string; consecutiveFailures: number }
  | { type: "recovered"; server: string; downtime: number }
  | { type: "reconnected"; server: string; attempt: number }
  | { type: "reconnect_failed"; server: string; attempts: number; lastError: string }

export class HealthMonitor {
  private timer: ReturnType<typeof setInterval> | undefined
  private health = new Map<string, ServerHealth>()
  private running = false

  constructor(private options: HealthMonitorOptions) {}

  static create(options: HealthMonitorOptions): HealthMonitor {
    return new HealthMonitor(options)
  }

  start(): void {
    if (this.running) return
    this.running = true
    const interval = this.options.interval ?? 30_000
    log.info("health monitor started", { interval })
    this.timer = setInterval(() => {
      this.check().catch((e) => log.error("health check cycle failed", { error: e }))
    }, interval)
  }

  stop(): void {
    if (!this.running) return
    this.running = false
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = undefined
    }
    log.info("health monitor stopped")
  }

  getHealth(): Map<string, ServerHealth> {
    return new Map(this.health)
  }

  getServerHealth(server: string): ServerHealth | undefined {
    return this.health.get(server)
  }

  private emit(event: HealthEventData): void {
    try {
      this.options.onEvent?.(event)
    } catch {}
  }

  async check(): Promise<void> {
    const statuses = this.options.getStatuses()

    for (const [server, info] of Object.entries(statuses)) {
      if (info.status === "disabled" || info.status === "needs_auth" || info.status === "needs_client_registration") {
        continue
      }

      const health = this.health.get(server) ?? {
        server,
        status: "healthy" as const,
        lastCheck: 0,
        consecutiveFailures: 0,
        reconnectAttempts: 0,
      }

      if (info.status === "connected") {
        await this.checkConnected(server, health)
      } else if (info.status === "failed") {
        await this.attemptReconnect(server, health, info.error)
      }

      health.lastCheck = Date.now()
      this.health.set(server, health)
    }
  }

  private async checkConnected(server: string, health: ServerHealth): Promise<void> {
    try {
      const ok = await this.options.ping(server)
      if (ok) {
        if (health.status === "unhealthy") {
          const downtime = health.firstFailure ? Date.now() - health.firstFailure : 0
          log.info("server recovered", { server, downtime })
          this.emit({ type: "recovered", server, downtime })
        }
        health.status = "healthy"
        health.consecutiveFailures = 0
        health.reconnectAttempts = 0
        health.firstFailure = undefined
      } else {
        this.markUnhealthy(server, health, "ping returned false")
      }
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e)
      this.markUnhealthy(server, health, error)
    }
  }

  private markUnhealthy(server: string, health: ServerHealth, error: string): void {
    health.consecutiveFailures++
    if (health.status !== "unhealthy") {
      health.firstFailure = Date.now()
    }
    health.status = "unhealthy"

    log.warn("health check failed", { server, error, consecutiveFailures: health.consecutiveFailures })
    this.emit({ type: "check_failed", server, error, consecutiveFailures: health.consecutiveFailures })
  }

  private async attemptReconnect(server: string, health: ServerHealth, error?: string): Promise<void> {
    const maxAttempts = this.options.maxReconnectAttempts ?? 5
    if (health.reconnectAttempts >= maxAttempts) return

    health.status = "reconnecting"
    health.reconnectAttempts++

    const baseDelay = this.options.reconnectBaseDelay ?? 5000
    const delay = baseDelay * 2 ** (health.reconnectAttempts - 1)
    const timeSinceLastCheck = Date.now() - health.lastCheck
    if (timeSinceLastCheck < delay) return

    log.info("attempting reconnect", { server, attempt: health.reconnectAttempts, maxAttempts })

    try {
      const ok = await this.options.reconnect(server)
      if (ok) {
        health.status = "healthy"
        health.consecutiveFailures = 0
        health.firstFailure = undefined
        log.info("reconnect successful", { server, attempt: health.reconnectAttempts })
        this.emit({ type: "reconnected", server, attempt: health.reconnectAttempts })
        health.reconnectAttempts = 0
      } else {
        this.markReconnectFailed(server, health, error ?? "reconnect returned false")
      }
    } catch (e) {
      this.markReconnectFailed(server, health, e instanceof Error ? e.message : String(e))
    }
  }

  private markReconnectFailed(server: string, health: ServerHealth, error: string): void {
    const maxAttempts = this.options.maxReconnectAttempts ?? 5
    health.status = "unhealthy"
    if (health.reconnectAttempts >= maxAttempts) {
      log.error("reconnect gave up", { server, attempts: health.reconnectAttempts, error })
      this.emit({ type: "reconnect_failed", server, attempts: health.reconnectAttempts, lastError: error })
    }
  }
}
