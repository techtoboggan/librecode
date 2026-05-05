/**
 * SSE event forwarding from the host into MCP App iframes.
 *
 * The host's SSE stream carries far more events than apps need; this
 * module owns the small allowlist of types that get forwarded as
 * postMessage frames into iframes.
 */

/**
 * Event types forwarded from the host SSE stream into the iframe via postMessage.
 *   - activity.updated        (for the FS Activity Graph)
 *   - message.part.updated    (for Session Stats token/cost tracking)
 *   - message.part.delta      (for streaming indicators)
 *   - session.status          (for busy/idle signals)
 */
export const FORWARDED_EVENT_TYPES = new Set([
  "activity.updated",
  "message.part.updated",
  "message.part.delta",
  "session.status",
])

/** Pure predicate — is this event eligible to be forwarded into an MCP app iframe? */
export function shouldForwardEvent(event: unknown): boolean {
  if (!event || typeof event !== "object" || !("type" in event)) return false
  return FORWARDED_EVENT_TYPES.has((event as { type: unknown }).type as string)
}

type PostTarget = { postMessage: (message: unknown, targetOrigin: string) => void } | null | undefined

/**
 * Wire a global-event listener to a postMessage target. Returns an unsubscribe.
 * Extracted from the hook so the forwarding logic is unit-testable without
 * Solid reactivity or a full iframe.
 */
export function createEventForwarder(
  listen: (cb: (e: { name: string; details: unknown }) => void) => () => void,
  getTarget: () => PostTarget,
): () => void {
  return listen((e) => {
    const event = e.details
    if (!shouldForwardEvent(event)) return
    try {
      getTarget()?.postMessage(event, "*")
    } catch {
      // iframe may be detached during re-render
    }
  })
}
