/**
 * v0.9.53 — server-side implementation of `sampling/createMessage`.
 *
 * The host runs the actual LLM inference on the user's account; the
 * iframe never sees credentials. We gate every call behind the same
 * permission system used for tool calls (so "Allow once" / "Allow for
 * this session" work identically), enforce a per-server hourly USD
 * cap, and record the settled cost against the rolling-window ledger
 * in `sampling-ledger.ts`.
 *
 * The MCP spec's CreateMessageResult fields we must return are:
 *   {model, role, content, stopReason}
 * Plus optional `_meta`, which we use to surface cost + remaining
 * headroom so the client can update its display without a follow-up
 * round trip.
 */
import { generateText, type ModelMessage } from "ai"
import { Provider } from "../provider/provider"
import { Session } from "../session"
import type { SessionID } from "../session/schema"
import {
  type CapCheckResult,
  DEFAULT_SAMPLING_HOURLY_USD_CAP,
  checkSamplingCap,
  recordSamplingCost,
  totalSamplingCostUsd,
} from "./sampling-ledger"

export interface SamplingContentText {
  type: "text"
  text: string
}
export interface SamplingMessage {
  role: "user" | "assistant"
  content: SamplingContentText | SamplingContentText[]
}

export interface SamplingInput {
  sessionID: SessionID
  server: string
  uri: string
  systemPrompt?: string
  messages: SamplingMessage[]
  maxTokens: number
  temperature?: number
  stopSequences?: string[]
  /** Per-server hourly cap in USD. Pass undefined to use DEFAULT_SAMPLING_HOURLY_USD_CAP. */
  capUsd?: number
}

export interface SamplingOutput {
  model: string
  role: "assistant"
  content: SamplingContentText
  stopReason?: string
  _meta: {
    costUsd: number
    remainingUsd: number
    windowUsdTotal: number
    capUsd: number
  }
}

export interface SamplingErrorResult {
  isError: true
  error: string
  _meta?: { reason: "cap_exceeded"; remainingUsd: number; capUsd: number }
}

/** Convert MCP-shaped sampling messages into AI-SDK ModelMessages. */
function toModelMessages(messages: SamplingMessage[]): ModelMessage[] {
  return messages.map((m) => {
    const blocks = Array.isArray(m.content) ? m.content : [m.content]
    const text = blocks
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("\n")
    return { role: m.role, content: text } satisfies ModelMessage
  })
}

/**
 * Upper-bound pre-call cost estimate: maxTokens × output-price + a
 * generous input-price term. We never let a request through unless
 * even this worst case fits in the remaining headroom.
 */
function estimatePreCallCost(model: Provider.Model, input: Pick<SamplingInput, "maxTokens" | "messages">): number {
  const outputCostPerMillion = model.cost?.output ?? 0
  const inputCostPerMillion = model.cost?.input ?? 0
  const rawChars = input.messages.reduce((sum, m) => {
    const blocks = Array.isArray(m.content) ? m.content : [m.content]
    return sum + blocks.reduce((bs, b) => bs + (b.type === "text" ? b.text.length : 0), 0)
  }, 0)
  // Cheap token estimate: ~4 chars/token. Over-counts for English;
  // that's fine — the cap is an upper bound.
  const inputTokens = Math.ceil(rawChars / 4)
  return (inputTokens * inputCostPerMillion + input.maxTokens * outputCostPerMillion) / 1_000_000
}

/**
 * Resolve the model to sample with: prefer the session's last user
 * model, fall back to the project default. Never silently substitute
 * a different provider — raises if the model can't be loaded.
 */
async function resolveSessionModel(sessionID: SessionID): Promise<Provider.Model> {
  const history = await Session.messages({ sessionID })
  const lastUser = history.findLast((m) => m.info.role === "user")?.info
  if (lastUser && lastUser.role === "user") {
    return Provider.getModel(lastUser.model.providerID, lastUser.model.modelID)
  }
  const fallback = await Provider.defaultModel()
  return Provider.getModel(fallback.providerID, fallback.modelID)
}

/**
 * Pre-call cap check. Returns the result untouched from
 * `checkSamplingCap`; the caller turns an `ok: false` into an
 * SamplingErrorResult with the structured reason.
 */
export function guardCapBeforeCall(input: {
  server: string
  capUsd: number | undefined
  proposedCostUsd: number
}): CapCheckResult {
  const capUsd = input.capUsd ?? DEFAULT_SAMPLING_HOURLY_USD_CAP
  return checkSamplingCap({ server: input.server, capUsd, proposedCostUsd: input.proposedCostUsd })
}

/**
 * Run the sampling call end-to-end. Caller is responsible for the
 * permission gate — this function assumes permission has already
 * been granted.
 */
export async function performSampling(input: SamplingInput): Promise<SamplingOutput | SamplingErrorResult> {
  const model = await resolveSessionModel(input.sessionID)
  const language = await Provider.getLanguage(model)

  const proposedCostUsd = estimatePreCallCost(model, input)
  const capUsd = input.capUsd ?? DEFAULT_SAMPLING_HOURLY_USD_CAP
  const guard = guardCapBeforeCall({ server: input.server, capUsd, proposedCostUsd })
  if (!guard.ok) {
    return {
      isError: true,
      error: guard.reason,
      _meta: { reason: "cap_exceeded", remainingUsd: guard.remainingUsd, capUsd },
    }
  }

  const result = await generateText({
    model: language,
    system: input.systemPrompt,
    messages: toModelMessages(input.messages),
    maxOutputTokens: input.maxTokens,
    temperature: input.temperature,
    stopSequences: input.stopSequences,
  })

  const usage = Session.getUsage({ model, usage: result.usage, metadata: result.providerMetadata })
  recordSamplingCost(input.server, usage.cost)
  const windowUsdTotal = totalSamplingCostUsd(input.server)

  return {
    model: `${model.providerID}/${model.id}`,
    role: "assistant",
    content: { type: "text", text: result.text },
    stopReason: mapFinishReason(result.finishReason),
    _meta: {
      costUsd: usage.cost,
      remainingUsd: Math.max(0, capUsd - windowUsdTotal),
      windowUsdTotal,
      capUsd,
    },
  }
}

/** Translate the AI-SDK finishReason into the MCP stopReason vocabulary. */
function mapFinishReason(reason: string | undefined): string | undefined {
  if (!reason) return undefined
  if (reason === "stop") return "endTurn"
  if (reason === "length") return "maxTokens"
  if (reason === "stop-sequence") return "stopSequence"
  // "tool-calls" / "content-filter" / "error" / "unknown" — pass through.
  return reason
}

// Exposed for tests: the pure helpers have no dependency on the
// Provider/Instance machinery so we can cover them without standing up
// a real project.
export const _testing = {
  mapFinishReason,
  estimatePreCallCost,
  toModelMessages,
} as const
