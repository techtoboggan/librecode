import z from "zod"
import { Agent } from "@/agent/agent"
import { Bus } from "@/bus"
import { BusEvent } from "@/bus/bus-event"
import { Config } from "@/config/config"
import { Plugin } from "@/plugin"
import { ModelID, ProviderID } from "@/provider/schema"
import { ProviderTransform } from "@/provider/transform"
import { fn } from "@/util/fn"
import { Instance } from "../project/instance"
import { Provider } from "../provider/provider"
import { Log } from "../util/log"
import { Token } from "../util/token"
import { Session } from "."
import { MessageV2 } from "./message-v2"
import { SessionProcessor } from "./processor"
import { MessageID, PartID, SessionID } from "./schema"

export namespace SessionCompaction {
  const log = Log.create({ service: "session.compaction" })

  export const Event = {
    Compacted: BusEvent.define(
      "session.compacted",
      z.object({
        sessionID: SessionID.zod,
      }),
    ),
  }

  const COMPACTION_BUFFER = 20_000

  export async function isOverflow(input: { tokens: MessageV2.Assistant["tokens"]; model: Provider.Model }) {
    const config = await Config.get()
    if (config.compaction?.auto === false) return false
    const context = input.model.limit.context
    if (context === 0) return false

    const count =
      input.tokens.total ||
      input.tokens.input + input.tokens.output + input.tokens.cache.read + input.tokens.cache.write

    const reserved =
      config.compaction?.reserved ?? Math.min(COMPACTION_BUFFER, ProviderTransform.maxOutputTokens(input.model))
    const usable = input.model.limit.input
      ? input.model.limit.input - reserved
      : context - ProviderTransform.maxOutputTokens(input.model)
    return count >= usable
  }

  export const PRUNE_MINIMUM = 20_000
  export const PRUNE_PROTECT = 40_000

  const PRUNE_PROTECTED_TOOLS = ["skill"]

  // Scan one message's parts backwards, accumulating prune candidates.
  // Returns true if the outer loop should stop (hit a compacted marker).
  function scanMsgPartsForPrune(
    msg: MessageV2.WithParts,
    state: { total: number; pruned: number; toPrune: MessageV2.ToolPart[] },
  ): boolean {
    for (let partIndex = msg.parts.length - 1; partIndex >= 0; partIndex--) {
      const part = msg.parts[partIndex]
      if (part.type !== "tool") continue
      if (part.state.status !== "completed") continue
      if (PRUNE_PROTECTED_TOOLS.includes(part.tool)) continue
      if (part.state.time.compacted) return true
      const estimate = Token.estimate(part.state.output)
      state.total += estimate
      if (state.total > PRUNE_PROTECT) {
        state.pruned += estimate
        state.toPrune.push(part)
      }
    }
    return false
  }

  // Collect tool parts eligible for pruning (those beyond the PRUNE_PROTECT token budget)
  // Returns { toPrune, pruned, total } from a backwards scan starting at msgIndex.
  function collectPruneCandidates(msgs: MessageV2.WithParts[]): {
    toPrune: MessageV2.ToolPart[]
    pruned: number
    total: number
  } {
    const state = { toPrune: [] as MessageV2.ToolPart[], total: 0, pruned: 0 }
    let turns = 0

    for (let msgIndex = msgs.length - 1; msgIndex >= 0; msgIndex--) {
      const msg = msgs[msgIndex]
      if (msg.info.role === "user") turns++
      if (turns < 2) continue
      if (msg.info.role === "assistant" && msg.info.summary) break
      if (scanMsgPartsForPrune(msg, state)) break
    }

    return state
  }

  // goes backwards through parts until there are 40_000 tokens worth of tool
  // calls. then erases output of previous tool calls. idea is to throw away old
  // tool calls that are no longer relevant.
  export async function prune(input: { sessionID: SessionID }) {
    const config = await Config.get()
    if (config.compaction?.prune === false) return
    log.info("pruning")
    const msgs = await Session.messages({ sessionID: input.sessionID })
    const { toPrune, pruned, total } = collectPruneCandidates(msgs)
    log.info("found", { pruned, total })
    if (pruned > PRUNE_MINIMUM) {
      for (const part of toPrune) {
        if (part.state.status === "completed") {
          part.state.time.compacted = Date.now()
          await Session.updatePart(part)
        }
      }
      log.info("pruned", { count: toPrune.length })
    }
  }

