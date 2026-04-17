import {
  type Agent as ACPAgent,
  type AgentSideConnection,
  type AuthenticateRequest,
  type AuthMethod,
  type CancelNotification,
  type ForkSessionRequest,
  type ForkSessionResponse,
  type InitializeRequest,
  type InitializeResponse,
  type ListSessionsRequest,
  type ListSessionsResponse,
  type LoadSessionRequest,
  type NewSessionRequest,
  type PromptRequest,
  RequestError,
  type ResumeSessionRequest,
  type ResumeSessionResponse,
  type SessionInfo,
  type SetSessionModelRequest,
  type SetSessionModeRequest,
  type SetSessionModeResponse,
  type Usage,
} from "@agentclientprotocol/sdk"
import type { AssistantMessage, Event, LibrecodeClient } from "@librecode/sdk/v2"
import { LoadAPIKeyError } from "ai"
import type { Config } from "@/config/config"
import { Installation } from "@/installation"
import { MessageV2 } from "@/session/message-v2"
import { Agent as AgentModule } from "../agent/agent"
import { ModelID, ProviderID } from "../provider/schema"
import { Log } from "../util/log"
import { AgentHandlers, sendUsageUpdate } from "./agent-handlers"
import {
  buildAvailableModels,
  buildPromptParts,
  buildVariantMeta,
  defaultModel,
  formatModelIdWithVariant,
  modelVariantsFromProviders,
  PERMISSION_OPTIONS,
  parseModelSelection,
  sortProvidersByName,
} from "./agent-types"
import { ACPSessionManager } from "./session"
import type { ACPConfig } from "./types"

const log = Log.create({ service: "acp-agent" })

type ModeOption = { id: string; name: string; description?: string }
type _ModelOption = { modelId: string; name: string }

async function acpInit({ sdk: _sdk }: { sdk: LibrecodeClient }) {
  return {
    create: (connection: AgentSideConnection, fullConfig: ACPConfig) => {
      return new ACPAgentImpl(connection, fullConfig)
    },
  }
}

export class ACPAgentImpl implements ACPAgent {
  private connection: AgentSideConnection
  private config: ACPConfig
  private sdk: LibrecodeClient
  private sessionManager: ACPSessionManager
  private eventAbort = new AbortController()
  private eventStarted = false
  private bashSnapshots = new Map<string, string>()
  private toolStarts = new Set<string>()
  private permissionQueues = new Map<string, Promise<void>>()
  private handlers: AgentHandlers

  constructor(connection: AgentSideConnection, config: ACPConfig) {
    this.connection = connection
    this.config = config
    this.sdk = config.sdk
    this.sessionManager = new ACPSessionManager(this.sdk)
    this.handlers = new AgentHandlers(
      connection,
      this.sdk,
      PERMISSION_OPTIONS,
      this.bashSnapshots,
      this.toolStarts,
      this.permissionQueues,
      (sessionID) => this.sessionManager.tryGet(sessionID),
    )
    this.startEventSubscription()
  }

  private startEventSubscription(): void {
    if (this.eventStarted) return
    this.eventStarted = true
    this.runEventSubscription().catch((error) => {
      if (this.eventAbort.signal.aborted) return
      log.error("event subscription failed", { error })
    })
  }

  private async runEventSubscription(): Promise<void> {
    while (true) {
      if (this.eventAbort.signal.aborted) return
      const events = await this.sdk.global.event({
        signal: this.eventAbort.signal,
      })
      for await (const event of events.stream) {
        if (this.eventAbort.signal.aborted) return
        const payload = (event as unknown as { payload?: Event })?.payload
        if (!payload) continue
        await this.handlers.handleEvent(payload).catch((error) => {
          log.error("failed to handle event", { error, type: payload.type })
        })
      }
    }
  }

