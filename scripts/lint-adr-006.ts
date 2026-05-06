#!/usr/bin/env bun
/**
 * Phase 38 — static enforcement of ADR-006 (Suspense / startTransition pattern).
 *
 * The rule, in plain English: in components that render under the session
 * route's `<Suspense>` boundary, a `createResource` whose source key reads a
 * signal that an event handler in the same component WRITES will flash the
 * fallback (a blank pane) on every interaction. Four incidents (v0.9.54
 * tab switch, v0.9.58 pin-add, v0.9.70 + v0.9.71 start-menu open) were
 * caused by exactly this shape; ADR-006 codified the pattern and CLAUDE.md
 * explains it. Each one cost 2–3 patch versions to actually land.
 *
 * Cross-function dataflow ("source fn reads signal that event handler
 * writes") isn't expressible in Biome's GritQL plugins — they pattern-match
 * the AST, not control flow. Instead this script implements the next-best
 * thing: a JUSTIFICATION rule. In the danger-zone files, every
 * `createResource` call must carry an `adr-006:` comment on the line
 * immediately above (or trailing on the same line) explaining what the
 * source key is and why it's safe. Forces the conscious decision the
 * pattern requires; trivial to satisfy when correct, hard to forget when
 * wrong.
 *
 * Suppression: add `// adr-006: <reason>` directly above the call.
 *
 * Usage:
 *   bun run scripts/lint-adr-006.ts          # exits 1 on any violation
 *   bun run scripts/lint-adr-006.ts --check  # same; CI-friendly alias
 */

import path from "node:path"
import process from "node:process"
import ts from "typescript"

const REPO = path.resolve(import.meta.dir, "..")

/**
 * Files in the historical hot zone. Each one renders under the session
 * route's Suspense boundary and has either caused an ADR-006 incident
 * before or contains a `createResource` that could.
 *
 * Add new files here when they enter the same boundary. The cost of a
 * false positive is one extra justification comment; the cost of a false
 * negative is another flash bug + 2-3 patch releases to fix it.
 */
const DANGER_ZONE_GLOBS: ReadonlyArray<string> = [
  "packages/app/src/pages/session/**/*.tsx",
  "packages/app/src/components/start-menu.tsx",
  "packages/app/src/components/mcp-app-panel.tsx",
  "packages/app/src/components/mcp-app-panel/**/*.{ts,tsx}",
  "packages/app/src/context/pinned-apps.tsx",
]

interface Violation {
  file: string
  line: number
  column: number
  message: string
}

async function findFiles(): Promise<string[]> {
  const out = new Set<string>()
  for (const pattern of DANGER_ZONE_GLOBS) {
    const glob = new Bun.Glob(pattern)
    for await (const file of glob.scan({ cwd: REPO, absolute: true })) {
      out.add(file)
    }
  }
  return [...out].sort()
}

/** Walks an AST, returning every `createResource(...)` CallExpression node. */
function findCreateResourceCalls(source: ts.SourceFile): ts.CallExpression[] {
  const collected: ts.CallExpression[] = []
  function walk(node: ts.Node): void {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.escapedText === "createResource"
    ) {
      collected.push(node)
    }
    ts.forEachChild(node, walk)
  }
  walk(source)
  return collected
}

const ANNOTATION = /\/\/[^\n]*\badr-006\b[^\n]*/i

/** Walk up to the enclosing statement so we read leading comments on the FULL
 * `const [x] = createResource(...)` form, not just the comments between `=`
 * and `createResource` (of which there are usually none). */
function enclosingStatement(node: ts.Node): ts.Node {
  let cursor: ts.Node = node
  while (cursor.parent && !ts.isStatement(cursor)) cursor = cursor.parent
  return cursor
}

/**
 * Returns true if there is an `adr-006:` comment anywhere in the leading
 * comment block immediately preceding the enclosing statement, OR trailing
 * on the call itself, OR on the same line as the call. Multi-line `//`
 * blocks above the statement count as one continuous block — that's how
 * developers naturally write justification comments.
 */
function hasAnnotation(source: ts.SourceFile, call: ts.CallExpression, fullText: string): boolean {
  const stmt = enclosingStatement(call)
  const leading = ts.getLeadingCommentRanges(fullText, stmt.getFullStart()) ?? []
  const trailing = ts.getTrailingCommentRanges(fullText, call.getEnd()) ?? []
  for (const range of [...leading, ...trailing]) {
    const slice = fullText.slice(range.pos, range.end)
    if (ANNOTATION.test(slice)) return true
  }
  // The line containing the call itself — covers
  // `const [x] = createResource(...) // adr-006: ...` patterns where the
  // trailing comment is attached to a sibling node by the scanner.
  const { line: callLine } = source.getLineAndCharacterOfPosition(call.getStart())
  const lineStarts = source.getLineStarts()
  const lineStart = lineStarts[callLine]
  const lineEnd = callLine + 1 < lineStarts.length ? lineStarts[callLine + 1] : fullText.length
  const lineText = fullText.slice(lineStart, lineEnd)
  return ANNOTATION.test(lineText)
}

async function checkFile(file: string): Promise<Violation[]> {
  const text = await Bun.file(file).text()
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const violations: Violation[] = []
  for (const call of findCreateResourceCalls(source)) {
    if (hasAnnotation(source, call, text)) continue
    const { line, character } = source.getLineAndCharacterOfPosition(call.getStart())
    violations.push({
      file: path.relative(REPO, file),
      line: line + 1,
      column: character + 1,
      message: "createResource without `adr-006:` justification (Phase 38 / ADR-006)",
    })
  }
  return violations
}

async function main(): Promise<void> {
  const files = await findFiles()
  const all: Violation[] = []
  for (const file of files) {
    all.push(...(await checkFile(file)))
  }
  if (all.length === 0) {
    console.log(`✓ adr-006: ${files.length} files clean`)
    process.exit(0)
  }
  console.error(`✗ adr-006: ${all.length} unjustified createResource call${all.length === 1 ? "" : "s"}`)
  for (const v of all) {
    console.error(`  ${v.file}:${v.line}:${v.column}: ${v.message}`)
  }
  console.error("")
  console.error("Each `createResource` in a session-route component must carry an inline")
  console.error("`// adr-006: <reason>` comment explaining what the source key is and why it")
  console.error("is stable across event-handler-driven state changes. See ADR-006 + CLAUDE.md.")
  process.exit(1)
}

await main()
