/**
 * Ollama Auth Plugin
 *
 * Registers Ollama as a proper provider. Ollama doesn't require an API key —
 * just a URL (default localhost:11434). The authorize function validates the
 * connection by probing /v1/models and /api/tags. The loader discovers and
 * registers all available models.
 */

import type { Hooks, PluginInput } from "@librecode/plugin"
import { ProviderCredentials } from "../provider/credentials"
import { detectCapabilitiesFromId } from "../provider/detect-capabilities"
import { Log } from "../util/log"

const log = Log.create({ service: "plugin.ollama" })

const DEFAULT_BASE_URL = "http://localhost:11434"
const CONNECT_TIMEOUT_MS = 5000

function parseOllamaResponse(data: Record<string, unknown>): Array<{ id: string }> {
  // OpenAI-compatible format: { data: [{ id }] }
  if (Array.isArray(data.data)) {
    return (data.data as Array<{ id: string }>).filter((m) => m.id)
  }
  // Ollama native format: { models: [{ name, model }] }
  if (Array.isArray(data.models)) {
    return (
      (data.models as Array<{ name?: string; model?: string }>)
        .filter((m) => m.name || m.model)
        // biome-ignore lint/style/noNonNullAssertion: filter above ensures at least one of name/model is defined
        .map((m) => ({ id: (m.name ?? m.model)! }))
    )
  }
  return []
}

async function tryOllamaEndpoint(endpoint: string): Promise<Array<{ id: string }>> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), CONNECT_TIMEOUT_MS)
  try {
    const response = await fetch(endpoint, { signal: controller.signal })
    clearTimeout(timeout)
    if (!response.ok) return []
    return parseOllamaResponse((await response.json()) as Record<string, unknown>)
  } catch {
    return []
  }
}

async function fetchModelsFromOllama(baseURL: string): Promise<Array<{ id: string }>> {
  const url = baseURL.replace(/\/+$/, "")
  const models = await tryOllamaEndpoint(`${url}/v1/models`)
  return models.length > 0 ? models : tryOllamaEndpoint(`${url}/api/tags`)
}

function injectOllamaModel(models: Record<string, unknown>, id: string, baseURL: string): void {
  if (models[id]) return
  const caps = detectCapabilitiesFromId(id)
  models[id] = {
    id,
    providerID: "ollama",
    name: id,
    api: { id, url: `${baseURL}/v1`, npm: "@ai-sdk/openai-compatible" },
    status: "active",
    headers: {},
    options: {},
    cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
    limit: { context: 128000, output: 4096 },
    capabilities: {
      temperature: true,
      reasoning: caps.reasoning,
      attachment: false,
      toolcall: caps.toolcall,
      input: { text: true, audio: false, image: caps.vision, video: false, pdf: false },
      output: { text: true, audio: false, image: false, video: false, pdf: false },
      interleaved: false,
    },
    release_date: new Date().toISOString().split("T")[0],
    variants: {},
  }
}

export async function OllamaAuthPlugin(_input: PluginInput): Promise<Hooks> {
  return {
    auth: {
      provider: "ollama",
      async loader(getAuth, provider) {
        const auth = await getAuth()
        // Prefer structured credentials (set by tryCustomAuthorize since v0.1.1).
        // Fall back to legacy encoding where the URL was stored directly as auth.key.
        const structured = ProviderCredentials.get("ollama")
        const baseURL = structured?.url || (auth.type === "api" && auth.key ? auth.key : DEFAULT_BASE_URL)

        const models = await fetchModelsFromOllama(baseURL)
        if (models.length > 0) {
          log.info("ollama models discovered", { count: models.length, baseURL })
          for (const m of models) injectOllamaModel(provider.models as Record<string, unknown>, m.id, baseURL)
        }

        return { baseURL: `${baseURL}/v1` }
      },
      methods: [
        {
          label: "Connect to Ollama",
          type: "api" as const,
          prompts: [
            {
              type: "text" as const,
              key: "url",
              message: "Ollama URL",
              placeholder: DEFAULT_BASE_URL,
            },
          ],
          async authorize(inputs?: Record<string, string>) {
            const url = inputs?.url?.trim() || DEFAULT_BASE_URL

            const models = await fetchModelsFromOllama(url)
            if (models.length === 0) {
              log.info("ollama authorize failed: no models found", { url })
              return { type: "failed" as const }
            }

            log.info("ollama authorize success", { url, modelCount: models.length })
            return {
              type: "success" as const,
              key: url,
            }
          },
        },
      ],
    },
  }
}
