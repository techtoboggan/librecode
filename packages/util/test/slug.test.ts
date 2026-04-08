import { describe, expect, test } from "bun:test"
import { Slug } from "../src/slug"

describe("Slug.create", () => {
  test("returns adjective-noun format", () => {
    const slug = Slug.create()
    expect(slug).toMatch(/^[a-z]+-[a-z]+$/)
  })

  test("generates different slugs", () => {
    const slugs = new Set(Array.from({ length: 50 }, () => Slug.create()))
    // With 29 * 31 = 899 combos, 50 samples should have high uniqueness
    expect(slugs.size).toBeGreaterThan(30)
  })
})
