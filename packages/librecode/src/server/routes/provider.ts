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
        console.log(`[scan] POST /provider/scan called (network=${network})`)

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

        /** TCP port check — fast way to see if anything is listening */
        async function isPortOpen(host: string, port: number): Promise<boolean> {
          return new Promise((resolve) => {
            const timer = setTimeout(() => resolve(false), 1500)
            try {
              // Use Bun's TCP connect for port checking
              Bun.connect({
                hostname: host,
                port,
                socket: {
                  open(socket) {
                    clearTimeout(timer)
                    socket.end()
                    resolve(true)
                  },
                  data() {},
                  error() {
                    clearTimeout(timer)
                    resolve(false)
                  },
                  close() {},
                },
              }).catch(() => {
                clearTimeout(timer)
                resolve(false)
              })
            } catch {
              clearTimeout(timer)
              resolve(false)
            }
          })
        }

        async function probeEndpoint(url: string): Promise<Array<{ id: string; name: string }>> {
          const controller = new AbortController()
          const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS)
          try {
            const res = await fetch(url, { signal: controller.signal })
            clearTimeout(timeout)
            if (!res.ok) {
              console.log(`[scan] ${url} -> ${res.status}`)
              return []
            }
            const data = await res.json()
            // OpenAI format: { data: [{ id }] }
            if (data?.data && Array.isArray(data.data)) {
              const models = data.data
                .filter((m: any) => m.id)
                .map((m: any) => ({ id: m.id, name: m.id }))
              console.log(`[scan] ${url} -> ${models.length} models (openai format)`)
              return models
            }
            // Ollama native format: { models: [{ name, model }] }
            if (data?.models && Array.isArray(data.models)) {
              const models = data.models
                .filter((m: any) => m.name || m.model)
                .map((m: any) => ({ id: m.name ?? m.model, name: m.name ?? m.model }))
              console.log(`[scan] ${url} -> ${models.length} models (ollama format)`)
              return models
            }
            console.log(`[scan] ${url} -> 200 but unrecognized format`)
            return []
          } catch (e: any) {
            console.log(`[scan] ${url} -> error: ${e?.code ?? e?.message ?? e}`)
            return []
          }
        }

        async function probe(host: string, port: number, name: string): Promise<Server | null> {
          // Step 1: TCP port check (fast fail)
          const open = await isPortOpen(host, port)
          if (!open) return null
          console.log(`[scan] ${host}:${port} -> TCP open, probing HTTP...`)

          const baseUrl = `http://${host}:${port}`
          // Step 2: Try OpenAI-compatible endpoint
          let models = await probeEndpoint(`${baseUrl}/v1/models`)
          // Step 3: Fallback to Ollama native endpoint
          if (models.length === 0) {
            models = await probeEndpoint(`${baseUrl}/api/tags`)
          }
          if (models.length === 0) return null
          return { url: baseUrl, serverName: name, modelCount: models.length, models }
        }

        const servers: Server[] = []
        const seen = new Set<string>()

        console.log("[scan] Starting local scan...")

        // Always scan localhost
        await Promise.allSettled(
          KNOWN_PORTS.map(async (entry) => {
            const server = await probe("localhost", entry.port, entry.name)
            if (server && !seen.has(server.url)) {
              seen.add(server.url)
              servers.push(server)
            }
          }),
        )

        console.log(`[scan] Local scan done. Found ${servers.length} servers.`)

        // Optionally scan LAN
        if (network) {
          console.log("[scan] Starting network scan...")
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

          console.log(`[scan] Scanning ${targets.length} network targets...`)
          for (let i = 0; i < targets.length; i += BATCH) {
            const batch = targets.slice(i, i + BATCH)
            await Promise.allSettled(
              batch.map(async (t) => {
                const url = `http://${t.host}:${t.port}`
                if (seen.has(url)) return
                const server = await probe(t.host, t.port, `${t.name} (${t.host})`)
                if (server) {
                  seen.add(server.url)
                  servers.push(server)
                }
              }),
            )
          }
          console.log(`[scan] Network scan done. Total servers: ${servers.length}`)
        }

        return c.json(servers)
      },
    ),
)
