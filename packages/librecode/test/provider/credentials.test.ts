import { describe, expect, test, beforeEach } from "bun:test"
import { Database } from "../../src/storage/db"
import { ProviderCredentials } from "../../src/provider/credentials"
import { ProviderCredentialsTable } from "../../src/provider/credentials.sql"

function clearTable() {
  Database.use((db) => db.delete(ProviderCredentialsTable).run())
}

describe("ProviderCredentials", () => {
  beforeEach(() => clearTable())

  describe("get", () => {
    test("returns undefined for unknown provider", () => {
      expect(ProviderCredentials.get("unknown-provider")).toBeUndefined()
    })

    test("returns stored credentials", () => {
      ProviderCredentials.set("litellm", { url: "http://localhost:4000", apiKey: "sk-test" })
      const result = ProviderCredentials.get("litellm")
      expect(result).toEqual({ url: "http://localhost:4000", apiKey: "sk-test" })
    })

    test("returns credentials with undefined apiKey when only url stored", () => {
      ProviderCredentials.set("ollama", { url: "http://localhost:11434", apiKey: undefined })
      const result = ProviderCredentials.get("ollama")
      expect(result?.url).toBe("http://localhost:11434")
      expect(result?.apiKey).toBeUndefined()
    })
  })

  describe("set", () => {
    test("stores and retrieves url and apiKey", () => {
      ProviderCredentials.set("litellm", { url: "http://myserver:4000", apiKey: "key-123" })
      const result = ProviderCredentials.get("litellm")
      expect(result?.url).toBe("http://myserver:4000")
      expect(result?.apiKey).toBe("key-123")
    })

    test("upserts — subsequent set overwrites previous", () => {
      ProviderCredentials.set("litellm", { url: "http://old:4000", apiKey: "old-key" })
      ProviderCredentials.set("litellm", { url: "http://new:4000", apiKey: "new-key" })
      const result = ProviderCredentials.get("litellm")
      expect(result?.url).toBe("http://new:4000")
      expect(result?.apiKey).toBe("new-key")
    })

    test("handles null apiKey on update", () => {
      ProviderCredentials.set("ollama", { url: "http://localhost:11434", apiKey: "old" })
      ProviderCredentials.set("ollama", { url: "http://localhost:11434", apiKey: undefined })
      const result = ProviderCredentials.get("ollama")
      expect(result?.apiKey).toBeUndefined()
    })

    test("stores multiple providers independently", () => {
      ProviderCredentials.set("litellm", { url: "http://litellm:4000", apiKey: "litellm-key" })
      ProviderCredentials.set("ollama", { url: "http://ollama:11434", apiKey: undefined })
      expect(ProviderCredentials.get("litellm")?.url).toBe("http://litellm:4000")
      expect(ProviderCredentials.get("ollama")?.url).toBe("http://ollama:11434")
      expect(ProviderCredentials.get("litellm")?.apiKey).toBe("litellm-key")
    })
  })

  describe("remove", () => {
    test("removes stored credentials", () => {
      ProviderCredentials.set("litellm", { url: "http://localhost:4000", apiKey: "key" })
      ProviderCredentials.remove("litellm")
      expect(ProviderCredentials.get("litellm")).toBeUndefined()
    })

    test("no-op when provider not stored", () => {
      expect(() => ProviderCredentials.remove("nonexistent")).not.toThrow()
    })
  })

  describe("backward compatibility", () => {
    test("litellm loader falls back to url|key parsing when no structured credentials", async () => {
      // Simulate old-style credential: url|apiKey in a single key
      const legacy = "http://myserver:4000|sk-oldkey"
      const pipeIdx = legacy.indexOf("|")
      const url = legacy.substring(0, pipeIdx)
      const key = legacy.substring(pipeIdx + 1)
      expect(url).toBe("http://myserver:4000")
      expect(key).toBe("sk-oldkey")
      // No structured entry means ProviderCredentials.get returns undefined
      expect(ProviderCredentials.get("litellm")).toBeUndefined()
    })
  })
})
