/**
 * Tests for the LiteLLM provider loader.
 * We test via the exported `litellm` loader function with a mock fetch.
 */
import { afterEach, describe, expect, mock, test } from "bun:test"
import { Instance } from "../../../src/project/instance"
import { litellm } from "../../../src/provider/loaders/litellm"
import type { ProviderInfo } from "../../../src/provider/plugin-api"
import { tmpdir } from "../../fixture/fixture"

function makeProvider(overrides: Partial<ProviderInfo> = {}): ProviderInfo {
  return {
    id: "litellm",
    env: [],
    options: {},
    models: {},
    ...overrides,
  }
}

// Save/restore original fetch so tests don't leak
const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
})

async function withInstance<T>(fn: () => Promise<T>): Promise<T> {
  await using tmp = await tmpdir()
  return Instance.provide({ directory: tmp.path, fn })
}

describe("litellm loader: no models → autoload false", () => {
  test("returns autoload: false when fetch returns empty model list", async () => {
    globalThis.fetch = mock(
      async () => new Response(JSON.stringify({ data: [] }), { status: 200 }),
    ) as unknown as typeof fetch

    await withInstance(async () => {
      const result = await litellm(makeProvider())
      expect(result.autoload).toBe(false)
    })
  })

  test("returns autoload: false when fetch returns non-OK response", async () => {
    globalThis.fetch = mock(async () => new Response("Unauthorized", { status: 401 })) as unknown as typeof fetch

    await withInstance(async () => {
      const result = await litellm(makeProvider())
      expect(result.autoload).toBe(false)
    })
  })

  test("returns autoload: false when fetch throws (connection refused)", async () => {
    globalThis.fetch = mock(async () => {
      throw new Error("Connection refused")
    }) as unknown as typeof fetch

    await withInstance(async () => {
      const result = await litellm(makeProvider())
      expect(result.autoload).toBe(false)
    })
  })

  test("returns autoload: false when fetch throws AbortError", async () => {
    globalThis.fetch = mock(async () => {
      const err = new DOMException("The operation was aborted.", "AbortError")
      throw err
    }) as unknown as typeof fetch

    await withInstance(async () => {
      const result = await litellm(makeProvider())
      expect(result.autoload).toBe(false)
    })
  })
})

describe("litellm loader: models discovered → autoload true", () => {
  test("returns autoload: true and injects models when models are found", async () => {
    const models = [{ id: "gpt-4o" }, { id: "claude-sonnet-4-5" }]
    globalThis.fetch = mock(
      async () => new Response(JSON.stringify({ data: models }), { status: 200 }),
    ) as unknown as typeof fetch

    await withInstance(async () => {
      const provider = makeProvider()
      const result = await litellm(provider)
      expect(result.autoload).toBe(true)
      expect(provider.models["gpt-4o"]).toBeDefined()
      expect(provider.models["claude-sonnet-4-5"]).toBeDefined()
    })
  })

  test("injected model has expected providerID and defaults", async () => {
    globalThis.fetch = mock(
      async () => new Response(JSON.stringify({ data: [{ id: "my-model" }] }), { status: 200 }),
    ) as unknown as typeof fetch

    await withInstance(async () => {
      const provider = makeProvider()
      await litellm(provider)
      const m = provider.models["my-model"] as Record<string, unknown>
      expect(m).toBeDefined()
      expect(m.providerID).toBe("litellm")
      expect(m.id).toBe("my-model")
      expect(m.name).toBe("my-model")
    })
  })

  test("does not overwrite an existing model in provider.models", async () => {
    const original = { id: "existing", name: "Original Name" } as unknown as ProviderInfo["models"][string]
    const provider = makeProvider({ models: { existing: original } })

    globalThis.fetch = mock(
      async () => new Response(JSON.stringify({ data: [{ id: "existing" }] }), { status: 200 }),
    ) as unknown as typeof fetch

    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await litellm(provider)
        // Should not be overwritten
        expect(provider.models.existing.name).toBe("Original Name")
      },
    })
  })

  test("result includes baseURL in options", async () => {
    globalThis.fetch = mock(
      async () => new Response(JSON.stringify({ data: [{ id: "m1" }] }), { status: 200 }),
    ) as unknown as typeof fetch

    await withInstance(async () => {
      const result = await litellm(makeProvider())
      expect(result.options).toBeDefined()
      expect((result.options as Record<string, unknown>).baseURL).toBe("http://localhost:4000/v1")
    })
  })

  test("result includes apiKey in options when provided via provider.options", async () => {
    globalThis.fetch = mock(
      async () => new Response(JSON.stringify({ data: [{ id: "m1" }] }), { status: 200 }),
    ) as unknown as typeof fetch

    await withInstance(async () => {
      const result = await litellm(makeProvider({ options: { apiKey: "provider-api-key" } }))
      expect((result.options as Record<string, unknown>).apiKey).toBe("provider-api-key")
    })
  })

  test("uses custom baseURL from provider.options", async () => {
    const customURL = "http://myserver:8080/v1"
    let capturedURL = ""
    globalThis.fetch = mock(async (url: RequestInfo | URL) => {
      capturedURL = url.toString()
      return new Response(JSON.stringify({ data: [{ id: "m" }] }), { status: 200 })
    }) as unknown as typeof fetch

    await withInstance(async () => {
      await litellm(makeProvider({ options: { baseURL: customURL } }))
      expect(capturedURL).toBe(`${customURL}/models`)
    })
  })

  test("falls back to DEFAULT_BASE_URL when no env or options set", async () => {
    let capturedURL = ""
    globalThis.fetch = mock(async (url: RequestInfo | URL) => {
      capturedURL = url.toString()
      return new Response(JSON.stringify({ data: [{ id: "m" }] }), { status: 200 })
    }) as unknown as typeof fetch

    await withInstance(async () => {
      await litellm(makeProvider())
      expect(capturedURL).toBe("http://localhost:4000/v1/models")
    })
  })

  test("getModel calls sdk.languageModel with the modelID", async () => {
    globalThis.fetch = mock(
      async () => new Response(JSON.stringify({ data: [{ id: "test-model" }] }), { status: 200 }),
    ) as unknown as typeof fetch

    await withInstance(async () => {
      const result = await litellm(makeProvider())
      expect(result.getModel).toBeDefined()
      // biome-ignore lint/suspicious/noExplicitAny: test mock doesn't need full LanguageModelV2 shape
      const mockModel = { id: "test-model" } as any
      const mockSdk = { languageModel: mock(() => mockModel) }
      // biome-ignore lint/suspicious/noExplicitAny: test mock doesn't need full SDK shape
      const model = await (result.getModel as any)(mockSdk, "test-model")
      expect(model).toBe(mockModel)
      expect(mockSdk.languageModel).toHaveBeenCalledWith("test-model")
    })
  })
})
