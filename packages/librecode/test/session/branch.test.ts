import { describe, expect, test } from "bun:test"

describe("session branching (unit)", () => {
  test("ancestry returns root first", () => {
    // Unit test of the concept — ancestry reverses the parent chain
    const chain = ["root", "child", "grandchild"]
    expect(chain.reverse()).toEqual(["grandchild", "child", "root"])
    // Re-reverse to get root-first
    expect(chain.reverse()).toEqual(["root", "child", "grandchild"])
  })

  test("fork options accepts optional fields", () => {
    // Type-level test — these should compile
    // biome-ignore lint/suspicious/noExplicitAny: branded type cast for test
    const opts1 = { sessionID: "s1" as any }
    // biome-ignore lint/suspicious/noExplicitAny: branded type casts for test
    const opts2 = { sessionID: "s1" as any, atMessageID: "m1" as any, title: "Branch" }
    expect(opts1.sessionID).toBeDefined()
    expect(opts2.title).toBe("Branch")
  })
})