  async initialize(params: InitializeRequest): Promise<InitializeResponse> {
    log.info("initialize", { protocolVersion: params.protocolVersion })

    const authMethod: AuthMethod = {
      description: "Run `librecode auth login` in the terminal",
      name: "Login with librecode",
      id: "librecode-login",
    }

    // If client supports terminal-auth capability, use that instead.
    if (params.clientCapabilities?._meta?.["terminal-auth"] === true) {
      authMethod._meta = {
        "terminal-auth": {
          command: "librecode",
          args: ["auth", "login"],
          label: "LibreCode Login",
        },
      }
    }

    return {
      protocolVersion: 1,
      agentCapabilities: {
        loadSession: true,
        mcpCapabilities: {
          http: true,
          sse: true,
        },
        promptCapabilities: {
          embeddedContext: true,
          image: true,
        },
        sessionCapabilities: {
          fork: {},
          list: {},
          resume: {},
        },
      },
      authMethods: [authMethod],
      agentInfo: {
        name: "LibreCode",
        version: Installation.VERSION,
      },
    }
  }

  async authenticate(_params: AuthenticateRequest): Promise<never> {
    throw new Error("Authentication not implemented")
  }

  async newSession(params: NewSessionRequest) {
    const directory = params.cwd
    try {
      const model = await defaultModel(this.config, directory)

      // Store ACP session state
      const state = await this.sessionManager.create(params.cwd, params.mcpServers, model)
      const sessionId = state.id

      log.info("creating_session", { sessionId, mcpServers: params.mcpServers.length })

      const load = await this.loadSessionMode({
        cwd: directory,
        mcpServers: params.mcpServers,
        sessionId,
      })

      return {
        sessionId,
        models: load.models,
        modes: load.modes,
        _meta: load._meta,
      }
    } catch (e) {
      const error = MessageV2.fromError(e, {
        providerID: ProviderID.make(this.config.defaultModel?.providerID ?? "unknown"),
      })
      if (LoadAPIKeyError.isInstance(error)) {
        throw RequestError.authRequired()
      }
      throw e
    }
  }

  async loadSession(params: LoadSessionRequest) {
    const directory = params.cwd
    const sessionId = params.sessionId

    try {
      const model = await defaultModel(this.config, directory)

      // Store ACP session state
      await this.sessionManager.load(sessionId, params.cwd, params.mcpServers, model)

      log.info("load_session", { sessionId, mcpServers: params.mcpServers.length })

      const result = await this.loadSessionMode({
        cwd: directory,
        mcpServers: params.mcpServers,
        sessionId,
      })

      // Replay session history
      const messages = await this.sdk.session
        .messages(
          {
            sessionID: sessionId,
            directory,
          },
          { throwOnError: true },
        )
        .then((x) => x.data)
        .catch((err) => {
          log.error("unexpected error when fetching message", { error: err })
          return undefined
        })

      const lastUser = messages?.findLast((m) => m.info.role === "user")?.info
      if (lastUser?.role === "user") {
        result.models.currentModelId = `${lastUser.model.providerID}/${lastUser.model.modelID}`
        this.sessionManager.setModel(sessionId, {
          providerID: ProviderID.make(lastUser.model.providerID),
          modelID: ModelID.make(lastUser.model.modelID),
        })
        if (result.modes?.availableModes.some((m) => m.id === lastUser.agent)) {
          result.modes.currentModeId = lastUser.agent
          this.sessionManager.setMode(sessionId, lastUser.agent)
        }
      }

      for (const msg of messages ?? []) {
        log.debug("replay message", msg)
        await this.handlers.processMessage(msg)
      }

      await sendUsageUpdate(this.connection, this.sdk, sessionId, directory)

      return result
    } catch (e) {
      const error = MessageV2.fromError(e, {
        providerID: ProviderID.make(this.config.defaultModel?.providerID ?? "unknown"),
      })
      if (LoadAPIKeyError.isInstance(error)) {
        throw RequestError.authRequired()
      }
      throw e
    }
  }

