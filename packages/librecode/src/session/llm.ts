import {
  jsonSchema,
  type ModelMessage,
  type StreamTextResult,
  streamText,
  type Tool,
  type ToolSet,
  tool,
  wrapLanguageModel,
} from "ai"
import { mergeDeep, pipe } from "remeda"
import type { AgentInfo } from "@/agent/agent"
import { Auth } from "@/auth"
import { Config } from "@/config/config"
import { Installation } from "@/installation"
import { PermissionNext } from "@/permission/next"
import { Plugin } from "@/plugin"
import { Provider } from "@/provider/provider"
import { ProviderTransform } from "@/provider/transform"
import { Log } from "@/util/log"
import type { MessageV2 } from "./message-v2"
import { SystemPrompt } from "./system"

// ---------------------------------------------------------------------------
// Module-level helpers (extracted to reduce stream() complexity)
// ---------------------------------------------------------------------------

const llmLog = Log.create({ service: "llm" })
export const LLM_OUTPUT_TOKEN_MAX = ProviderTransform.OUTPUT_TOKEN_MAX

export type LLMStreamInput = {
  user: MessageV2.User
  sessionID: string
  model: Provider.Model
  agent: AgentInfo
  system: string[]
  abort: AbortSignal
  messages: ModelMessage[]
  small?: boolean
  tools: Record<string, Tool>
  retries?: number
  toolChoice?: "auto" | "required" | "none"
}

export type LLMStreamOutput = StreamTextResult<ToolSet, unknown>

type ProviderInfo = NonNullable<Awaited<ReturnType<typeof Provider.getProvider>>>

async function buildSystemPrompt(
  input: Pick<LLMStreamInput, "sessionID" | "model" | "agent" | "user" | "system">,
  isCodex: boolean,
): Promise<string[]> {
  const system: string[] = []
  system.push(
    [
      ...(input.agent.prompt ? [input.agent.prompt] : isCodex ? [] : SystemPrompt.provider(input.model)),
      ...input.system,
      ...(input.user.system ? [input.user.system] : []),
    ]
      .filter((x) => x)
      .join("\n"),
  )

  const header = system[0]
  await Plugin.trigger(
    "experimental.chat.system.transform",
    { sessionID: input.sessionID, model: input.model },
    { system },
  )
  // rejoin to maintain 2-part structure for caching if header unchanged
  if (system.length > 2 && system[0] === header) {
    const rest = system.slice(1)
    system.length = 0
    system.push(header, rest.join("\n"))
  }
  return system
}

function buildModelOptions(
  input: Pick<LLMStreamInput, "sessionID" | "model" | "agent" | "user" | "small">,
  provider: ProviderInfo,
  isCodex: boolean,
): Record<string, unknown> {
  const variant =
    !input.small && input.model.variants && input.user.variant ? input.model.variants[input.user.variant] : {}
  const base = input.small
    ? ProviderTransform.smallOptions(input.model)
    : ProviderTransform.options({ model: input.model, sessionID: input.sessionID, providerOptions: provider.options })
  const options: Record<string, unknown> = pipe(
    base,
    mergeDeep(input.model.options),
    mergeDeep(input.agent.options),
    mergeDeep(variant),
  )
  if (isCodex) options.instructions = SystemPrompt.instructions()
  return options
}

function injectLiteLLMNoop(
  provider: ProviderInfo,
  input: Pick<LLMStreamInput, "model" | "messages">,
  tools: Record<string, Tool>,
): void {
  const isLiteLLMProxy =
    provider.options?.litellmProxy === true ||
    input.model.providerID.toLowerCase().includes("litellm") ||
    input.model.api.id.toLowerCase().includes("litellm")

  if (!isLiteLLMProxy || Object.keys(tools).length !== 0 || !llmHasToolCalls(input.messages)) return

  // LiteLLM and some Anthropic proxies require the tools parameter to be present
  // when message history contains tool calls, even if no tools are being used.
  tools._noop = tool({
    description:
      "Placeholder for LiteLLM/Anthropic proxy compatibility - required when message history contains tool calls but no active tools are needed",
    inputSchema: jsonSchema({ type: "object", properties: {} }),
    execute: async () => ({ output: "", title: "", metadata: {} }),
  })
}

async function resolveTools(input: Pick<LLMStreamInput, "tools" | "agent" | "user">): Promise<Record<string, Tool>> {
  const disabled = PermissionNext.disabled(Object.keys(input.tools), input.agent.permission)
  for (const t of Object.keys(input.tools)) {
    if (input.user.tools?.[t] === false || disabled.has(t)) {
      delete input.tools[t]
    }
  }
  return input.tools
}

