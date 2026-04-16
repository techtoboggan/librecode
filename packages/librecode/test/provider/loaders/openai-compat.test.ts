/**
 * Tests for OpenAI-compatible provider loaders.
 * All loaders return autoload: false and expose a getModel function.
 * We test the helper logic: shouldUseCopilotResponsesApi, useLanguageModel, callSdkMethod.
 */
import { describe, expect, mock, test } from "bun:test"
import { Instance } from "../../../src/project/instance"
import {
  azure,
  azureCognitiveServices,
  githubCopilot,
  githubCopilotEnterprise,
  openai,
} from "../../../src/provider/loaders/openai-compat"
import type { ProviderInfo } from "../../../src/provider/plugin-api"
import { tmpdir } from "../../fixture/fixture"

function makeProvider(overrides: Partial<ProviderInfo> = {}): ProviderInfo {
  return { id: "openai", env: [], options: {}, models: {}, ...overrides }
}

async function withInstance<T>(fn: () => Promise<T>): Promise<T> {
  await using tmp = await tmpdir()
  return Instance.provide({ directory: tmp.path, fn })
}

// ----- openai loader -----

describe("openai loader", () => {
  test("returns autoload: false", async () => {
    await withInstance(async () => {
      const result = await openai(makeProvider())
      expect(result.autoload).toBe(false)
    })
  })

  test("getModel calls sdk.responses with modelID", async () => {
    await withInstance(async () => {
      const result = await openai(makeProvider())
      // biome-ignore lint/suspicious/noExplicitAny: test mock doesn't need full LanguageModelV2 shape
      const mockFn = mock(() => ({ id: "gpt-4o" }) as any)
      // biome-ignore lint/suspicious/noExplicitAny: test mock doesn't need full SDK shape
      const model = await (result.getModel as any)({ responses: mockFn }, "gpt-4o")
      expect(mockFn).toHaveBeenCalledWith("gpt-4o")
      expect(model).toEqual({ id: "gpt-4o" })
    })
  })

  test("getModel throws when sdk.responses is undefined", async () => {
    await withInstance(async () => {
      const result = await openai(makeProvider())
      await expect(result.getModel?.({}, "gpt-4o")).rejects.toThrow("SDK method not available")
    })
  })
})

// ----- githubCopilot loader -----

describe("githubCopilot loader", () => {
  test("returns autoload: false", async () => {
    await withInstance(async () => {
      const result = await githubCopilot(makeProvider())
      expect(result.autoload).toBe(false)
    })
  })

  test("uses languageModel when responses and chat are both undefined", async () => {
    await withInstance(async () => {
      const result = await githubCopilot(makeProvider())
      const mockFn = mock(() => ({ id: "m" }))
      const sdk = { languageModel: mockFn }
      await result.getModel?.(sdk, "some-model")
      expect(mockFn).toHaveBeenCalledWith("some-model")
    })
  })

  test("uses responses for gpt-5 model (version >= 5)", async () => {
    await withInstance(async () => {
      const result = await githubCopilot(makeProvider())
      const responsesFn = mock(() => ({ id: "gpt-5" }))
      const chatFn = mock(() => ({ id: "gpt-5-chat" }))
      const sdk = { responses: responsesFn, chat: chatFn }
      await result.getModel?.(sdk, "gpt-5")
      expect(responsesFn).toHaveBeenCalledWith("gpt-5")
      expect(chatFn).not.toHaveBeenCalled()
    })
  })

  test("uses responses for o-5 model", async () => {
    await withInstance(async () => {
      const result = await githubCopilot(makeProvider())
      const responsesFn = mock(() => ({ id: "o-5" }))
      const chatFn = mock(() => ({}))
      const sdk = { responses: responsesFn, chat: chatFn }
      await result.getModel?.(sdk, "o-5")
      expect(responsesFn).toHaveBeenCalledWith("o-5")
      expect(chatFn).not.toHaveBeenCalled()
    })
  })

  test("uses chat for gpt-4o (version < 5)", async () => {
    await withInstance(async () => {
      const result = await githubCopilot(makeProvider())
      const responsesFn = mock(() => ({}))
      const chatFn = mock(() => ({ id: "gpt-4o" }))
      const sdk = { responses: responsesFn, chat: chatFn }
      await result.getModel?.(sdk, "gpt-4o")
      expect(chatFn).toHaveBeenCalledWith("gpt-4o")
      expect(responsesFn).not.toHaveBeenCalled()
    })
  })

  test("uses chat for o4 (version < 5)", async () => {
    await withInstance(async () => {
      const result = await githubCopilot(makeProvider())
      const responsesFn = mock(() => ({}))
      const chatFn = mock(() => ({ id: "o4" }))
      const sdk = { responses: responsesFn, chat: chatFn }
      await result.getModel?.(sdk, "o4")
      expect(chatFn).toHaveBeenCalledWith("o4")
    })
  })

  test("model without matching prefix uses chat", async () => {
    await withInstance(async () => {
      const result = await githubCopilot(makeProvider())
      const responsesFn = mock(() => ({}))
      const chatFn = mock(() => ({ id: "claude-3" }))
      const sdk = { responses: responsesFn, chat: chatFn }
      await result.getModel?.(sdk, "claude-3")
      expect(chatFn).toHaveBeenCalledWith("claude-3")
    })
  })
})