  async unstable_listSessions(params: ListSessionsRequest): Promise<ListSessionsResponse> {
    try {
      const cursor = params.cursor ? Number(params.cursor) : undefined
      const limit = 100

      const sessions = await this.sdk.session
        .list(
          {
            directory: params.cwd ?? undefined,
            roots: true,
          },
          { throwOnError: true },
        )
        .then((x) => x.data ?? [])

      const sorted = sessions.toSorted((a, b) => b.time.updated - a.time.updated)
      const filtered = cursor ? sorted.filter((s) => s.time.updated < cursor) : sorted
      const page = filtered.slice(0, limit)

      const entries: SessionInfo[] = page.map((session) => ({
        sessionId: session.id,
        cwd: session.directory,
        title: session.title,
        updatedAt: new Date(session.time.updated).toISOString(),
      }))

      const last = page[page.length - 1]
      const next = filtered.length > limit && last ? String(last.time.updated) : undefined

      const response: ListSessionsResponse = {
        sessions: entries,
      }
      if (next) response.nextCursor = next
      return response
    } catch (e) {
      const error = MessageV2.fromError(e, {
        providerID: ProviderID.make(this.config.defaultModel?.providerID ?? "unknown"),
      })
      if (LoadAPIKeyError.isInstance(error)) {
        throw RequestError.authRequired()
      }
      throw e
    }
  }

  async unstable_forkSession(params: ForkSessionRequest): Promise<ForkSessionResponse> {
    const directory = params.cwd
    const mcpServers = params.mcpServers ?? []

    try {
      const model = await defaultModel(this.config, directory)

      const forked = await this.sdk.session
        .fork(
          {
            sessionID: params.sessionId,
            directory,
          },
          { throwOnError: true },
        )
        .then((x) => x.data)

      if (!forked) {
        throw new Error("Fork session returned no data")
      }

      const sessionId = forked.id
      await this.sessionManager.load(sessionId, directory, mcpServers, model)

      log.info("fork_session", { sessionId, mcpServers: mcpServers.length })

      const mode = await this.loadSessionMode({
        cwd: directory,
        mcpServers,
        sessionId,
      })

      const messages = await this.sdk.session
        .messages(
          {
            sessionID: sessionId,
            directory,
          },
          { throwOnError: true },
        )
        .then((x) => x.data)
        .catch((err) => {
          log.error("unexpected error when fetching message", { error: err })
          return undefined
        })

      for (const msg of messages ?? []) {
        log.debug("replay message", msg)
        await this.handlers.processMessage(msg)
      }

      await sendUsageUpdate(this.connection, this.sdk, sessionId, directory)

      return mode
    } catch (e) {
      const error = MessageV2.fromError(e, {
        providerID: ProviderID.make(this.config.defaultModel?.providerID ?? "unknown"),
      })
      if (LoadAPIKeyError.isInstance(error)) {
        throw RequestError.authRequired()
      }
      throw e
    }
  }

  async unstable_resumeSession(params: ResumeSessionRequest): Promise<ResumeSessionResponse> {
    const directory = params.cwd
    const sessionId = params.sessionId
    const mcpServers = params.mcpServers ?? []

    try {
      const model = await defaultModel(this.config, directory)
      await this.sessionManager.load(sessionId, directory, mcpServers, model)

      log.info("resume_session", { sessionId, mcpServers: mcpServers.length })

      const result = await this.loadSessionMode({
        cwd: directory,
        mcpServers,
        sessionId,
      })

      await sendUsageUpdate(this.connection, this.sdk, sessionId, directory)

      return result
    } catch (e) {
      const error = MessageV2.fromError(e, {
        providerID: ProviderID.make(this.config.defaultModel?.providerID ?? "unknown"),
      })
      if (LoadAPIKeyError.isInstance(error)) {
        throw RequestError.authRequired()
      }
      throw e
    }
  }

  private async loadAvailableModes(directory: string): Promise<ModeOption[]> {
    const agents = await this.config.sdk.app
      .agents(
        {
          directory,
        },
        { throwOnError: true },
      )
      // biome-ignore lint/style/noNonNullAssertion: throwOnError guarantees data is present
      .then((resp) => resp.data!)

    return agents
      .filter((agent) => agent.mode !== "subagent" && !agent.hidden)
      .map((agent) => ({
        id: agent.name,
        name: agent.name,
        description: agent.description,
      }))
  }

