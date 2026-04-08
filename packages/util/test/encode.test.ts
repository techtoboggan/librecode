import { describe, expect, test } from "bun:test"
import { base64Encode, base64Decode, hash, checksum, sampledChecksum } from "../src/encode"

describe("base64Encode / base64Decode", () => {
  test("round-trips simple string", () => {
    const original = "hello world"
    expect(base64Decode(base64Encode(original))).toBe(original)
  })

  test("round-trips empty string", () => {
    expect(base64Decode(base64Encode(""))).toBe("")
  })

  test("round-trips unicode", () => {
    const original = "hello 🌍 world"
    expect(base64Decode(base64Encode(original))).toBe(original)
  })

  test("produces URL-safe output (no +, /, =)", () => {
    const encoded = base64Encode("subjects?_d=1&foo=bar")
    expect(encoded).not.toContain("+")
    expect(encoded).not.toContain("/")
    expect(encoded).not.toContain("=")
  })
})

describe("hash", () => {
  test("produces hex string for SHA-256", async () => {
    const result = await hash("hello")
    expect(result).toMatch(/^[0-9a-f]{64}$/)
  })

  test("is deterministic", async () => {
    const a = await hash("test input")
    const b = await hash("test input")
    expect(a).toBe(b)
  })

  test("different inputs produce different hashes", async () => {
    const a = await hash("input a")
    const b = await hash("input b")
    expect(a).not.toBe(b)
  })
})

describe("checksum", () => {
  test("returns undefined for empty string", () => {
    expect(checksum("")).toBeUndefined()
  })

  test("returns string for non-empty input", () => {
    const result = checksum("hello")
    expect(typeof result).toBe("string")
    expect(result!.length).toBeGreaterThan(0)
  })

  test("is deterministic", () => {
    expect(checksum("test")).toBe(checksum("test"))
  })

  test("different inputs differ", () => {
    expect(checksum("aaa")).not.toBe(checksum("bbb"))
  })
})

describe("sampledChecksum", () => {
  test("returns undefined for empty string", () => {
    expect(sampledChecksum("")).toBeUndefined()
  })

  test("delegates to checksum for small content", () => {
    const small = "hello"
    expect(sampledChecksum(small)).toBe(checksum(small))
  })

  test("returns sampled format for large content", () => {
    const large = "x".repeat(600_000)
    const result = sampledChecksum(large)
    expect(result).toBeDefined()
    // Format: "length:hash1:hash2:hash3:hash4:hash5"
    expect(result!).toContain("600000:")
    expect(result!.split(":").length).toBe(6)
  })
})
