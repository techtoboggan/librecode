/**
 * Pure helpers for the v0.9.46 `ui/message` AppBridge handler.
 *
 * Per ADR-005 §8 + the user's v0.9.46 decisions:
 *   * Default-deny — every ui/message goes through the permission gate.
 *   * Per-app char limit — global default (here), overridable per app
 *     via the v0.9.48 Settings → Apps pane.
 *   * Visual labeling — message metadata flags origin so the renderer
 *     can show "Posted by <appName>" badge (renderer change in v0.9.48).
 *   * No follow-up leakage — this layer just validates + summarises;
 *     the host route returns {} on success, never the model's reply.
 *
 * Lives in its own file so tests can import without dragging the
 * Solid + Kobalte stack from mcp-app-panel.tsx.
 */

/** Default per-app char limit for ui/message text content. v0.9.48 makes this overridable. */
export const DEFAULT_MCP_MESSAGE_CHAR_LIMIT = 8000

/** Shape of a single content block per MCP spec (ContentBlock). */
export type McpContentBlock =
  | { type: "text"; text: string }
  | { type: "image"; mimeType?: string; data?: string }
  | { type: "audio"; mimeType?: string; data?: string }
  | { type: "resource"; resource: { uri: string; text?: string; blob?: string; mimeType?: string } }
  | { type: "resource_link"; uri: string; name?: string; mimeType?: string }

/** Pure: extract concatenated text for char-limit + summary purposes. */
export function summarizeMessageText(content: ReadonlyArray<McpContentBlock>): string {
  const parts: string[] = []
  for (const block of content) {
    if (block.type === "text" && typeof block.text === "string") parts.push(block.text)
    else if (block.type === "resource" && typeof block.resource.text === "string") parts.push(block.resource.text)
  }
  return parts.join("\n")
}

/**
 * Pure: validate a ui/message payload against the per-app char limit.
 * Returns the discriminated result so the handler can pick the right
 * isError reason without re-doing the math.
 */
export function validateMessageContent(
  content: ReadonlyArray<McpContentBlock>,
  charLimit: number,
): { ok: true; text: string } | { ok: false; reason: string } {
  if (!Array.isArray(content) || content.length === 0) {
    return { ok: false, reason: "ui/message rejected: empty content." }
  }
  const text = summarizeMessageText(content)
  if (
    text.length === 0 &&
    !content.some((b) => b.type === "image" || b.type === "audio" || b.type === "resource_link")
  ) {
    return { ok: false, reason: "ui/message rejected: no text or media content." }
  }
  if (charLimit > 0 && text.length > charLimit) {
    return {
      ok: false,
      reason: `ui/message rejected: text exceeds the per-app char limit (${text.length} > ${charLimit}).`,
    }
  }
  return { ok: true, text }
}

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

/**
 * Build the AppBridge `onmessage` handler. POSTs to the host's
 * /session/:id/mcp-apps/message route which gates with the permission
 * system, char-limits, and triggers the model turn — without ever
 * leaking the model's follow-up back to the app (ADR-005 §8).
 *
 * Returns `{}` on success or `{isError: true}` for any failure
 * (validation, permission denial, transport, etc.). Never throws.
 */
export function createUiMessageHandler(options: {
  fetchFn: FetchLike
  baseUrl: string
  sessionID: string | undefined
  server: string
  uri: string
  charLimit?: number
}) {
  return async (params: { content: McpContentBlock[] }) => {
    if (!options.sessionID) return { isError: true }

    const limit = options.charLimit ?? DEFAULT_MCP_MESSAGE_CHAR_LIMIT
    const v = validateMessageContent(params.content ?? [], limit)
    if (!v.ok) return { isError: true }

    try {
      const url = `${options.baseUrl}/session/${options.sessionID}/mcp-apps/message`
      const res = await options.fetchFn(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ server: options.server, uri: options.uri, text: v.text }),
      })
      if (!res.ok) return { isError: true }
      const json = (await res.json()) as { ok?: true; isError?: boolean }
      if (json.isError) return { isError: true }
      return {}
    } catch {
      return { isError: true }
    }
  }
}