  // Find the replay message and trim messages list for overflow compaction.
  // Returns { replay, messages } where replay is the message to re-send after compaction.
  function resolveOverflowReplay(
    messages: MessageV2.WithParts[],
    parentID: MessageID,
  ): { replay: MessageV2.WithParts | undefined; messages: MessageV2.WithParts[] } {
    const idx = messages.findIndex((m) => m.info.id === parentID)
    let replay: MessageV2.WithParts | undefined

    for (let i = idx - 1; i >= 0; i--) {
      const msg = messages[i]
      if (msg.info.role === "user" && !msg.parts.some((p) => p.type === "compaction")) {
        replay = msg
        messages = messages.slice(0, i)
        break
      }
    }

    const hasContent =
      replay && messages.some((m) => m.info.role === "user" && !m.parts.some((p) => p.type === "compaction"))
    if (!hasContent) {
      return { replay: undefined, messages }
    }

    return { replay, messages }
  }

  // Build the compaction prompt text from plugin context and default template
  async function buildCompactionPrompt(sessionID: SessionID): Promise<string> {
    const compacting = await Plugin.trigger(
      "experimental.session.compacting",
      { sessionID },
      { context: [], prompt: undefined },
    )
    const defaultPrompt = `Provide a detailed prompt for continuing our conversation above.
Focus on information that would be helpful for continuing the conversation, including what we did, what we're doing, which files we're working on, and what we're going to do next.
The summary that you construct will be used so that another agent can read it and continue the work.

When constructing the summary, try to stick to this template:
---
## Goal

[What goal(s) is the user trying to accomplish?]

## Instructions

- [What important instructions did the user give you that are relevant]
- [If there is a plan or spec, include information about it so next agent can continue using it]

## Discoveries

[What notable things were learned during this conversation that would be useful for the next agent to know when continuing the work]

## Accomplished

[What work has been completed, what work is still in progress, and what work is left?]

## Relevant files / directories

[Construct a structured list of relevant files that have been read, edited, or created that pertain to the task at hand. If all the files in a directory are relevant, include the path to the directory.]
---`

    return compacting.prompt ?? [defaultPrompt, ...compacting.context].join("\n\n")
  }

  // Replay a user message after compaction, stripping media and compaction parts
  async function replayUserMessage(replay: MessageV2.WithParts, sessionID: SessionID): Promise<void> {
    const original = replay.info as MessageV2.User
    const replayMsg = await Session.updateMessage({
      id: MessageID.ascending(),
      role: "user",
      sessionID,
      time: { created: Date.now() },
      agent: original.agent,
      model: original.model,
      format: original.format,
      tools: original.tools,
      system: original.system,
      variant: original.variant,
    })
    for (const part of replay.parts) {
      if (part.type === "compaction") continue
      const replayPart =
        part.type === "file" && MessageV2.isMedia(part.mime)
          ? { type: "text" as const, text: `[Attached ${part.mime}: ${part.filename ?? "file"}]` }
          : part
      await Session.updatePart({
        ...replayPart,
        id: PartID.ascending(),
        messageID: replayMsg.id,
        sessionID,
      })
    }
  }

  // Inject a synthetic "continue" message after compaction when there is no replay message
  async function injectContinueMessage(
    sessionID: SessionID,
    userMessage: MessageV2.User,
    overflow: boolean | undefined,
  ): Promise<void> {
    const continueMsg = await Session.updateMessage({
      id: MessageID.ascending(),
      role: "user",
      sessionID,
      time: { created: Date.now() },
      agent: userMessage.agent,
      model: userMessage.model,
    })
    const text =
      `${overflow
        ? "The previous request exceeded the provider's size limit due to large media attachments. The conversation was compacted and media files were removed from context. If the user was asking about attached images or files, explain that the attachments were too large to process and suggest they try again with smaller or fewer files.\n\n"
        : ""}Continue if you have next steps, or stop and ask for clarification if you are unsure how to proceed.`
    await Session.updatePart({
      id: PartID.ascending(),
      messageID: continueMsg.id,
      sessionID,
      type: "text",
      synthetic: true,
      text,
      time: {
        start: Date.now(),
        end: Date.now(),
      },
    })
  }

