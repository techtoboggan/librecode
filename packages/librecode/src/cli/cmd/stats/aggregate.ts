import { Instance } from "../../../project/instance"
import { Session } from "../../../session"
import type { MessageV2 } from "../../../session/message-v2"
import { SessionTable } from "../../../session/session.sql"
import { Database } from "../../../storage/db"
import type { ModelStats, SessionResult, SessionStats } from "./types"

const MS_IN_DAY = 24 * 60 * 60 * 1000

function computeCutoff(days?: number): { cutoffTime: number; windowDays: number | undefined } {
  if (days === undefined) return { cutoffTime: 0, windowDays: undefined }
  if (days === 0) {
    const now = new Date()
    now.setHours(0, 0, 0, 0)
    return { cutoffTime: now.getTime(), windowDays: 1 }
  }
  return { cutoffTime: Date.now() - days * MS_IN_DAY, windowDays: days }
}

async function applyProjectFilter(sessions: Session.Info[], projectFilter?: string): Promise<Session.Info[]> {
  if (projectFilter === undefined) return sessions
  if (projectFilter === "") {
    const project = Instance.project
    return sessions.filter((s) => s.projectID === project.id)
  }
  return sessions.filter((s) => s.projectID === projectFilter)
}

type TokenCounts = MessageV2.Assistant["tokens"]

function accumulateTokenCounts(
  tokenInfo: TokenCounts | undefined,
  tokens: SessionResult["sessionTokens"],
  mu: ModelStats,
): void {
  if (!tokenInfo) return
  tokens.input += tokenInfo.input || 0
  tokens.output += tokenInfo.output || 0
  tokens.reasoning += tokenInfo.reasoning || 0
  tokens.cache.read += tokenInfo.cache?.read || 0
  tokens.cache.write += tokenInfo.cache?.write || 0
  mu.tokens.input += tokenInfo.input || 0
  mu.tokens.output += (tokenInfo.output || 0) + (tokenInfo.reasoning || 0)
  mu.tokens.cache.read += tokenInfo.cache?.read || 0
  mu.tokens.cache.write += tokenInfo.cache?.write || 0
}

function processAssistantTokens(
  message: MessageV2.WithParts,
  tokens: SessionResult["sessionTokens"],
  modelUsage: Record<string, ModelStats>,
): number {
  const info = message.info as MessageV2.Assistant
  const modelKey = `${info.providerID}/${info.modelID}`
  if (!modelUsage[modelKey]) {
    modelUsage[modelKey] = { messages: 0, tokens: { input: 0, output: 0, cache: { read: 0, write: 0 } }, cost: 0 }
  }
  const mu = modelUsage[modelKey]
  mu.messages++
  mu.cost += info.cost || 0
  accumulateTokenCounts(info.tokens, tokens, mu)
  return info.cost || 0
}

async function processSession(session: Session.Info, cutoffTime: number): Promise<SessionResult> {
  const messages = await Session.messages({ sessionID: session.id })
  const sessionTokens = { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } }
  const sessionToolUsage: Record<string, number> = {}
  const sessionModelUsage: Record<string, ModelStats> = {}
  let sessionCost = 0

  for (const message of messages) {
    const { info, parts } = message
    if (info.role === "assistant") {
      sessionCost += processAssistantTokens(message, sessionTokens, sessionModelUsage)
    }
    for (const part of parts) {
      if (part.type === "tool" && "tool" in part && part.tool) {
        const toolName = part.tool as string
        sessionToolUsage[toolName] = (sessionToolUsage[toolName] || 0) + 1
      }
    }
  }

  const totalTokens =
    sessionTokens.input +
    sessionTokens.output +
    sessionTokens.reasoning +
    sessionTokens.cache.read +
    sessionTokens.cache.write

  return {
    messageCount: messages.length,
    sessionCost,
    sessionTokens,
    sessionTotalTokens: totalTokens,
    sessionToolUsage,
    sessionModelUsage,
    earliestTime: cutoffTime > 0 ? session.time.updated : session.time.created,
    latestTime: session.time.updated,
  }
}

