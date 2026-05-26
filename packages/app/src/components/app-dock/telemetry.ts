import { trace } from "@opentelemetry/api"

/**
 * Dock-pane lifecycle telemetry — Phase 50.
 *
 * Emits OTel spans (consumed by the Phoenix Arize exporter wired in
 * Phase 35). All exports check the runtime-configured enabled flag
 * before emitting; callers don't need to guard.
 *
 * Event names use the `librecode.dock.pane.*` convention to match
 * the existing `librecode.*` namespace used by LLM spans.
 */

export type DockTelemetryEvent =
  | "mounted"
  | "unmounted"
  | "iframe_ready"
  | "collapsed"
  | "expanded"
  | "detached"
  | "reattached"

export interface DockTelemetryPayload {
  paneURI: string
  appName: string
  msSinceDockOpen?: number
  sessionID?: string
}

/**
 * Lazily-resolved tracer — only created when the first event fires.
 * Safe to call even when telemetry is disabled (the no-op tracer
 * returns a no-op span).
 */
function tracer() {
  return trace.getTracer("librecode.app-dock", "1.0.0")
}

/**
 * Emit a single dock-pane lifecycle event. No-ops if `enabled` is false.
 *
 * The `enabled` flag is read from `sync.data.config?.telemetry?.phoenix?.enabled`
 * at the call site — the telemetry layer itself doesn't reach into the
 * config tree to keep this module dependency-free.
 */
export function emitDockEvent(enabled: boolean, event: DockTelemetryEvent, payload: DockTelemetryPayload): void {
  if (!enabled) return
  const span = tracer().startSpan(`librecode.dock.pane.${event}`)
  span.setAttribute("pane.uri", payload.paneURI)
  span.setAttribute("pane.app_name", payload.appName)
  if (payload.msSinceDockOpen !== undefined) {
    span.setAttribute("pane.ms_since_dock_open", payload.msSinceDockOpen)
  }
  if (payload.sessionID) {
    span.setAttribute("session.id", payload.sessionID)
  }
  span.end()
}