  export async function process(input: {
    parentID: MessageID
    messages: MessageV2.WithParts[]
    sessionID: SessionID
    abort: AbortSignal
    auto: boolean
    overflow?: boolean
  }) {
    const userMessage = input.messages.findLast((m) => m.info.id === input.parentID)?.info as MessageV2.User

    let messages = input.messages
    let replay: MessageV2.WithParts | undefined

    if (input.overflow) {
      const resolved = resolveOverflowReplay(input.messages, input.parentID)
      replay = resolved.replay
      messages = resolved.messages
    }

    const agent = await Agent.get("compaction")
    if (!agent) throw new Error("compaction agent not found")
    const model = agent.model
      ? await Provider.getModel(agent.model.providerID, agent.model.modelID)
      : await Provider.getModel(userMessage.model.providerID, userMessage.model.modelID)

    const msg = (await Session.updateMessage({
      id: MessageID.ascending(),
      role: "assistant",
      parentID: input.parentID,
      sessionID: input.sessionID,
      mode: "compaction",
      agent: "compaction",
      variant: userMessage.variant,
      summary: true,
      path: {
        cwd: Instance.directory,
        root: Instance.worktree,
      },
      cost: 0,
      tokens: {
        output: 0,
        input: 0,
        reasoning: 0,
        cache: { read: 0, write: 0 },
      },
      modelID: model.id,
      providerID: model.providerID,
      time: {
        created: Date.now(),
      },
    })) as MessageV2.Assistant

    const processor = SessionProcessor.create({
      assistantMessage: msg,
      sessionID: input.sessionID,
      model,
      abort: input.abort,
    })

    const promptText = await buildCompactionPrompt(input.sessionID)
    const result = await processor.process({
      user: userMessage,
      agent,
      abort: input.abort,
      sessionID: input.sessionID,
      tools: {},
      system: [],
      messages: [
        ...MessageV2.toModelMessages(messages, model, { stripMedia: true }),
        {
          role: "user",
          content: [{ type: "text", text: promptText }],
        },
      ],
      model,
    })

    if (result === "compact") {
      processor.message.error = new MessageV2.ContextOverflowError({
        message: replay
          ? "Conversation history too large to compact - exceeds model context limit"
          : "Session too large to compact - context exceeds model limit even after stripping media",
      }).toObject()
      processor.message.finish = "error"
      await Session.updateMessage(processor.message)
      return "stop"
    }

    if (result === "continue" && input.auto) {
      if (replay) {
        await replayUserMessage(replay, input.sessionID)
      } else {
        await injectContinueMessage(input.sessionID, userMessage, input.overflow)
      }
    }

    if (processor.message.error) return "stop"
    Bus.publish(Event.Compacted, { sessionID: input.sessionID })
    return "continue"
  }

  export const create = fn(
    z.object({
      sessionID: SessionID.zod,
      agent: z.string(),
      model: z.object({
        providerID: ProviderID.zod,
        modelID: ModelID.zod,
      }),
      auto: z.boolean(),
      overflow: z.boolean().optional(),
    }),
    async (input) => {
      const msg = await Session.updateMessage({
        id: MessageID.ascending(),
        role: "user",
        model: input.model,
        sessionID: input.sessionID,
        agent: input.agent,
        time: {
          created: Date.now(),
        },
      })
      await Session.updatePart({
        id: PartID.ascending(),
        messageID: msg.id,
        sessionID: msg.sessionID,
        type: "compaction",
        auto: input.auto,
        overflow: input.overflow,
      })
    },
  )
}
