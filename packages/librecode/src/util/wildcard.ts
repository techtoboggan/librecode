import { pipe, sortBy } from "remeda"

function wildcardMatch(str: string, pattern: string) {
  if (str) str = str.replaceAll("\\", "/")
  if (pattern) pattern = pattern.replaceAll("\\", "/")
  let escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&") // escape special regex chars
    .replace(/\*/g, ".*") // * becomes .*
    .replace(/\?/g, ".") // ? becomes .

  // If pattern ends with " *" (space + wildcard), make the trailing part optional
  // This allows "ls *" to match both "ls" and "ls -la"
  if (escaped.endsWith(" .*")) {
    escaped = `${escaped.slice(0, -3)}( .*)?`
  }

  const flags = process.platform === "win32" ? "si" : "s"
  return new RegExp(`^${escaped}$`, flags).test(str)
}

function wildcardAll(input: string, patterns: Record<string, unknown>): unknown {
  const sorted = pipe(patterns, Object.entries, sortBy([([key]) => key.length, "asc"], [([key]) => key, "asc"]))
  let result: unknown
  for (const [pattern, value] of sorted) {
    if (wildcardMatch(input, pattern)) {
      result = value
    }
  }
  return result
}

function wildcardAllStructured(input: { head: string; tail: string[] }, patterns: Record<string, unknown>): unknown {
  const sorted = pipe(patterns, Object.entries, sortBy([([key]) => key.length, "asc"], [([key]) => key, "asc"]))
  let result: unknown
  for (const [pattern, value] of sorted) {
    const parts = pattern.split(/\s+/)
    if (!wildcardMatch(input.head, parts[0])) continue
    if (parts.length === 1 || wildcardMatchSequence(input.tail, parts.slice(1))) {
      result = value
    }
  }
  return result
}

function wildcardMatchSequence(items: string[], patterns: string[]): boolean {
  if (patterns.length === 0) return true
  const [pattern, ...rest] = patterns
  if (pattern === "*") return wildcardMatchSequence(items, rest)
  for (let i = 0; i < items.length; i++) {
    if (wildcardMatch(items[i], pattern) && wildcardMatchSequence(items.slice(i + 1), rest)) {
      return true
    }
  }
  return false
}

export const Wildcard = {
  match: wildcardMatch,
  all: wildcardAll,
  allStructured: wildcardAllStructured,
} as const
