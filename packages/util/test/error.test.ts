import { describe, expect, test } from "bun:test"
import { NamedError } from "../src/error"
import z from "zod"

describe("NamedError", () => {
  const TestError = NamedError.create(
    "TestError",
    z.object({
      code: z.number(),
      message: z.string(),
    }),
  )

  test("creates an error with name and data", () => {
    const err = new TestError({ code: 404, message: "not found" })
    expect(err.name).toBe("TestError")
    expect(err.data.code).toBe(404)
    expect(err.data.message).toBe("not found")
    expect(err).toBeInstanceOf(Error)
    expect(err).toBeInstanceOf(NamedError)
  })

  test("isInstance correctly identifies errors", () => {
    const err = new TestError({ code: 500, message: "fail" })
    expect(TestError.isInstance(err)).toBe(true)
    expect(TestError.isInstance({ name: "TestError" })).toBe(true)
    expect(TestError.isInstance({ name: "OtherError" })).toBe(false)
    // Note: isInstance(null) throws — upstream bug, null not guarded in `"name" in input`
    expect(TestError.isInstance(undefined)).toBe(false)
  })

  test("toObject serializes correctly", () => {
    const err = new TestError({ code: 400, message: "bad" })
    expect(err.toObject()).toEqual({
      name: "TestError",
      data: { code: 400, message: "bad" },
    })
  })

  test("has a Schema static property", () => {
    expect(TestError.Schema).toBeDefined()
  })

  test("supports error cause chain", () => {
    const cause = new Error("original")
    const err = new TestError({ code: 500, message: "wrapped" }, { cause })
    expect(err.cause).toBe(cause)
  })

  test("Unknown error works", () => {
    const err = new NamedError.Unknown({ message: "something broke" })
    expect(err.name).toBe("UnknownError")
    expect(err.data.message).toBe("something broke")
  })
})