function mergeResultIntoStats(stats: SessionStats, result: SessionResult): void {
  stats.totalMessages += result.messageCount
  stats.totalCost += result.sessionCost
  stats.totalTokens.input += result.sessionTokens.input
  stats.totalTokens.output += result.sessionTokens.output
  stats.totalTokens.reasoning += result.sessionTokens.reasoning
  stats.totalTokens.cache.read += result.sessionTokens.cache.read
  stats.totalTokens.cache.write += result.sessionTokens.cache.write

  for (const [tool, count] of Object.entries(result.sessionToolUsage)) {
    stats.toolUsage[tool] = (stats.toolUsage[tool] || 0) + count
  }
  for (const [model, usage] of Object.entries(result.sessionModelUsage)) {
    if (!stats.modelUsage[model]) {
      stats.modelUsage[model] = { messages: 0, tokens: { input: 0, output: 0, cache: { read: 0, write: 0 } }, cost: 0 }
    }
    const mu = stats.modelUsage[model]
    mu.messages += usage.messages
    mu.tokens.input += usage.tokens.input
    mu.tokens.output += usage.tokens.output
    mu.tokens.cache.read += usage.tokens.cache.read
    mu.tokens.cache.write += usage.tokens.cache.write
    mu.cost += usage.cost
  }
}

function computeMedian(sorted: number[]): number {
  if (sorted.length === 0) return 0
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
}

export async function aggregateSessionStats(days?: number, projectFilter?: string): Promise<SessionStats> {
  const allRows = Database.use((db) => db.select().from(SessionTable).all())
  const allSessions = allRows.map((row) => Session.fromRow(row))
  const { cutoffTime, windowDays } = computeCutoff(days)

  const timeCut = cutoffTime > 0 ? allSessions.filter((s) => s.time.updated >= cutoffTime) : allSessions
  const filtered = await applyProjectFilter(timeCut, projectFilter)

  const stats: SessionStats = {
    totalSessions: filtered.length,
    totalMessages: 0,
    totalCost: 0,
    totalTokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    toolUsage: {},
    modelUsage: {},
    dateRange: { earliest: Date.now(), latest: Date.now() },
    days: 0,
    costPerDay: 0,
    tokensPerSession: 0,
    medianTokensPerSession: 0,
  }

  if (filtered.length > 1000) {
    console.log(`Large dataset detected (${filtered.length} sessions). This may take a while...`)
  }
  if (filtered.length === 0) {
    stats.days = windowDays ?? 0
    return stats
  }

  let earliestTime = Date.now()
  let latestTime = 0
  const sessionTotalTokens: number[] = []
  const BATCH_SIZE = 20

  for (let i = 0; i < filtered.length; i += BATCH_SIZE) {
    const results = await Promise.all(filtered.slice(i, i + BATCH_SIZE).map((s) => processSession(s, cutoffTime)))
    for (const result of results) {
      earliestTime = Math.min(earliestTime, result.earliestTime)
      latestTime = Math.max(latestTime, result.latestTime)
      sessionTotalTokens.push(result.sessionTotalTokens)
      mergeResultIntoStats(stats, result)
    }
  }

  const rangeDays = Math.max(1, Math.ceil((latestTime - earliestTime) / MS_IN_DAY))
  const effectiveDays = windowDays ?? rangeDays
  stats.dateRange = { earliest: earliestTime, latest: latestTime }
  stats.days = effectiveDays
  stats.costPerDay = stats.totalCost / effectiveDays

  const totalTokenCount =
    stats.totalTokens.input +
    stats.totalTokens.output +
    stats.totalTokens.reasoning +
    stats.totalTokens.cache.read +
    stats.totalTokens.cache.write
  stats.tokensPerSession = filtered.length > 0 ? totalTokenCount / filtered.length : 0
  sessionTotalTokens.sort((a, b) => a - b)
  stats.medianTokensPerSession = computeMedian(sessionTotalTokens)

  return stats
}
