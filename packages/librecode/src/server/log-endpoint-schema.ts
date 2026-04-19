import { z } from "zod"

// A04/A09 — /log accepts user-supplied entries. The schema and sanitizer
// here bound the damage an authenticated-but-hostile caller can do:
//
//   * service name limited to 64 chars of [a-z0-9._-]. Control chars would
//     let a caller forge log lines (newline → "fake [INFO] line").
//   * message capped at 8 KB. Prevents a single request from writing MBs.
//   * extra object sanitized to ≤16 KB serialized. Replaces with a marker
//     if a caller sends a deeply nested / huge payload.

const MAX_SERVICE_CHARS = 64
const MAX_MESSAGE_BYTES = 8 * 1024 // 8 KB
const MAX_EXTRA_BYTES = 16 * 1024 // 16 KB
const SERVICE_NAME_RE = /^[a-z0-9._-]+$/i

export const LogPayload = z.object({
  service: z.string().min(1).max(MAX_SERVICE_CHARS).regex(SERVICE_NAME_RE, "service name must match [a-z0-9._-]+"),
  level: z.enum(["debug", "info", "error", "warn"]),
  message: z.string().max(MAX_MESSAGE_BYTES, `message exceeds ${MAX_MESSAGE_BYTES} bytes`),
  extra: z.record(z.string(), z.any()).optional(),
})

export type LogPayload = z.infer<typeof LogPayload>

/**
 * Sanitize the `extra` object so it can't blow up the log file with
 * megabytes of attacker-controlled data. If serialization exceeds
 * MAX_EXTRA_BYTES, replace with a marker noting the truncation.
 */
export function sanitizeLogExtra(extra: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!extra) return undefined
  let serialized: string
  try {
    serialized = JSON.stringify(extra)
  } catch {
    return { _error: "extra not serializable" }
  }
  if (serialized.length <= MAX_EXTRA_BYTES) return extra
  return { _truncated: true, _originalBytes: serialized.length, _preview: serialized.slice(0, 200) }
}
