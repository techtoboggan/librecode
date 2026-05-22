/**
 * Phase 39 / upstream #22660 — regression test for tail-keeping truncation.
 *
 * Pre-fix behavior kept the first MAX_METADATA_LENGTH characters and
 * dropped the rest. That meant the agent saw the head of a build log
 * but not the failure summary or stack trace at the end, which is
 * usually where the actionable information lives.
 */
import { describe, expect, test } from "bun:test"
import { _BASH_MAX_METADATA_LENGTH, truncateOutput } from "../../src/tool/bash"

describe("truncateOutput", () => {
  test("short output is returned as-is", () => {
    expect(truncateOutput("hello world")).toBe("hello world")
  })

  test("output exactly at the limit is unchanged", () => {
    const exact = "x".repeat(_BASH_MAX_METADATA_LENGTH)
    expect(truncateOutput(exact)).toBe(exact)
  })

  test("output past the limit keeps the TAIL (not the head)", () => {
    // Mark the start vs end so we can prove which half survives.
    const head = "BEGIN-MARKER\n" + "h".repeat(_BASH_MAX_METADATA_LENGTH)
    const tail = "t".repeat(_BASH_MAX_METADATA_LENGTH) + "\nEND-MARKER"
    const result = truncateOutput(head + tail)
    expect(result.startsWith("...\n\n")).toBe(true)
    expect(result).toContain("END-MARKER")
    expect(result).not.toContain("BEGIN-MARKER")
  })

  test("result length is bounded (limit + truncation prefix)", () => {
    const huge = "x".repeat(_BASH_MAX_METADATA_LENGTH * 10)
    const result = truncateOutput(huge)
    // "...\n\n" prefix + at most MAX chars from the tail.
    expect(result.length).toBeLessThanOrEqual(_BASH_MAX_METADATA_LENGTH + 5)
    expect(result.startsWith("...")).toBe(true)
  })

  test("error-summary-at-the-end case (the common real-world failure mode)", () => {
    // Simulates a long build log where the actionable failure appears
    // on the last line. Pre-fix, the agent would never see this line.
    const log = Array.from({ length: 5000 }, (_, i) => `[build] step ${i} OK`).join("\n")
    const failure = "\nERROR: tsc exited with code 2"
    const result = truncateOutput(log + failure)
    expect(result).toContain("ERROR: tsc exited with code 2")
  })
})