  private async resolveModeState(
    directory: string,
    sessionId: string,
  ): Promise<{ availableModes: ModeOption[]; currentModeId?: string }> {
    const availableModes = await this.loadAvailableModes(directory)
    const currentModeId =
      this.sessionManager.get(sessionId).modeId ||
      (await (async () => {
        if (!availableModes.length) return undefined
        const defaultAgentName = await AgentModule.defaultAgent()
        const resolvedModeId = availableModes.find((mode) => mode.name === defaultAgentName)?.id ?? availableModes[0].id
        this.sessionManager.setMode(sessionId, resolvedModeId)
        return resolvedModeId
      })())

    return { availableModes, currentModeId }
  }

  private async loadSessionMode(params: LoadSessionRequest) {
    const directory = params.cwd
    const model = await defaultModel(this.config, directory)
    const sessionId = params.sessionId

    const providers = await this.sdk.config.providers({ directory }).then((x) => x.data?.providers)
    const entries = sortProvidersByName(providers ?? [])
    const availableVariants = modelVariantsFromProviders(entries, model)
    const currentVariant = this.sessionManager.getVariant(sessionId)
    if (currentVariant && !availableVariants.includes(currentVariant)) {
      this.sessionManager.setVariant(sessionId, undefined)
    }
    const availableModels = buildAvailableModels(entries, { includeVariants: true })
    const modeState = await this.resolveModeState(directory, sessionId)
    const currentModeId = modeState.currentModeId
    const modes = currentModeId
      ? {
          availableModes: modeState.availableModes,
          currentModeId,
        }
      : undefined

    const commands = await this.config.sdk.command
      .list(
        {
          directory,
        },
        { throwOnError: true },
      )
      // biome-ignore lint/style/noNonNullAssertion: throwOnError guarantees data is present
      .then((resp) => resp.data!)

    const availableCommands = commands.map((command) => ({
      name: command.name,
      description: command.description ?? "",
    }))
    const names = new Set(availableCommands.map((c) => c.name))
    if (!names.has("compact"))
      availableCommands.push({
        name: "compact",
        description: "compact the session",
      })

    const mcpServers: Record<string, Config.Mcp> = {}
    for (const server of params.mcpServers) {
      if ("type" in server) {
        mcpServers[server.name] = {
          url: server.url,
          headers: server.headers.reduce<Record<string, string>>((acc, { name, value }) => {
            acc[name] = value
            return acc
          }, {}),
          type: "remote",
        }
      } else {
        mcpServers[server.name] = {
          type: "local",
          command: [server.command, ...server.args],
          environment: server.env.reduce<Record<string, string>>((acc, { name, value }) => {
            acc[name] = value
            return acc
          }, {}),
        }
      }
    }

    await Promise.all(
      Object.entries(mcpServers).map(async ([key, mcp]) => {
        await this.sdk.mcp
          .add(
            {
              directory,
              name: key,
              config: mcp,
            },
            { throwOnError: true },
          )
          .catch((error) => {
            log.error("failed to add mcp server", { name: key, error })
          })
      }),
    )

    setTimeout(() => {
      this.connection.sessionUpdate({
        sessionId,
        update: {
          sessionUpdate: "available_commands_update",
          availableCommands,
        },
      })
    }, 0)

    return {
      sessionId,
      models: {
        currentModelId: formatModelIdWithVariant(model, currentVariant, availableVariants, true),
        availableModels,
      },
      modes,
      _meta: buildVariantMeta({
        model,
        variant: this.sessionManager.getVariant(sessionId),
        availableVariants,
      }),
    }
  }

  async unstable_setSessionModel(params: SetSessionModelRequest) {
    const session = this.sessionManager.get(params.sessionId)
    const providers = await this.sdk.config
      .providers({ directory: session.cwd }, { throwOnError: true })
      .then((x) => x.data?.providers)

    const selection = parseModelSelection(params.modelId, providers)
    this.sessionManager.setModel(session.id, selection.model)
    this.sessionManager.setVariant(session.id, selection.variant)

    const entries = sortProvidersByName(providers)
    const availableVariants = modelVariantsFromProviders(entries, selection.model)

    return {
      _meta: buildVariantMeta({
        model: selection.model,
        variant: selection.variant,
        availableVariants,
      }),
    }
  }

