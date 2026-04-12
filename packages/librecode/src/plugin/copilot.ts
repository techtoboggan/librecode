import { setTimeout as sleep } from "node:timers/promises"
import type { Hooks, PluginInput } from "@librecode/plugin"
import { Installation } from "@/installation"

const CLIENT_ID = "Ov23li8tweQw6odWQebz"
// Add a small safety buffer when polling to avoid hitting the server
// slightly too early due to clock skew / timer drift.
const OAUTH_POLLING_SAFETY_MARGIN_MS = 3000 // 3 seconds
function normalizeDomain(url: string) {
  return url.replace(/^https?:\/\//, "").replace(/\/$/, "")
}

function getUrls(domain: string) {
  return {
    DEVICE_CODE_URL: `https://${domain}/login/device/code`,
    ACCESS_TOKEN_URL: `https://${domain}/login/oauth/access_token`,
  }
}

interface CopilotRequestFlags {
  isVision: boolean
  isAgent: boolean
}

function parseCompletionsFlags(
  body: { messages: Array<{ role?: string; content?: unknown }> },
  url: string,
): CopilotRequestFlags | null {
  if (!body?.messages || !url.includes("completions")) return null
  const last = body.messages[body.messages.length - 1]
  return {
    isVision: body.messages.some(
      (msg) =>
        Array.isArray(msg.content) &&
        (msg.content as Array<{ type: string }>).some((part) => part.type === "image_url"),
    ),
    isAgent: last?.role !== "user",
  }
}

function parseResponsesFlags(body: { input: Array<{ role?: string; content?: unknown }> }): CopilotRequestFlags | null {
  if (!body?.input) return null
  const last = body.input[body.input.length - 1]
  return {
    isVision: body.input.some(
      (item) =>
        Array.isArray(item?.content) &&
        (item.content as Array<{ type: string }>).some((part) => part.type === "input_image"),
    ),
    isAgent: (last as { role?: string })?.role !== "user",
  }
}

function parseMessagesFlags(body: { messages: Array<{ role?: string; content?: unknown }> }): CopilotRequestFlags {
  const last = body.messages[body.messages.length - 1]
  const hasNonToolCalls =
    Array.isArray(last?.content) &&
    (last.content as Array<{ type: string }>).some((part) => part?.type !== "tool_result")
  return {
    isVision: body.messages.some(
      (item) =>
        Array.isArray(item?.content) &&
        (item.content as Array<{ type: string; content?: Array<{ type: string }> }>).some(
          (part) =>
            part?.type === "image" ||
            (part?.type === "tool_result" &&
              Array.isArray(part?.content) &&
              part.content.some((n) => n?.type === "image")),
        ),
    ),
    isAgent: !(last?.role === "user" && hasNonToolCalls),
  }
}

function parseCopilotRequestFlags(url: string, init: RequestInit | undefined): CopilotRequestFlags {
  try {
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : init?.body
    const completions = parseCompletionsFlags(body, url)
    if (completions) return completions
    const responses = parseResponsesFlags(body)
    if (responses) return responses
    if (body?.messages) return parseMessagesFlags(body)
  } catch {}
  return { isVision: false, isAgent: false }
}

interface CopilotSuccessResult {
  type: "success"
  refresh: string
  access: string
  expires: number
  provider?: string
  enterpriseUrl?: string
}

function computeSlowDownInterval(serverInterval: number | undefined, baseInterval: number): number {
  if (serverInterval && typeof serverInterval === "number" && serverInterval > 0) return serverInterval * 1000
  return (baseInterval + 5) * 1000
}

function buildSuccessResult(accessToken: string, actualProvider: string, domain: string): CopilotSuccessResult {
  const result: CopilotSuccessResult = { type: "success", refresh: accessToken, access: accessToken, expires: 0 }
  if (actualProvider === "github-copilot-enterprise") {
    result.provider = "github-copilot-enterprise"
    result.enterpriseUrl = domain
  }
  return result
}

type PollAction =
  | { action: "return"; result: CopilotSuccessResult | { type: "failed" } }
  | { action: "sleep"; ms: number }

function interpretPollResponse(
  data: { access_token?: string; error?: string; interval?: number },
  baseInterval: number,
  actualProvider: string,
  domain: string,
): PollAction {
  if (data.access_token) {
    return { action: "return", result: buildSuccessResult(data.access_token, actualProvider, domain) }
  }
  if (data.error === "authorization_pending") {
    return { action: "sleep", ms: baseInterval * 1000 + OAUTH_POLLING_SAFETY_MARGIN_MS }
  }
  if (data.error === "slow_down") {
    // Based on the RFC spec, we must add 5 seconds to our current polling interval.
    // (See https://www.rfc-editor.org/rfc/rfc8628#section-3.5)
    return {
      action: "sleep",
      ms: computeSlowDownInterval(data.interval, baseInterval) + OAUTH_POLLING_SAFETY_MARGIN_MS,
    }
  }
  if (data.error) return { action: "return", result: { type: "failed" as const } }
  return { action: "sleep", ms: baseInterval * 1000 + OAUTH_POLLING_SAFETY_MARGIN_MS }
}

async function pollForCopilotToken(
  accessTokenUrl: string,
  deviceCode: string,
  baseInterval: number,
  actualProvider: string,
  domain: string,
): Promise<CopilotSuccessResult | { type: "failed" }> {
  while (true) {
    const response = await fetch(accessTokenUrl, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "User-Agent": `librecode/${Installation.VERSION}`,
      },
      body: JSON.stringify({
        client_id: CLIENT_ID,
        device_code: deviceCode,
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      }),
    })

    if (!response.ok) return { type: "failed" as const }

    const data = (await response.json()) as { access_token?: string; error?: string; interval?: number }
    const action = interpretPollResponse(data, baseInterval, actualProvider, domain)
    if (action.action === "return") return action.result
    await sleep(action.ms)
  }
}