// ----- githubCopilotEnterprise loader -----

describe("githubCopilotEnterprise loader", () => {
  test("returns autoload: false", async () => {
    await withInstance(async () => {
      const result = await githubCopilotEnterprise(makeProvider())
      expect(result.autoload).toBe(false)
    })
  })

  test("uses languageModel when responses and chat are undefined", async () => {
    await withInstance(async () => {
      const result = await githubCopilotEnterprise(makeProvider())
      const mockFn = mock(() => ({ id: "m" }))
      const sdk = { languageModel: mockFn }
      await result.getModel?.(sdk, "some-model")
      expect(mockFn).toHaveBeenCalledWith("some-model")
    })
  })

  test("uses responses for gpt-5+ model", async () => {
    await withInstance(async () => {
      const result = await githubCopilotEnterprise(makeProvider())
      const responsesFn = mock(() => ({ id: "gpt-5" }))
      const chatFn = mock(() => ({}))
      const sdk = { responses: responsesFn, chat: chatFn }
      await result.getModel?.(sdk, "gpt-5")
      expect(responsesFn).toHaveBeenCalledWith("gpt-5")
    })
  })

  test("uses chat for older models", async () => {
    await withInstance(async () => {
      const result = await githubCopilotEnterprise(makeProvider())
      const responsesFn = mock(() => ({}))
      const chatFn = mock(() => ({ id: "gpt-4" }))
      const sdk = { responses: responsesFn, chat: chatFn }
      await result.getModel?.(sdk, "gpt-4")
      expect(chatFn).toHaveBeenCalledWith("gpt-4")
    })
  })
})

// ----- azure loader -----

