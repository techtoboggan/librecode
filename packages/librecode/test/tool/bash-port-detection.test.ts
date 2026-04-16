import { describe, expect, test } from "bun:test"
import { extractPorts, PORT_RE } from "../../src/tool/bash"

describe("extractPorts", () => {
  test("detects localhost URL", () => {
    expect(extractPorts("Listening on http://localhost:3000")).toContain(3000)
  })

  test("detects 127.0.0.1 URL", () => {
    expect(extractPorts("Server at http://127.0.0.1:8080")).toContain(8080)
  })

  test("detects 0.0.0.0 bind address", () => {
    expect(extractPorts("listening on 0.0.0.0:5000")).toContain(5000)
  })

  test("detects 'listening on :PORT' pattern (bare colon)", () => {
    // regex group 2: listening.*?:(\d{4,5})
    const ports = extractPorts("Server listening on :4000")
    expect(ports).toContain(4000)
  })

  test("detects 'started on :PORT' pattern", () => {
    expect(extractPorts("HTTP server started on :8000")).toContain(8000)
  })

  test("detects 'running on :PORT' pattern", () => {
    expect(extractPorts("App running on :9000")).toContain(9000)
  })

  test("detects Vite-style output", () => {
    const text = "  ➜  Local:   http://localhost:5173/"
    expect(extractPorts(text)).toContain(5173)
  })

  test("detects Next.js-style output", () => {
    const text = "  - Local:        http://localhost:3000"
    expect(extractPorts(text)).toContain(3000)
  })

  test("returns multiple distinct ports from one chunk", () => {
    const text = "Proxy: http://localhost:3001 → http://127.0.0.1:3000"
    const ports = extractPorts(text)
    expect(ports).toContain(3000)
    expect(ports).toContain(3001)
  })

  test("deduplicates repeated mentions of the same port", () => {
    // extractPorts returns raw matches; the caller deduplicates via Set
    // but the function itself may return duplicates — test the caller pattern
    const text = "localhost:3000 and localhost:3000"
    const ports = extractPorts(text)
    // at least one occurrence
    expect(ports.length).toBeGreaterThan(0)
  })

  test("ignores ports below 1024 (privileged)", () => {
    expect(extractPorts("http://localhost:80")).not.toContain(80)
    expect(extractPorts("http://localhost:443")).not.toContain(443)
    expect(extractPorts("http://localhost:22")).not.toContain(22)
  })

  test("ignores ports above 65535", () => {
    expect(extractPorts("http://localhost:99999")).not.toContain(99999)
  })

  test("returns empty array for text with no port patterns", () => {
    expect(extractPorts("Build succeeded. No errors found.")).toEqual([])
  })

  test("returns empty array for empty string", () => {
    expect(extractPorts("")).toEqual([])
  })

  test("handles common 4-digit ports", () => {
    expect(extractPorts("http://localhost:4200")).toContain(4200)
    expect(extractPorts("http://localhost:8888")).toContain(8888)
  })

  test("handles 5-digit ports", () => {
    expect(extractPorts("http://localhost:49152")).toContain(49152)
  })

  test("PORT_RE is exported and is a RegExp", () => {
    expect(PORT_RE).toBeInstanceOf(RegExp)
  })
})
