/**
 * Instruction Compiler
 *
 * Formalizes how instructions from multiple sources are compiled into
 * the final system prompt for the LLM context.
 *
 * Features:
 * - Explicit priority tiers with documented ordering
 * - Source tracking (which file/config contributed each instruction)
 * - Content deduplication (same text from different sources)
 * - Context budget management with per-tier allocation
 * - Token estimation for budget enforcement
 *
 * ## Priority Tiers (highest to lowest)
 *
 * 1. SYSTEM — Provider/model-specific base prompt (cannot be overridden)
 * 2. AGENT — Agent-specific instructions (skills, mode)
 * 3. PROJECT — Project-level instructions (CLAUDE.md, AGENTS.md, .librecode/)
 * 4. USER — User-level config instructions (~/.config/librecode/)
 * 5. CONTEXTUAL — Dynamically loaded instructions from file reads
 * 6. FORMAT — Structured output instructions (conditional)
 */

import { Log } from "@/util/log"
import z from "zod"

const log = Log.create({ service: "instruction-compiler" })

// ── Priority tiers ──

export const InstructionTier = z.enum(["system", "agent", "project", "user", "contextual", "format"])
export type InstructionTier = z.infer<typeof InstructionTier>

/** Numeric priority — higher number = higher priority in conflict resolution */
export const TIER_PRIORITY: Record<InstructionTier, number> = {
  system: 100,
  agent: 80,
  project: 60,
  user: 40,
  contextual: 20,
  format: 90, // format is high because it's a hard requirement
}

// ── Instruction entry ──

export interface InstructionEntry {
  /** The instruction text */
  content: string

  /** Which tier this instruction belongs to */
  tier: InstructionTier

  /** Where this instruction came from */
  source: InstructionSource

  /** Estimated token count (chars / 4) */
  tokens: number
}

export type InstructionSource =
  | { type: "file"; path: string }
  | { type: "config"; key: string }
  | { type: "provider"; name: string }
  | { type: "agent"; name: string }
  | { type: "format"; format: string }
  | { type: "dynamic"; context: string }

// ── Compiled result ──

export interface CompiledInstructions {
  /** The final system prompt sections in priority order */
  sections: InstructionEntry[]

  /** Total estimated tokens across all sections */
  totalTokens: number

  /** Source map: which files/configs contributed */
  sources: InstructionSource[]

  /** Any sections that were dropped due to budget */
  dropped: InstructionEntry[]

  /** Budget utilization percentage */
  budgetUsed: number
}

// ── Compiler ──

export interface CompilerOptions {
  /** Maximum tokens for the entire system prompt (default: no limit) */
  maxTokens?: number

  /**
   * Per-tier token budgets. If a tier exceeds its budget, lowest-priority
   * entries within that tier are truncated.
   */
  tierBudgets?: Partial<Record<InstructionTier, number>>
}

/**
 * Compiles instructions from multiple sources into a prioritized,
 * deduplicated, budget-managed system prompt.
 */
export class InstructionCompiler {
  private entries: InstructionEntry[] = []
  private seenContent = new Set<string>()
  private seenSources = new Set<string>()

  /**
   * Add an instruction entry.
   * Duplicate content (exact match) is silently skipped.
   * Duplicate sources (same file path) are silently skipped.
   */
  add(content: string, tier: InstructionTier, source: InstructionSource): void {
    // Content deduplication
    const contentKey = content.trim()
    if (this.seenContent.has(contentKey)) {
      log.info("skipping duplicate content", { tier, source })
      return
    }

    // Source deduplication (same file loaded twice)
    const sourceKey = this.sourceKey(source)
    if (this.seenSources.has(sourceKey)) {
      log.info("skipping duplicate source", { tier, source: sourceKey })
      return
    }

    this.seenContent.add(contentKey)
    this.seenSources.add(sourceKey)

    const tokens = estimateTokens(content)
    this.entries.push({ content, tier, source, tokens })
  }

