import { afterEach, beforeEach, describe, expect, test } from "bun:test"

// A02 — Verify the AuthStorage abstraction works end-to-end.
//
// We force the file backend (LIBRECODE_AUTH_STORAGE=file) in these tests
// because the CI runner may not have a Secret Service, and we want
// deterministic behavior regardless of the local keyring state.

describe("AuthStorage (file backend)", () => {
  const prev = process.env.LIBRECODE_AUTH_STORAGE
  beforeEach(() => {
    process.env.LIBRECODE_AUTH_STORAGE = "file"
  })
  afterEach(() => {
    if (prev === undefined) delete process.env.LIBRECODE_AUTH_STORAGE
    else process.env.LIBRECODE_AUTH_STORAGE = prev
  })

  test("round-trip write and read through the service facade", async () => {
    const { Auth } = await import("../../src/auth")
    const { _resetAuthStorageCache } = await import("../../src/auth/service")
    _resetAuthStorageCache()

    await Auth.set("test-provider", { type: "api", key: "sk-fake-123" })
    const retrieved = await Auth.get("test-provider")
    expect(retrieved).toEqual({ type: "api", key: "sk-fake-123" })

    const all = await Auth.all()
    expect(Object.keys(all)).toContain("test-provider")

    await Auth.remove("test-provider")
    const afterRemove = await Auth.get("test-provider")
    expect(afterRemove).toBeUndefined()
  })

  test("OAuth entries survive round-trip", async () => {
    const { Auth } = await import("../../src/auth")
    const { _resetAuthStorageCache } = await import("../../src/auth/service")
    _resetAuthStorageCache()

    const entry = {
      type: "oauth" as const,
      refresh: "refresh-abc",
      access: "access-xyz",
      expires: Date.now() + 3600_000,
      accountId: "acct-1",
    }
    await Auth.set("oauth-provider", entry)
    const got = await Auth.get("oauth-provider")
    expect(got).toEqual(entry)
    await Auth.remove("oauth-provider")
  })

  test("trailing slash normalization on provider key", async () => {
    const { Auth } = await import("../../src/auth")
    const { _resetAuthStorageCache } = await import("../../src/auth/service")
    _resetAuthStorageCache()

    await Auth.set("https://example.com/", { type: "api", key: "k1" })
    // Normalised key has no trailing slash
    const stored = await Auth.get("https://example.com")
    expect(stored).toEqual({ type: "api", key: "k1" })
    await Auth.remove("https://example.com")
  })
})

describe("storage factory platform defaults", () => {
  test("respects LIBRECODE_AUTH_STORAGE=file", async () => {
    process.env.LIBRECODE_AUTH_STORAGE = "file"
    const { createAuthStorage } = await import("../../src/auth/storage")
    const storage = await createAuthStorage()
    expect(storage.kind).toBe("file")
  })
  // NB: there is no "keychain backend probe" test here because the
  // @napi-rs/keyring native module has known compatibility issues when
  // loaded under Bun's test runner (segfault on the JSC process).
  // Production runs under the compiled Bun binary via runtime --bun;
  // CI covers keychain init via the end-to-end desktop build.
})