  async setSessionMode(params: SetSessionModeRequest): Promise<SetSessionModeResponse | undefined> {
    const session = this.sessionManager.get(params.sessionId)
    const availableModes = await this.loadAvailableModes(session.cwd)
    if (!availableModes.some((mode) => mode.id === params.modeId)) {
      throw new Error(`Agent not found: ${params.modeId}`)
    }
    this.sessionManager.setMode(params.sessionId, params.modeId)
    return undefined
  }

  async prompt(params: PromptRequest) {
    const sessionID = params.sessionId
    const session = this.sessionManager.get(sessionID)
    const directory = session.cwd

    const current = session.model
    const model = current ?? (await defaultModel(this.config, directory))
    if (!current) {
      this.sessionManager.setModel(session.id, model)
    }
    const agent = session.modeId ?? (await AgentModule.defaultAgent())

    const parts = buildPromptParts(params.prompt)

    log.info("parts", { parts })

    const cmd = (() => {
      const text = parts
        .filter((p): p is { type: "text"; text: string } => p.type === "text")
        .map((p) => p.text)
        .join("")
        .trim()

      if (!text.startsWith("/")) return

      const [name, ...rest] = text.slice(1).split(/\s+/)
      return { name, args: rest.join(" ").trim() }
    })()

    const buildUsage = (msg: AssistantMessage): Usage => ({
      totalTokens:
        msg.tokens.input +
        msg.tokens.output +
        msg.tokens.reasoning +
        (msg.tokens.cache?.read ?? 0) +
        (msg.tokens.cache?.write ?? 0),
      inputTokens: msg.tokens.input,
      outputTokens: msg.tokens.output,
      thoughtTokens: msg.tokens.reasoning || undefined,
      cachedReadTokens: msg.tokens.cache?.read || undefined,
      cachedWriteTokens: msg.tokens.cache?.write || undefined,
    })

    if (!cmd) {
      const response = await this.sdk.session.prompt({
        sessionID,
        model: {
          providerID: model.providerID,
          modelID: model.modelID,
        },
        variant: this.sessionManager.getVariant(sessionID),
        parts,
        agent,
        directory,
      })
      const msg = response.data?.info

      await sendUsageUpdate(this.connection, this.sdk, sessionID, directory)

      return {
        stopReason: "end_turn" as const,
        usage: msg ? buildUsage(msg) : undefined,
        _meta: {},
      }
    }

    const command = await this.config.sdk.command
      .list({ directory }, { throwOnError: true })
      .then((x) => x.data?.find((c) => c.name === cmd.name))
    if (command) {
      const response = await this.sdk.session.command({
        sessionID,
        command: command.name,
        arguments: cmd.args,
        model: `${model.providerID}/${model.modelID}`,
        agent,
        directory,
      })
      const msg = response.data?.info

      await sendUsageUpdate(this.connection, this.sdk, sessionID, directory)

      return {
        stopReason: "end_turn" as const,
        usage: msg ? buildUsage(msg) : undefined,
        _meta: {},
      }
    }

    switch (cmd.name) {
      case "compact":
        await this.config.sdk.session.summarize(
          {
            sessionID,
            directory,
            providerID: model.providerID,
            modelID: model.modelID,
          },
          { throwOnError: true },
        )
        break
    }

    await sendUsageUpdate(this.connection, this.sdk, sessionID, directory)

    return {
      stopReason: "end_turn" as const,
      _meta: {},
    }
  }

  async cancel(params: CancelNotification): Promise<void> {
    const session = this.sessionManager.get(params.sessionId)
    await this.config.sdk.session.abort(
      {
        sessionID: params.sessionId,
        directory: session.cwd,
      },
      { throwOnError: true },
    )
  }
}

export const ACP = {
  init: acpInit,
  Agent: ACPAgentImpl,
} as const

// Type companion namespace: preserves ACP.Agent as an instance type for type-checking consumers.
// This is a type-only companion (no runtime code) — biome-ignore is intentional here.
// biome-ignore lint/style/noNamespace: type-only companion namespace required for ACP.Agent instance type
export namespace ACP {
  export type Agent = ACPAgentImpl
}
