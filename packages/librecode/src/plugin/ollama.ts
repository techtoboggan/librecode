/**
 * Ollama Auth Plugin
 *
 * Registers Ollama as a proper provider. Ollama doesn't require an API key —
 * just a URL (default localhost:11434). The authorize function validates the
 * connection by probing /v1/models and /api/tags. The loader discovers and
 * registers all available models.
 */

import type { PluginInput, Hooks } from "@librecode/plugin"
import { Log } from "../util/log"

const log = Log.create({ service: "plugin.ollama" })

const DEFAULT_BASE_URL = "http://localhost:11434"
const CONNECT_TIMEOUT_MS = 5000

async function fetchModelsFromOllama(
  baseURL: string,
): Promise<Array<{ id: string }>> {
  const url = baseURL.replace(/\/+$/, "")

  async function tryEndpoint(endpoint: string): Promise<Array<{ id: string }>> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), CONNECT_TIMEOUT_MS)
    try {
      const response = await fetch(endpoint, { signal: controller.signal })
      clearTimeout(timeout)
      if (!response.ok) return []
      const data = (await response.json()) as Record<string, unknown>
      // OpenAI-compatible format: { data: [{ id }] }
      if (Array.isArray(data.data)) {
        return (data.data as Array<{ id: string }>).filter((m) => m.id)
      }
      // Ollama native format: { models: [{ name, model }] }
      if (Array.isArray(data.models)) {
        return (data.models as Array<{ name?: string; model?: string }>)
          .filter((m) => m.name || m.model)
          .map((m) => ({ id: (m.name ?? m.model)! }))
      }
      return []
    } catch {
      return []
    }
  }

  let models = await tryEndpoint(`${url}/v1/models`)
  if (models.length === 0) {
    models = await tryEndpoint(`${url}/api/tags`)
  }
  return models
}

export async function OllamaAuthPlugin(_input: PluginInput): Promise<Hooks> {
  return {
    auth: {
      provider: "ollama",
      async loader(getAuth, provider) {
        const auth = await getAuth()

        let baseURL = DEFAULT_BASE_URL
        if (auth.type === "api" && auth.key) {
          baseURL = auth.key || DEFAULT_BASE_URL
        }

        const models = await fetchModelsFromOllama(baseURL)
        if (models.length > 0) {
          log.info("ollama models discovered", { count: models.length, baseURL })
          for (const m of models) {
            if (!provider.models[m.id]) {
              provider.models[m.id] = {
                id: m.id as any,
                providerID: "ollama" as any,
                name: m.id,
                api: { id: m.id, url: `${baseURL}/v1`, npm: "@ai-sdk/openai-compatible" },
                status: "active" as const,
                headers: {},
                options: {},
                cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
                limit: { context: 128000, output: 4096 },
                capabilities: {
                  temperature: true,
                  reasoning: false,
                  attachment: false,
                  toolcall: true,
                  input: { text: true, audio: false, image: false, video: false, pdf: false },
                  output: { text: true, audio: false, image: false, video: false, pdf: false },
                  interleaved: false,
                },
                release_date: new Date().toISOString().split("T")[0],
                variants: {},
              } as any
            }
          }
        }

        return {
          baseURL: `${baseURL}/v1`,
        }
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
