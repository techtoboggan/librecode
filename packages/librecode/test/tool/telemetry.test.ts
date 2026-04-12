import { describe, expect, test } from "bun:test"
import { formatDuration, formatSize, withTelemetry } from "../../src/tool/telemetry"

describe("withTelemetry", () => {
  test("passes through successful results", async () => {
    const execute = async (args: { cmd: string }) => ({
      title: "ran command",
      output: `result of ${args.cmd}`,
      metadata: { preview: "result" } as Record<string, unknown>,
    })

    const wrapped = withTelemetry("bash", execute)
    const result = await wrapped({ cmd: "ls" }, { sessionID: "s1", agent: "build" })

    expect(result.title).toBe("ran command")
    expect(result.output).toBe("result of ls")
  })

  test("propagates errors", async () => {
    const execute = async () => {
      throw new Error("command failed")
    }

    // biome-ignore lint/suspicious/noExplicitAny: execute stub doesn't match full ExecuteFn signature
    const wrapped = withTelemetry("bash", execute as any)

    await expect(wrapped({}, { sessionID: "s1", agent: "build" })).rejects.toThrow("command failed")
  })

  test("preserves metadata including truncated flag", async () => {
    const execute = async () => ({
      title: "read file",
      output: "content",
      metadata: { truncated: true, preview: "content" } as Record<string, unknown>,
    })

    const wrapped = withTelemetry("read", execute)
    const result = await wrapped({}, { sessionID: "s1", agent: "build" })

    expect(result.metadata.truncated).toBe(true)
  })
})

describe("formatDuration", () => {
  test("milliseconds", () => {
    expect(formatDuration(42)).toBe("42ms")
    expect(formatDuration(999)).toBe("999ms")
  })

  test("seconds", () => {
    expect(formatDuration(1500)).toBe("1.5s")
    expect(formatDuration(30000)).toBe("30.0s")
  })

  test("minutes", () => {
    expect(formatDuration(90000)).toBe("1.5m")
  })
})

describe("formatSize", () => {
  test("bytes", () => {
    expect(formatSize(500)).toBe("500B")
  })

  test("kilobytes", () => {
    expect(formatSize(2048)).toBe("2.0KB")
  })

  test("megabytes", () => {
    expect(formatSize(1.5 * 1024 * 1024)).toBe("1.5MB")
  })
})
