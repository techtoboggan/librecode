import { describe, expect, test } from "bun:test"
import { getFilename, getDirectory, getFileExtension, getFilenameTruncated, truncateMiddle } from "../src/path"

describe("getFilename", () => {
  test("extracts filename from unix path", () => {
    expect(getFilename("/home/user/file.ts")).toBe("file.ts")
  })

  test("extracts filename from windows path", () => {
    expect(getFilename("C:\\Users\\file.ts")).toBe("file.ts")
  })

  test("strips trailing slashes", () => {
    expect(getFilename("/home/user/dir/")).toBe("dir")
  })

  test("returns empty string for undefined", () => {
    expect(getFilename(undefined)).toBe("")
  })

  test("returns empty string for empty string", () => {
    expect(getFilename("")).toBe("")
  })

  test("returns filename for bare filename", () => {
    expect(getFilename("file.ts")).toBe("file.ts")
  })
})

describe("getDirectory", () => {
  test("extracts directory from unix path", () => {
    expect(getDirectory("/home/user/file.ts")).toBe("/home/user/")
  })

  test("returns empty string for undefined", () => {
    expect(getDirectory(undefined)).toBe("")
  })
})

describe("getFileExtension", () => {
  test("extracts extension", () => {
    expect(getFileExtension("file.ts")).toBe("ts")
  })

  test("extracts last extension for multiple dots", () => {
    expect(getFileExtension("file.test.ts")).toBe("ts")
  })

  test("returns empty string for undefined", () => {
    expect(getFileExtension(undefined)).toBe("")
  })
})

describe("getFilenameTruncated", () => {
  test("returns full filename if short enough", () => {
    expect(getFilenameTruncated("/path/short.ts", 20)).toBe("short.ts")
  })

  test("truncates long filenames preserving extension", () => {
    const result = getFilenameTruncated("/path/very-long-filename-here.ts", 15)
    expect(result.length).toBeLessThanOrEqual(15)
    expect(result).toEndWith(".ts")
    expect(result).toContain("\u2026") // ellipsis
  })
})

describe("truncateMiddle", () => {
  test("returns full text if short enough", () => {
    expect(truncateMiddle("short", 20)).toBe("short")
  })

  test("truncates in the middle", () => {
    const result = truncateMiddle("abcdefghijklmnop", 10)
    expect(result.length).toBeLessThanOrEqual(10)
    expect(result).toContain("\u2026")
    expect(result).toStartWith("a")
    expect(result).toEndWith("p")
  })
})
