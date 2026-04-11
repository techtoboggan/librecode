export interface TokenCounts {
  input: number
  output: number
  reasoning: number
  cache: { read: number; write: number }
}

export interface ModelStats {
  messages: number
  tokens: { input: number; output: number; cache: { read: number; write: number } }
  cost: number
}

export interface SessionStats {
  totalSessions: number
  totalMessages: number
  totalCost: number
  totalTokens: TokenCounts
  toolUsage: Record<string, number>
  modelUsage: Record<string, ModelStats>
  dateRange: { earliest: number; latest: number }
  days: number
  costPerDay: number
  tokensPerSession: number
  medianTokensPerSession: number
}

export interface SessionResult {
  messageCount: number
  sessionCost: number
  sessionTokens: { input: number; output: number; reasoning: number; cache: { read: number; write: number } }
  sessionTotalTokens: number
  sessionToolUsage: Record<string, number>
  sessionModelUsage: Record<string, ModelStats>
  earliestTime: number
  latestTime: number
}
