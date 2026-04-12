import { Hono } from "hono"
import { describeRoute, resolver, validator } from "hono-openapi"
import { mapValues } from "remeda"
import z from "zod"
import { Config } from "../../config/config"
import { ProviderAuth } from "../../provider/auth"
import { ModelsDev } from "../../provider/models"
import { Provider } from "../../provider/provider"
import { ProviderID } from "../../provider/schema"
import { lazy } from "../../util/lazy"
import { Log } from "../../util/log"
import { errors } from "../error"

const log = Log.create({ service: "server.routes.provider" })

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

const SCAN_TIMEOUT_MS = 3000

type ScanServer = { url: string; serverName: string; modelCount: number; models: { id: string; name: string }[] }

// SSRF guard: reject attempts to probe cloud metadata services or loopback addresses.
// Loopback is already covered by the dedicated localhost scan path.
// 169.254.169.254 is the AWS/Azure/GCP/DO metadata endpoint — must never be reached.
const BLOCKED_HOST_PATTERNS = [
  /^127\./,
  /^0\./,
  /^169\.254\./,
  /^::1$/,
  /^localhost$/i,
  /^metadata\.google\.internal$/i,
]

function isValidRemoteHost(host: string): boolean {
  if (!host || host.length > 253) return false
  // Reject if it matches any blocked pattern
  for (const pattern of BLOCKED_HOST_PATTERNS) {
    if (pattern.test(host)) return false
  }
  // Must be a valid hostname or IP (basic check — no shell metacharacters)
  return /^[a-zA-Z0-9._\-[\]:]+$/.test(host)
}

function guessServerName(hostName: string, port: number): string {
  const known = KNOWN_PORTS.find((p) => p.port === port)
  const label = known?.name ?? "Server"
  return hostName === "localhost" ? label : `${label} (${hostName})`
}

function ensureLocalFirstProviders(allProviders: Record<string, ModelsDev.Provider>): void {
  if (!allProviders.litellm) {
    allProviders.litellm = {
      id: "litellm",
      name: "LiteLLM",
      api: "http://localhost:4000/v1",
      npm: "@ai-sdk/openai-compatible",
      env: ["LITELLM_API_KEY"],
      models: {},
    }
  }
  if (!allProviders.ollama) {
    allProviders.ollama = {
      id: "ollama",
      name: "Ollama",
      api: "http://localhost:11434/v1",
      npm: "@ai-sdk/openai-compatible",
      env: [],
      models: {},
    }
  }
}

function filterProviders(
  allProviders: Record<string, ModelsDev.Provider>,
  disabled: Set<string>,
  enabled: Set<string> | undefined,
): Record<string, ModelsDev.Provider> {
  const filtered: Record<string, ModelsDev.Provider> = {}
  for (const [key, value] of Object.entries(allProviders)) {
    if ((enabled ? enabled.has(key) : true) && !disabled.has(key)) {
      filtered[key] = value
    }
  }
  return filtered
}

/** TCP port check — fast way to see if anything is listening */
async function isPortOpen(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), 1500)
    try {
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

function parseOpenAIModels(data: unknown): Array<{ id: string; name: string }> | undefined {
  if (data && typeof data === "object" && "data" in data && Array.isArray((data as Record<string, unknown>).data)) {
    const items = (data as Record<string, unknown>).data as unknown[]
    return items
      .filter((m): m is Record<string, unknown> => !!m && typeof m === "object" && !!(m as Record<string, unknown>).id)
      .map((m) => ({ id: String(m.id), name: String(m.id) }))
  }
  return undefined
}

function parseOllamaModels(data: unknown): Array<{ id: string; name: string }> | undefined {
  if (data && typeof data === "object" && "models" in data && Array.isArray((data as Record<string, unknown>).models)) {
    const items = (data as Record<string, unknown>).models as unknown[]
    return items
      .filter((m): m is Record<string, unknown> => !!m && typeof m === "object")
      .filter((m) => m.name || m.model)
      .map((m) => ({ id: String(m.name ?? m.model), name: String(m.name ?? m.model) }))
  }
  return undefined
}

async function probeEndpoint(url: string): Promise<Array<{ id: string; name: string }>> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), SCAN_TIMEOUT_MS)
  try {
    const res = await fetch(url, { signal: controller.signal })
    clearTimeout(timeout)
    if (!res.ok) {
      log.debug("probe failed", { url, status: res.status })
      return []
    }
    const data = await res.json()
    const openai = parseOpenAIModels(data)
    if (openai) {
      log.debug("probe found models", { url, count: openai.length, format: "openai" })
      return openai
    }
    const ollama = parseOllamaModels(data)
    if (ollama) {
      log.debug("probe found models", { url, count: ollama.length, format: "ollama" })
      return ollama
    }
    log.debug("probe unrecognized format", { url })
    return []
  } catch (e: unknown) {
    const err = e as Record<string, unknown>
    log.debug("probe error", { url, error: String(err?.code ?? err?.message ?? e) })
    return []
  }
}

async function probe(host: string, port: number, name: string): Promise<ScanServer | null> {
  const open = await isPortOpen(host, port)
  if (!open) return null
  log.debug("port open, probing HTTP", { host, port })

  const baseUrl = `http://${host}:${port}`
  let models = await probeEndpoint(`${baseUrl}/v1/models`)
  if (models.length === 0) {
    models = await probeEndpoint(`${baseUrl}/api/tags`)
  }
  if (models.length === 0) return null
  return { url: baseUrl, serverName: name, modelCount: models.length, models }
}

async function scanPorts(
  host: string,
  ports: { port: number; name: string }[],
  seen: Set<string>,
): Promise<ScanServer[]> {
  const results: ScanServer[] = []
  await Promise.allSettled(
    ports.map(async (entry) => {
      const server = await probe(host, entry.port, guessServerName(host, entry.port))
      if (server && !seen.has(server.url)) {
        seen.add(server.url)
        results.push(server)
      }
    }),
  )
  return results
}

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
        ensureLocalFirstProviders(allProviders)
        const filteredProviders = filterProviders(allProviders, disabled, enabled)

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
          host: z.string().optional().meta({ description: "Remote hostname or IP to probe" }),
        }),
      ),
      async (c) => {
        const { host } = c.req.valid("json")
        log.info("scan requested", { remote: host ?? null })

        const seen = new Set<string>()
        const servers = await scanPorts("localhost", KNOWN_PORTS, seen)
        log.debug("local scan complete", { found: servers.length })

        if (host) {
          const remoteHost = host.trim()
          if (!isValidRemoteHost(remoteHost)) {
            log.warn("rejected invalid or blocked remote host", { host: remoteHost })
            return c.json({ error: "Invalid remote host" }, 400)
          }
          const remotePorts = [4000, 11434, 8000, 8080, 3000, 5000].map((port) => ({
            port,
            name: guessServerName(remoteHost, port),
          }))
          const remoteServers = await scanPorts(remoteHost, remotePorts, seen)
          servers.push(...remoteServers)
          log.debug("remote scan complete", { host: remoteHost, found: servers.length })
        }

        return c.json(servers)
      },
    ),
)