describe("azure loader", () => {
  test("returns autoload: false", async () => {
    await withInstance(async () => {
      const result = await azure(makeProvider({ id: "azure" }))
      expect(result.autoload).toBe(false)
    })
  })

  test("uses languageModel when responses and chat are undefined", async () => {
    await withInstance(async () => {
      const result = await azure(makeProvider({ id: "azure" }))
      const mockFn = mock(() => ({ id: "m" }))
      const sdk = { languageModel: mockFn }
      await result.getModel?.(sdk, "gpt-4")
      expect(mockFn).toHaveBeenCalledWith("gpt-4")
    })
  })

  test("uses responses when useCompletionUrls is false", async () => {
    await withInstance(async () => {
      const result = await azure(makeProvider({ id: "azure" }))
      const responsesFn = mock(() => ({ id: "r" }))
      const chatFn = mock(() => ({}))
      const sdk = { responses: responsesFn, chat: chatFn }
      await result.getModel?.(sdk, "gpt-4", { useCompletionUrls: false })
      expect(responsesFn).toHaveBeenCalledWith("gpt-4")
      expect(chatFn).not.toHaveBeenCalled()
    })
  })

  test("uses chat when useCompletionUrls is true", async () => {
    await withInstance(async () => {
      const result = await azure(makeProvider({ id: "azure" }))
      const responsesFn = mock(() => ({}))
      const chatFn = mock(() => ({ id: "c" }))
      const sdk = { responses: responsesFn, chat: chatFn }
      await result.getModel?.(sdk, "gpt-4", { useCompletionUrls: true })
      expect(chatFn).toHaveBeenCalledWith("gpt-4")
      expect(responsesFn).not.toHaveBeenCalled()
    })
  })

  test("vars returns AZURE_RESOURCE_NAME when set via provider options", async () => {
    await withInstance(async () => {
      const result = await azure(makeProvider({ id: "azure", options: { resourceName: "my-resource" } }))
      const vars = result.vars?.({})
      expect(vars?.AZURE_RESOURCE_NAME).toBe("my-resource")
    })
  })

  test("vars returns empty when resourceName is blank string", async () => {
    await withInstance(async () => {
      const result = await azure(makeProvider({ id: "azure", options: { resourceName: "   " } }))
      const vars = result.vars?.({})
      expect(vars?.AZURE_RESOURCE_NAME).toBeUndefined()
    })
  })

  test("vars returns empty when no resource name", async () => {
    await withInstance(async () => {
      const result = await azure(makeProvider({ id: "azure", options: {} }))
      const vars = result.vars?.({})
      expect(vars?.AZURE_RESOURCE_NAME).toBeUndefined()
    })
  })
})

// ----- azureCognitiveServices loader -----

describe("azureCognitiveServices loader", () => {
  test("returns autoload: false", async () => {
    await withInstance(async () => {
      const result = await azureCognitiveServices(makeProvider({ id: "azure-cognitive-services" }))
      expect(result.autoload).toBe(false)
    })
  })

  test("baseURL is undefined when resource name is not set", async () => {
    await withInstance(async () => {
      const result = await azureCognitiveServices(makeProvider({ id: "azure-cognitive-services" }))
      const opts = result.options as Record<string, unknown>
      expect(opts.baseURL).toBeUndefined()
    })
  })

  test("uses languageModel when responses and chat are undefined", async () => {
    await withInstance(async () => {
      const result = await azureCognitiveServices(makeProvider({ id: "azure-cognitive-services" }))
      const mockFn = mock(() => ({ id: "m" }))
      const sdk = { languageModel: mockFn }
      await result.getModel?.(sdk, "text-embedding")
      expect(mockFn).toHaveBeenCalledWith("text-embedding")
    })
  })

  test("uses responses when useCompletionUrls is false", async () => {
    await withInstance(async () => {
      const result = await azureCognitiveServices(makeProvider({ id: "azure-cognitive-services" }))
      const responsesFn = mock(() => ({ id: "r" }))
      const chatFn = mock(() => ({}))
      const sdk = { responses: responsesFn, chat: chatFn }
      await result.getModel?.(sdk, "m", { useCompletionUrls: false })
      expect(responsesFn).toHaveBeenCalledWith("m")
    })
  })

  test("uses chat when useCompletionUrls is true", async () => {
    await withInstance(async () => {
      const result = await azureCognitiveServices(makeProvider({ id: "azure-cognitive-services" }))
      const responsesFn = mock(() => ({}))
      const chatFn = mock(() => ({ id: "c" }))
      const sdk = { responses: responsesFn, chat: chatFn }
      await result.getModel?.(sdk, "m", { useCompletionUrls: true })
      expect(chatFn).toHaveBeenCalledWith("m")
    })
  })
})
