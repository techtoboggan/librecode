/**
 * LiteLLM Auth Plugin
 *
 * Registers LiteLLM as a proper provider using the standard auth plugin system.
 * Uses prompts to collect server URL + API key, with a custom authorize function
 * that validates the connection before saving credentials. The loader handles
 * model discovery from the /v1/models endpoint.
 */

import type { PluginInput, Hooks } from "@librecode/plugin"
import { Log } from "../util/log"
import { Env } from "../env"

const log = Log.create({ service: "plugin.litellm" })

const DEFAULT_BASE_URL = "http://localhost:4000"
const CONNECT_TIMEOUT_MS = 5000

async function fetchModelsFromUrl(
  baseURL: string,
  apiKey?: string,
): Promise<{ id: string }[]> {
  const url = baseURL.replace(/\/+$/, "")
  const headers: Record<string, string> = {}
  if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), CONNECT_TIMEOUT_MS)
  try {
    const response = await fetch(`${url}/v1/models`, {
      headers,
      signal: controller.signal,
    })
    clearTimeout(timeout)
    if (!response.ok) return []
    const data = (await response.json()) as { data?: Array<{ id: string }> }
    return data.data ?? []
  } catch {
    return []
  }
}

export async function LiteLLMAuthPlugin(_input: PluginInput): Promise<Hooks> {
  return {
    auth: {
      provider: "litellm",
      async loader(getAuth, provider) {
        const auth = await getAuth()

        // The key is stored as "url|apiKey" by the authorize function.
        // Fall back to env vars for backwards compatibility.
        let baseURL = Env.get("LITELLM_BASE_URL") ?? DEFAULT_BASE_URL
        let apiKey = Env.get("LITELLM_API_KEY")

        if (auth.type === "api" && auth.key) {
          const pipeIdx = auth.key.indexOf("|")
          if (pipeIdx >= 0) {
            baseURL = auth.key.substring(0, pipeIdx) || baseURL
            apiKey = auth.key.substring(pipeIdx + 1) || apiKey
          } else {
            apiKey = auth.key
          }
        }

        if (!apiKey && !baseURL) return {}

        const models = await fetchModelsFromUrl(baseURL, apiKey)
        if (models.length > 0) {
          log.info("litellm models discovered", { count: models.length, baseURL })
          for (const m of models) {
            if (!provider.models[m.id]) {
              provider.models[m.id] = {
                id: m.id as any,
                providerID: "litellm" as any,
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
          apiKey,
          baseURL: `${baseURL}/v1`,
        }
      },
      methods: [
        {
          label: "Connect to LiteLLM Server",
          type: "api" as const,
          prompts: [
            {
              type: "text" as const,
              key: "url",
              message: "Server URL",
              placeholder: DEFAULT_BASE_URL,
            },
            {
              type: "text" as const,
              key: "apiKey",
              message: "API Key (optional)",
              placeholder: "sk-...",
            },
          ],
          async authorize(inputs?: Record<string, string>) {
            const url = inputs?.url?.trim() || DEFAULT_BASE_URL
            const apiKey = inputs?.apiKey?.trim()

            // Validate connection by trying to fetch models
            const models = await fetchModelsFromUrl(url, apiKey)
            if (models.length === 0) {
              log.info("litellm authorize failed: no models found", { url })
              return { type: "failed" as const }
            }

            log.info("litellm authorize success", { url, modelCount: models.length })

            // Store the URL in an env-like format so the loader can pick it up.
            // The API key is what gets persisted to auth storage.
            // We encode the URL into the key so the loader can extract it.
            const keyPayload = apiKey
              ? `${url}|${apiKey}`
              : `${url}|`

            return {
              type: "success" as const,
              key: keyPayload,
            }
          },
        },
      ],
    },
  }
}
