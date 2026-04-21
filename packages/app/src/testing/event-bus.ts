/**
 * Testing hook that exposes a controlled entry point to the global SDK
 * event emitter. Real SSE events are hard to inject in an e2e — this hook
 * gives Playwright specs a way to push synthetic bus events through the
 * exact same code path (emitter.emit → mcp-app-panel forwarder →
 * iframe.postMessage), so the end-to-end forwarding chain can be
 * exercised without a live backend tool run.
 *
 * Activation: tests call
 *   window.__librecode_e2e = { ...win.__librecode_e2e, eventBus: { enabled: true } }
 * before the app initializes. The provider below registers the emit
 * shim on window only when that flag is set.
 */

export type EventBusEmitFn = (directory: string, payload: { type: string } & Record<string, unknown>) => void

export type EventBusProbe = {
  enabled?: boolean
  /** Populated by the app at runtime when `enabled: true`. */
  emit?: EventBusEmitFn
}

type Win = Window & {
  __librecode_e2e?: {
    eventBus?: EventBusProbe
  }
}

/** Returns the probe state if tests opted in; otherwise undefined. */
export function eventBusProbeEnabled(): boolean {
  if (typeof window === "undefined") return false
  return (window as Win).__librecode_e2e?.eventBus?.enabled === true
}

/** Writes the emit shim onto window when the probe is enabled. No-op otherwise. */
export function setEventBusProbe(emit: EventBusEmitFn): void {
  if (!eventBusProbeEnabled()) return
  const win = window as Win
  if (!win.__librecode_e2e) win.__librecode_e2e = {}
  if (!win.__librecode_e2e.eventBus) win.__librecode_e2e.eventBus = { enabled: true }
  win.__librecode_e2e.eventBus.emit = emit
}
