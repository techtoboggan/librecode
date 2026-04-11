import type { SessionStats, ModelStats } from "./types"

const BOX_WIDTH = 56
const BORDER_TOP = "┌────────────────────────────────────────────────────────┐"
const BORDER_MID = "├────────────────────────────────────────────────────────┤"
const BORDER_BOT = "└────────────────────────────────────────────────────────┘"

function renderRow(label: string, value: string): string {
  const available = BOX_WIDTH - 1
  const padding = Math.max(0, available - label.length - value.length)
  return `│${label}${" ".repeat(padding)}${value} │`
}

export function formatNumber(num: number): string {
  if (num >= 1_000_000) return (num / 1_000_000).toFixed(1) + "M"
  if (num >= 1_000) return (num / 1_000).toFixed(1) + "K"
  return num.toString()
}

function renderOverviewSection(stats: SessionStats): void {
  console.log(BORDER_TOP)
  console.log("│                       OVERVIEW                         │")
  console.log(BORDER_MID)
  console.log(renderRow("Sessions", stats.totalSessions.toLocaleString()))
  console.log(renderRow("Messages", stats.totalMessages.toLocaleString()))
  console.log(renderRow("Days", stats.days.toString()))
  console.log(BORDER_BOT)
  console.log()
}

function renderCostTokensSection(stats: SessionStats): void {
  const cost = isNaN(stats.totalCost) ? 0 : stats.totalCost
  const costPerDay = isNaN(stats.costPerDay) ? 0 : stats.costPerDay
  const tokensPerSession = isNaN(stats.tokensPerSession) ? 0 : stats.tokensPerSession
  const medianTokens = isNaN(stats.medianTokensPerSession) ? 0 : stats.medianTokensPerSession
  console.log(BORDER_TOP)
  console.log("│                    COST & TOKENS                       │")
  console.log(BORDER_MID)
  console.log(renderRow("Total Cost", `$${cost.toFixed(2)}`))
  console.log(renderRow("Avg Cost/Day", `$${costPerDay.toFixed(2)}`))
  console.log(renderRow("Avg Tokens/Session", formatNumber(Math.round(tokensPerSession))))
  console.log(renderRow("Median Tokens/Session", formatNumber(Math.round(medianTokens))))
  console.log(renderRow("Input", formatNumber(stats.totalTokens.input)))
  console.log(renderRow("Output", formatNumber(stats.totalTokens.output)))
  console.log(renderRow("Cache Read", formatNumber(stats.totalTokens.cache.read)))
  console.log(renderRow("Cache Write", formatNumber(stats.totalTokens.cache.write)))
  console.log(BORDER_BOT)
  console.log()
}

function renderModelRow(model: string, usage: ModelStats): void {
  console.log(`│ ${model.padEnd(54)} │`)
  console.log(renderRow("  Messages", usage.messages.toLocaleString()))
  console.log(renderRow("  Input Tokens", formatNumber(usage.tokens.input)))
  console.log(renderRow("  Output Tokens", formatNumber(usage.tokens.output)))
  console.log(renderRow("  Cache Read", formatNumber(usage.tokens.cache.read)))
  console.log(renderRow("  Cache Write", formatNumber(usage.tokens.cache.write)))
  console.log(renderRow("  Cost", `$${usage.cost.toFixed(4)}`))
  console.log(BORDER_MID)
}

function renderModelUsageSection(stats: SessionStats, modelLimit?: number): void {
  if (modelLimit === undefined || Object.keys(stats.modelUsage).length === 0) return
  const sorted = Object.entries(stats.modelUsage).sort(([, a], [, b]) => b.messages - a.messages)
  const toDisplay = modelLimit === Infinity ? sorted : sorted.slice(0, modelLimit)

  console.log(BORDER_TOP)
  console.log("│                      MODEL USAGE                       │")
  console.log(BORDER_MID)
  for (const [model, usage] of toDisplay) renderModelRow(model, usage)
  process.stdout.write("\x1B[1A") // overwrite last separator with bottom border
  console.log(BORDER_BOT)
}

function renderToolRow(tool: string, count: number, maxCount: number, totalToolUsage: number): void {
  const barLength = Math.max(1, Math.floor((count / maxCount) * 20))
  const bar = "█".repeat(barLength)
  const percentage = ((count / totalToolUsage) * 100).toFixed(1)
  const truncated = tool.length > 18 ? tool.substring(0, 16) + ".." : tool
  const toolName = truncated.padEnd(18)
  const content = ` ${toolName} ${bar.padEnd(20)} ${count.toString().padStart(3)} (${percentage.padStart(4)}%)`
  const padding = Math.max(0, BOX_WIDTH - content.length - 1)
  console.log(`│${content}${" ".repeat(padding)} │`)
}

function renderToolUsageSection(stats: SessionStats, toolLimit?: number): void {
  if (Object.keys(stats.toolUsage).length === 0) return
  const sorted = Object.entries(stats.toolUsage).sort(([, a], [, b]) => b - a)
  const toDisplay = toolLimit ? sorted.slice(0, toolLimit) : sorted
  const maxCount = Math.max(...toDisplay.map(([, c]) => c))
  const total = Object.values(stats.toolUsage).reduce((a, b) => a + b, 0)

  console.log(BORDER_TOP)
  console.log("│                      TOOL USAGE                        │")
  console.log(BORDER_MID)
  for (const [tool, count] of toDisplay) renderToolRow(tool, count, maxCount, total)
  console.log(BORDER_BOT)
}

export function displayStats(stats: SessionStats, toolLimit?: number, modelLimit?: number): void {
  renderOverviewSection(stats)
  renderCostTokensSection(stats)
  renderModelUsageSection(stats, modelLimit)
  console.log()
  renderToolUsageSection(stats, toolLimit)
  console.log()
}