export async function CopilotAuthPlugin(input: PluginInput): Promise<Hooks> {
  const sdk = input.client
  return {
    auth: {
      provider: "github-copilot",
      async loader(getAuth, provider) {
        const info = await getAuth()
        if (!info || info.type !== "oauth") return {}

        const enterpriseUrl = info.enterpriseUrl
        const baseURL = enterpriseUrl ? `https://copilot-api.${normalizeDomain(enterpriseUrl)}` : undefined

        if (provider?.models) {
          for (const model of Object.values(provider.models)) {
            model.cost = {
              input: 0,
              output: 0,
              cache: {
                read: 0,
                write: 0,
              },
            }

            // TODO: re-enable once messages api has higher rate limits
            // TODO: move some of this hacky-ness to models.dev presets once we have better grasp of things here...
            // const base = baseURL ?? model.api.url
            // const claude = model.id.includes("claude")
            // const url = iife(() => {
            //   if (!claude) return base
            //   if (base.endsWith("/v1")) return base
            //   if (base.endsWith("/")) return `${base}v1`
            //   return `${base}/v1`
            // })

            // model.api.url = url
            // model.api.npm = claude ? "@ai-sdk/anthropic" : "@ai-sdk/github-copilot"
            model.api.npm = "@ai-sdk/github-copilot"
          }
        }

        return {
          baseURL,
          apiKey: "",
          async fetch(request: RequestInfo | URL, init?: RequestInit) {
            const info = await getAuth()
            if (info.type !== "oauth") return fetch(request, init)

            const url = request instanceof URL ? request.href : request.toString()
            const { isVision, isAgent } = parseCopilotRequestFlags(url, init)

            const headers: Record<string, string> = {
              "x-initiator": isAgent ? "agent" : "user",
              ...(init?.headers as Record<string, string>),
              "User-Agent": `librecode/${Installation.VERSION}`,
              Authorization: `Bearer ${info.refresh}`,
              "Openai-Intent": "conversation-edits",
            }

            if (isVision) headers["Copilot-Vision-Request"] = "true"
            delete headers["x-api-key"]
            delete headers.authorization

            return fetch(request, { ...init, headers })
          },
        }
      },
      methods: [
        {
          type: "oauth",
          label: "Login with GitHub Copilot",
          prompts: [
            {
              type: "select",
              key: "deploymentType",
              message: "Select GitHub deployment type",
              options: [
                {
                  label: "GitHub.com",
                  value: "github.com",
                  hint: "Public",
                },
                {
                  label: "GitHub Enterprise",
                  value: "enterprise",
                  hint: "Data residency or self-hosted",
                },
              ],
            },
            {
              type: "text",
              key: "enterpriseUrl",
              message: "Enter your GitHub Enterprise URL or domain",
              placeholder: "company.ghe.com or https://company.ghe.com",
              condition: (inputs) => inputs.deploymentType === "enterprise",
              validate: (value) => {
                if (!value) return "URL or domain is required"
                try {
                  const url = value.includes("://") ? new URL(value) : new URL(`https://${value}`)
                  if (!url.hostname) return "Please enter a valid URL or domain"
                  return undefined
                } catch {
                  return "Please enter a valid URL (e.g., company.ghe.com or https://company.ghe.com)"
                }
              },
            },
          ],
          async authorize(inputs = {}) {
            const deploymentType = inputs.deploymentType || "github.com"

            let domain = "github.com"
            let actualProvider = "github-copilot"

            if (deploymentType === "enterprise") {
              const enterpriseUrl = inputs.enterpriseUrl
              // biome-ignore lint/style/noNonNullAssertion: enterpriseUrl is required when deploymentType === "enterprise"
              domain = normalizeDomain(enterpriseUrl!)
              actualProvider = "github-copilot-enterprise"
            }

            const urls = getUrls(domain)

            const deviceResponse = await fetch(urls.DEVICE_CODE_URL, {
              method: "POST",
              headers: {
                Accept: "application/json",
                "Content-Type": "application/json",
                "User-Agent": `librecode/${Installation.VERSION}`,
              },
              body: JSON.stringify({
                client_id: CLIENT_ID,
                scope: "read:user",
              }),
            })

            if (!deviceResponse.ok) {
              throw new Error("Failed to initiate device authorization")
            }

            const deviceData = (await deviceResponse.json()) as {
              verification_uri: string
              user_code: string
              device_code: string
              interval: number
            }

            return {
              url: deviceData.verification_uri,
              instructions: `Enter code: ${deviceData.user_code}`,
              method: "auto" as const,
              callback: () =>
                pollForCopilotToken(
                  urls.ACCESS_TOKEN_URL,
                  deviceData.device_code,
                  deviceData.interval,
                  actualProvider,
                  domain,
                ),
            }
          },
        },
      ],
    },
    "chat.headers": async (incoming, output) => {
      if (!incoming.model.providerID.includes("github-copilot")) return

      if (incoming.model.api.npm === "@ai-sdk/anthropic") {
        output.headers["anthropic-beta"] = "interleaved-thinking-2025-05-14"
      }

      const parts = await sdk.session
        .message({
          path: {
            id: incoming.message.sessionID,
            messageID: incoming.message.id,
          },
          query: {
            directory: input.directory,
          },
          throwOnError: true,
        })
        .catch(() => undefined)

      if (parts?.data.parts?.some((part) => part.type === "compaction")) {
        output.headers["x-initiator"] = "agent"
        return
      }

      const session = await sdk.session
        .get({
          path: {
            id: incoming.sessionID,
          },
          query: {
            directory: input.directory,
          },
          throwOnError: true,
        })
        .catch(() => undefined)
      if (!session?.data.parentID) return
      // mark subagent sessions as agent initiated matching standard that other copilot tools have
      output.headers["x-initiator"] = "agent"
    },
  }
}
