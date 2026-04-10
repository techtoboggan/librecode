import { Hono } from "hono"
import { describeRoute, validator, resolver } from "hono-openapi"
import z from "zod"
import { Config } from "../../config/config"
import { Provider } from "../../provider/provider"
import { ModelsDev } from "../../provider/models"
import { ProviderAuth } from "../../provider/auth"
import { ProviderID } from "../../provider/schema"
import { mapValues } from "remeda"
import { errors } from "../error"
import { lazy } from "../../util/lazy"

export const ProviderRoutes = lazy(() =>
  new Hono()
    .get(
      "/",
      describeRoute({
        summary: "List providers",
        description: "Get a list of all available AI providers, including both available and connected ones.",
        operationId: "provider.list",
        responses: {
          200: {
            description: "List of providers",
            content: {
              "application/json": {
                schema: resolver(
                  z.object({
                    all: ModelsDev.Provider.array(),
                    default: z.record(z.string(), z.string()),
                    connected: z.array(z.string()),
                  }),
                ),
              },
            },
          },
        },
      }),
      async (c) => {
        const config = await Config.get()
        const disabled = new Set(config.disabled_providers ?? [])
        const enabled = config.enabled_providers ? new Set(config.enabled_providers) : undefined

        const allProviders = await ModelsDev.get()

        // Ensure local-first providers always appear in the provider list
        // so users can find and configure them, even before autodiscovery runs.
        if (!allProviders["litellm"]) {
          allProviders["litellm"] = {
            id: "litellm",
            name: "LiteLLM",
            api: "http://localhost:4000/v1",
            npm: "@ai-sdk/openai-compatible",
            env: ["LITELLM_API_KEY"],
            models: {},
          }
        }
        if (!allProviders["ollama"]) {
          allProviders["ollama"] = {
            id: "ollama",
            name: "Ollama",
            api: "http://localhost:11434/v1",
            npm: "@ai-sdk/openai-compatible",
            env: [],
            models: {},
          }
        }

        const filteredProviders: Record<string, (typeof allProviders)[string]> = {}
        for (const [key, value] of Object.entries(allProviders)) {
          if ((enabled ? enabled.has(key) : true) && !disabled.has(key)) {
            filteredProviders[key] = value
          }
        }

        const connected = await Provider.list()
        const providers = Object.assign(
          mapValues(filteredProviders, (x) => Provider.fromModelsDevProvider(x)),
          connected,
        )
        return c.json({
          all: Object.values(providers),
          default: mapValues(providers, (item) => Provider.sort(Object.values(item.models))[0]?.id),
          connected: Object.keys(connected),
        })
      },
    )
    .get(
      "/auth",
      describeRoute({
        summary: "Get provider auth methods",
        description: "Retrieve available authentication methods for all AI providers.",
        operationId: "provider.auth",
        responses: {
          200: {
            description: "Provider auth methods",
            content: {
              "application/json": {
                schema: resolver(z.record(z.string(), z.array(ProviderAuth.Method))),
              },
            },
          },
        },
      }),
      async (c) => {
        return c.json(await ProviderAuth.methods())
      },
    )
    .post(
      "/:providerID/oauth/authorize",
      describeRoute({
        summary: "OAuth authorize",
        description: "Initiate OAuth authorization for a specific AI provider to get an authorization URL.",
        operationId: "provider.oauth.authorize",
        responses: {
          200: {
            description: "Authorization URL and method",
            content: {
              "application/json": {
                schema: resolver(ProviderAuth.Authorization.optional()),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator(
        "param",
        z.object({
          providerID: ProviderID.zod.meta({ description: "Provider ID" }),
        }),
      ),
      validator(
        "json",
        z.object({
          method: z.number().meta({ description: "Auth method index" }),
        }),
      ),
      async (c) => {
        const providerID = c.req.valid("param").providerID
        const { method } = c.req.valid("json")
        const result = await ProviderAuth.authorize({
          providerID,
          method,
        })
        return c.json(result)
      },
    )
    .post(
      "/:providerID/api/authorize",
      describeRoute({
        summary: "API key authorize",
        description: "Submit API key and additional inputs for a provider that requires custom authorization.",
        operationId: "provider.api.authorize",
        responses: {
          200: {
            description: "API key authorization processed successfully",
            content: {
              "application/json": {
                schema: resolver(z.boolean()),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator(
        "param",
        z.object({
          providerID: ProviderID.zod.meta({ description: "Provider ID" }),
        }),
      ),
      validator(
        "json",
        z.object({
          key: z.string().meta({ description: "API key" }),
          inputs: z.record(z.string(), z.string()).optional().meta({ description: "Additional prompt inputs" }),
        }),
      ),
      async (c) => {
        const providerID = c.req.valid("param").providerID
        const { key, inputs } = c.req.valid("json")
        await ProviderAuth.api({
          providerID,
          key,
          inputs,
        })
        return c.json(true)
      },
    )
    .post(
      "/:providerID/oauth/callback",
      describeRoute({
        summary: "OAuth callback",
        description: "Handle the OAuth callback from a provider after user authorization.",
        operationId: "provider.oauth.callback",
        responses: {
          200: {
            description: "OAuth callback processed successfully",
            content: {
              "application/json": {
                schema: resolver(z.boolean()),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator(
        "param",
        z.object({
          providerID: ProviderID.zod.meta({ description: "Provider ID" }),
        }),
      ),
      validator(
        "json",
        z.object({
          method: z.number().meta({ description: "Auth method index" }),
          code: z.string().optional().meta({ description: "OAuth authorization code" }),
        }),
      ),
      async (c) => {
        const providerID = c.req.valid("param").providerID
        const { method, code } = c.req.valid("json")
        await ProviderAuth.callback({
          providerID,
          method,
          code,
        })
        return c.json(true)
      },
    )
    .post(
      "/scan",
      describeRoute({
        summary: "Scan for local model servers",
        description: "Scan localhost and optionally the local network for OpenAI-compatible model servers.",
        operationId: "provider.scan",
        responses: {
          200: {
            description: "Discovered servers",
            content: {
              "application/json": {
                schema: resolver(
                  z.array(
                    z.object({
                      url: z.string(),
                      serverName: z.string(),
                      modelCount: z.number(),
                      models: z.array(z.object({ id: z.string(), name: z.string() })),
                    }),
                  ),
                ),
              },
            },
          },
        },
      }),
      validator(
        "json",
        z.object({
          network: z.boolean().optional().meta({ description: "Also scan LAN hosts" }),
        }),
      ),
      async (c) => {
        const { network } = c.req.valid("json")

        const KNOWN_PORTS = [
          { port: 4000, name: "LiteLLM" },
          { port: 11434, name: "Ollama" },
          { port: 8000, name: "vLLM" },
          { port: 8080, name: "llama.cpp" },
          { port: 3000, name: "LocalAI" },
          { port: 5000, name: "Model Server" },
          { port: 8001, name: "Model Server" },
          { port: 9000, name: "Model Server" },
        ]
        const TIMEOUT_MS = 3000

        type Server = { url: string; serverName: string; modelCount: number; models: { id: string; name: string }[] }

        async function probe(baseUrl: string, name: string): Promise<Server | null> {
          const controller = new AbortController()
          const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS)
          try {
            const res = await fetch(`${baseUrl}/v1/models`, {
              headers: { "Content-Type": "application/json" },
              signal: controller.signal,
            })
            clearTimeout(timeout)
            if (!res.ok) return null
            const data = (await res.json()) as { data?: Array<{ id: string }> }
            const models = (data.data ?? []).map((m) => ({ id: m.id, name: m.id }))
            if (models.length === 0) return null
            return { url: baseUrl, serverName: name, modelCount: models.length, models }
          } catch {
            return null
          }
        }

        const servers: Server[] = []
        const seen = new Set<string>()

        // Always scan localhost
        await Promise.allSettled(
          KNOWN_PORTS.map(async (entry) => {
            const url = `http://localhost:${entry.port}`
            const server = await probe(url, entry.name)
            if (server && !seen.has(url)) {
              seen.add(url)
              servers.push(server)
            }
          }),
        )

        // Optionally scan LAN
        if (network) {
          const networkPorts = [4000, 11434, 8000, 8080]
          const subnets = ["192.168.1", "192.168.0", "192.168.86", "10.0.0", "10.0.1"]
          const hostRange = 30
          const BATCH = 50

          const targets: Array<{ host: string; port: number; name: string }> = []
          for (const sub of subnets) {
            for (let i = 1; i <= hostRange; i++) {
              for (const entry of KNOWN_PORTS.filter((p) => networkPorts.includes(p.port))) {
                targets.push({ host: `${sub}.${i}`, port: entry.port, name: entry.name })
              }
            }
          }

          for (let i = 0; i < targets.length; i += BATCH) {
            const batch = targets.slice(i, i + BATCH)
            await Promise.allSettled(
              batch.map(async (t) => {
                const url = `http://${t.host}:${t.port}`
                if (seen.has(url)) return
                const server = await probe(url, `${t.name} (${t.host})`)
                if (server) {
                  seen.add(url)
                  servers.push(server)
                }
              }),
            )
          }
        }

        return c.json(servers)
      },
    ),
)