export async function llmStream(input: LLMStreamInput): Promise<LLMStreamOutput> {
  const l = llmLog
    .clone()
    .tag("providerID", input.model.providerID)
    .tag("modelID", input.model.id)
    .tag("sessionID", input.sessionID)
    .tag("small", (input.small ?? false).toString())
    .tag("agent", input.agent.name)
    .tag("mode", input.agent.mode)
  l.info("stream", { modelID: input.model.id, providerID: input.model.providerID })

  const [language, cfg, providerOrUndefined, auth] = await Promise.all([
    Provider.getLanguage(input.model),
    Config.get(),
    Provider.getProvider(input.model.providerID),
    Auth.get(input.model.providerID),
  ])

  // v0.9.76 — initialise Phoenix telemetry pipeline if enabled.
  // initPhoenix is idempotent: same config = no-op, changed config =
  // shutdown old provider + reconfigure. Doing it here (just-in-time)
  // means users not running Phoenix never load the OTel SDK.
  if (cfg.telemetry?.phoenix?.enabled) {
    const { initPhoenix } = await import("../telemetry/phoenix")
    initPhoenix({
      enabled: true,
      endpoint: cfg.telemetry.phoenix.endpoint,
      projectName: cfg.telemetry.phoenix.projectName,
      apiKey: cfg.telemetry.phoenix.apiKey,
    })
  }

  if (!providerOrUndefined) throw new Error(`Provider not found: ${input.model.providerID}`)
  const provider: ProviderInfo = providerOrUndefined
  const isCodex = provider.id === "openai" && auth?.type === "oauth"

  const system = await buildSystemPrompt(input, isCodex)
  const options = buildModelOptions(input, provider, isCodex)

  const params = await Plugin.trigger(
    "chat.params",
    { sessionID: input.sessionID, agent: input.agent, model: input.model, provider, message: input.user },
    {
      temperature: input.model.capabilities.temperature
        ? (input.agent.temperature ?? ProviderTransform.temperature(input.model))
        : undefined,
      topP: input.agent.topP ?? ProviderTransform.topP(input.model),
      topK: ProviderTransform.topK(input.model),
      options,
    },
  )

  const { headers } = await Plugin.trigger(
    "chat.headers",
    { sessionID: input.sessionID, agent: input.agent, model: input.model, provider, message: input.user },
    { headers: {} },
  )

  const maxOutputTokens =
    isCodex || provider.id.includes("github-copilot") ? undefined : ProviderTransform.maxOutputTokens(input.model)

  const tools = await resolveTools(input)
  injectLiteLLMNoop(provider, input, tools)

  return streamText({
    onError(error) {
      l.error("stream error", { error })
    },
    async experimental_repairToolCall(failed) {
      const lower = failed.toolCall.toolName.toLowerCase()
      if (lower !== failed.toolCall.toolName && tools[lower]) {
        l.info("repairing tool call", { tool: failed.toolCall.toolName, repaired: lower })
        return { ...failed.toolCall, toolName: lower }
      }
      return {
        ...failed.toolCall,
        input: JSON.stringify({ tool: failed.toolCall.toolName, error: failed.error.message }),
        toolName: "invalid",
      }
    },
    temperature: params.temperature,
    topP: params.topP,
    topK: params.topK,
    providerOptions: ProviderTransform.providerOptions(input.model, params.options),
    activeTools: Object.keys(tools).filter((x) => x !== "invalid"),
    tools,
    toolChoice: input.toolChoice,
    maxOutputTokens,
    abortSignal: input.abort,
    headers: {
      ...(input.model.providerID !== "anthropic" ? { "User-Agent": `librecode/${Installation.VERSION}` } : undefined),
      ...input.model.headers,
      ...headers,
    },
    maxRetries: input.retries ?? 0,
    messages: [...system.map((x): ModelMessage => ({ role: "system", content: x })), ...input.messages],
    model: wrapLanguageModel({
      model: language,
      middleware: [
        {
          async transformParams(args) {
            if (args.type === "stream") {
              // @ts-expect-error
              args.params.prompt = ProviderTransform.message(args.params.prompt, input.model, options)
            }
            return args.params
          },
        },
      ],
    }),
    experimental_telemetry: {
      // v0.9.76 — Phoenix Arize integration. When telemetry.phoenix.enabled
      // is set in config, we flip on AI SDK telemetry so the OTel pipeline
      // wired in `telemetry/phoenix.ts` captures the gen_ai.* spans and
      // ships them to the user's local Phoenix instance. The original
      // experimental.openTelemetry flag remains a usable opt-in for users
      // who only want raw OTel without Phoenix's OpenInference rewriting.
      isEnabled: cfg.telemetry?.phoenix?.enabled === true || cfg.experimental?.openTelemetry === true,
      metadata: { userId: cfg.username ?? "unknown", sessionId: input.sessionID },
    },
  })
}

// Check if messages contain any tool-call content
// Used to determine if a dummy tool should be added for LiteLLM proxy compatibility
export function llmHasToolCalls(messages: ModelMessage[]): boolean {
  for (const msg of messages) {
    if (!Array.isArray(msg.content)) continue
    for (const part of msg.content) {
      if (part.type === "tool-call" || part.type === "tool-result") return true
    }
  }
  return false
}

export const LLM = {
  OUTPUT_TOKEN_MAX: LLM_OUTPUT_TOKEN_MAX,
  stream: llmStream,
  hasToolCalls: llmHasToolCalls,
} as const
// biome-ignore lint/style/noNamespace: type companion for declaration merging
export declare namespace LLM {
  type StreamInput = LLMStreamInput
  type StreamOutput = LLMStreamOutput
}
