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
import { ProviderCredentials } from "../provider/credentials"
import { detectCapabilitiesFromId } from "../provider/detect-capabilities"

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

function resolveLiteLLMCredentials(
  authKey: string | undefined,
  structured: { url: string | undefined; apiKey: string | undefined } | undefined,
  fallbackURL: string,
  fallbackApiKey: string | undefined,
): { baseURL: string; apiKey: string | undefined } {
  if (structured) {
    return { baseURL: structured.url || fallbackURL, apiKey: structured.apiKey || fallbackApiKey }
  }
  if (authKey) return parseLiteLLMCredentials(authKey, fallbackURL, fallbackApiKey)
  return { baseURL: fallbackURL, apiKey: fallbackApiKey }
}

function parseLiteLLMCredentials(
  authKey: string,
  fallbackURL: string,
  fallbackApiKey: string | undefined,
): { baseURL: string; apiKey: string | undefined } {
  const pipeIdx = authKey.indexOf("|")
  if (pipeIdx >= 0) {
    return {
      baseURL: authKey.substring(0, pipeIdx) || fallbackURL,
      apiKey: authKey.substring(pipeIdx + 1) || fallbackApiKey,
    }
  }
  return { baseURL: fallbackURL, apiKey: authKey }
}

function injectLiteLLMPluginModel(
  models: Record<string, unknown>,
  id: string,
  baseURL: string,
): void {
  if (models[id]) return
  const caps = detectCapabilitiesFromId(id)
  models[id] = {
    id,
    providerID: "litellm",
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

export async function LiteLLMAuthPlugin(_input: PluginInput): Promise<Hooks> {
  return {
    auth: {
      provider: "litellm",
      async loader(getAuth, provider) {
        const auth = await getAuth()

        const fallbackURL = Env.get("LITELLM_BASE_URL") ?? DEFAULT_BASE_URL
        const fallbackApiKey = Env.get("LITELLM_API_KEY")

        // Prefer structured credentials (set by tryCustomAuthorize since v0.1.1).
        // Fall back to legacy url|key encoding for credentials saved before the migration.
        const structured = ProviderCredentials.get("litellm")
        const authKey = auth.type === "api" ? auth.key : undefined
        const { baseURL, apiKey } = resolveLiteLLMCredentials(authKey, structured, fallbackURL, fallbackApiKey)

        if (!apiKey && !baseURL) return {}

        const models = await fetchModelsFromUrl(baseURL, apiKey)
        if (models.length > 0) {
          log.info("litellm models discovered", { count: models.length, baseURL })
          for (const m of models) injectLiteLLMPluginModel(provider.models as Record<string, unknown>, m.id, baseURL)
        }

        return { apiKey, baseURL: `${baseURL}/v1` }
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