  /**
   * Add multiple entries at once.
   */
  addAll(entries: Array<{ content: string; tier: InstructionTier; source: InstructionSource }>): void {
    for (const entry of entries) {
      this.add(entry.content, entry.tier, entry.source)
    }
  }

  /**
   * Compile all entries into the final instruction set.
   * Entries are sorted by tier priority (highest first), then by insertion order.
   * Budget constraints are applied if specified.
   */
  compile(options?: CompilerOptions): CompiledInstructions {
    const maxTokens = options?.maxTokens
    const tierBudgets = options?.tierBudgets ?? {}

    // Sort by tier priority (highest first), then insertion order
    const sorted = [...this.entries].sort((a, b) => {
      const priorityDiff = TIER_PRIORITY[b.tier] - TIER_PRIORITY[a.tier]
      if (priorityDiff !== 0) return priorityDiff
      return 0 // stable sort preserves insertion order
    })

    const sections: InstructionEntry[] = []
    const dropped: InstructionEntry[] = []
    const tierUsage: Record<string, number> = {}
    let totalTokens = 0

    for (const entry of sorted) {
      // Check per-tier budget
      const tierBudget = tierBudgets[entry.tier]
      const currentTierUsage = tierUsage[entry.tier] ?? 0
      if (tierBudget !== undefined && currentTierUsage + entry.tokens > tierBudget) {
        dropped.push(entry)
        log.info("dropped entry (tier budget)", {
          tier: entry.tier,
          source: this.sourceKey(entry.source),
          tokens: entry.tokens,
          budget: tierBudget,
        })
        continue
      }

      // Check total budget
      if (maxTokens !== undefined && totalTokens + entry.tokens > maxTokens) {
        dropped.push(entry)
        log.info("dropped entry (total budget)", {
          tier: entry.tier,
          source: this.sourceKey(entry.source),
          tokens: entry.tokens,
          remaining: maxTokens - totalTokens,
        })
        continue
      }

      sections.push(entry)
      totalTokens += entry.tokens
      tierUsage[entry.tier] = currentTierUsage + entry.tokens
    }

    return {
      sections,
      totalTokens,
      sources: sections.map((s) => s.source),
      dropped,
      budgetUsed: maxTokens ? (totalTokens / maxTokens) * 100 : 0,
    }
  }

  /**
   * Get all entries without compiling (no sorting or budget).
   */
  entries_raw(): InstructionEntry[] {
    return [...this.entries]
  }

  private sourceKey(source: InstructionSource): string {
    switch (source.type) {
      case "file":
        return `file:${source.path}`
      case "config":
        return `config:${source.key}`
      case "provider":
        return `provider:${source.name}`
      case "agent":
        return `agent:${source.name}`
      case "format":
        return `format:${source.format}`
      case "dynamic":
        return `dynamic:${source.context}`
    }
  }
}

/**
 * Estimate token count for a string.
 * Uses the standard approximation of 4 characters per token.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

/**
 * Format a compiled instruction set for debugging.
 */
export function formatCompiled(compiled: CompiledInstructions): string {
  const lines: string[] = [
    `Compiled ${compiled.sections.length} instruction sections (${compiled.totalTokens} tokens, ${compiled.budgetUsed.toFixed(1)}% budget)`,
    "",
  ]

  for (const section of compiled.sections) {
    const sourceStr =
      section.source.type === "file"
        ? section.source.path
        : section.source.type === "provider"
          ? `[${section.source.name}]`
          : `[${section.source.type}:${Object.values(section.source).slice(1).join("/")}]`
    lines.push(`  ${section.tier.padEnd(12)} ${section.tokens.toString().padStart(6)} tokens  ${sourceStr}`)
  }

  if (compiled.dropped.length > 0) {
    lines.push("")
    lines.push(`Dropped ${compiled.dropped.length} sections:`)
    for (const entry of compiled.dropped) {
      lines.push(`  ${entry.tier.padEnd(12)} ${entry.tokens.toString().padStart(6)} tokens  (budget exceeded)`)
    }
  }

  return lines.join("\n")
}
