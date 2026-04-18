// A02 (Cryptographic Failures) / A09 (Logging Failures) — Scrub
// likely-secret content from log payloads before they hit disk. Two
// passes:
//   1. Known secret value patterns (github_pat_*, ghp_*, sk-*, JWT, AWS
//      access key IDs, etc.) are replaced inside string values regardless
//      of the key name.
//   2. Values under keys whose name matches the secret-keyword pattern
//      (authorization, token, secret, api_key, …) are replaced wholesale.
//
// This is not a substitute for explicit `"[REDACTED]"` at the call site —
// it's the safety net for accidental object-dumps like log.error("failed",
// { request }) where request.headers carries an Authorization header.

const SECRET_VALUE_PATTERNS: Array<[RegExp, string]> = [
  // GitHub tokens — personal access tokens and granular tokens
  [/ghp_[A-Za-z0-9]{30,}/g, "[REDACTED:github-token]"],
  [/github_pat_[A-Za-z0-9_]{30,}/g, "[REDACTED:github-token]"],
  [/ghs_[A-Za-z0-9]{30,}/g, "[REDACTED:github-token]"],
  [/gho_[A-Za-z0-9]{30,}/g, "[REDACTED:github-token]"],
  // OpenAI / Anthropic / generic "sk-" keys — require at least 30 more
  // chars after the prefix to avoid false positives on prose like
  // "sk-based language"
  [/sk-[A-Za-z0-9_-]{30,}/g, "[REDACTED:api-key]"],
  // AWS access key IDs
  [/AKIA[0-9A-Z]{16}/g, "[REDACTED:aws-key]"],
  // JWT (eyJ... . eyJ... . <signature>)
  [/eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_.-]{10,}/g, "[REDACTED:jwt]"],
]

const SECRET_KEY_NAMES = /^(authorization|auth|token|secret|api[-_]?key|access[-_]?key|access[-_]?token|refresh[-_]?token|bearer|session|password|passwd|credentials?|x-api-key|x-auth-token)$/i

export function redactSecretsInString(input: string): string {
  let out = input
  for (const [pattern, replacement] of SECRET_VALUE_PATTERNS) {
    out = out.replace(pattern, replacement)
  }
  return out
}

/**
 * Walk an object and return a copy with secret-ish values redacted.
 * Handles nested objects, arrays, and self-references (cycle detection
 * via a WeakSet).
 */
export function redactSecrets(input: Record<string, unknown> | null | undefined): Record<string, unknown> {
  if (!input) return {}
  const seen = new WeakSet<object>()
  return walk(input, seen) as Record<string, unknown>
}

function walk(value: unknown, seen: WeakSet<object>): unknown {
  if (value === null || value === undefined) return value
  if (typeof value === "string") return redactSecretsInString(value)
  if (typeof value !== "object") return value
  if (seen.has(value as object)) return "[REDACTED:circular]"
  seen.add(value as object)
  if (Array.isArray(value)) return value.map((item) => walk(item, seen))
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (SECRET_KEY_NAMES.test(k)) {
      out[k] = "[REDACTED:secret-key]"
    } else {
      out[k] = walk(v, seen)
    }
  }
  return out
}
