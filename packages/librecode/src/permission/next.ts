/**
 * Permission module — public API.
 *
 * Migrated from Effect facade to direct re-exports per ADR-001.
 */

import os from "node:os"
import type { Config } from "@/config/config"
import { getToolCapabilities, getToolRisk, isReadOnly } from "@/tool/capability-registry"
import { fn } from "@/util/fn"
import { Wildcard } from "@/util/wildcard"
import type {
  Action as ActionType,
  Reply as ReplyType,
  Request as RequestType,
  Ruleset as RulesetType,
  Rule as RuleType,
} from "./service"
import * as S from "./service"

export const Action = S.Action
export type Action = ActionType
export const Rule = S.Rule
export type Rule = RuleType
export const Ruleset = S.Ruleset
export type Ruleset = RulesetType
export const Request = S.Request
export type Request = RequestType
export const Reply = S.Reply
export type Reply = ReplyType
export const Approval = S.Approval
export const Event = S.Event
export const RejectedError = S.RejectedError
export const CorrectedError = S.CorrectedError
export const DeniedError = S.DeniedError

function expand(pattern: string): string {
  if (pattern.startsWith("~/")) return os.homedir() + pattern.slice(1)
  if (pattern === "~") return os.homedir()
  if (pattern.startsWith("$HOME/")) return os.homedir() + pattern.slice(5)
  if (pattern.startsWith("$HOME")) return os.homedir() + pattern.slice(5)
  return pattern
}

function permissionNextFromConfig(permission: Config.Permission): Ruleset {
  const ruleset: Ruleset = []
  for (const [key, value] of Object.entries(permission)) {
    if (typeof value === "string") {
      ruleset.push({
        permission: key,
        action: value,
        pattern: "*",
      })
      continue
    }
    ruleset.push(
      ...Object.entries(value).map(([pattern, action]) => ({ permission: key, pattern: expand(pattern), action })),
    )
  }
  return ruleset
}

function permissionNextMerge(...rulesets: Ruleset[]): Ruleset {
  return rulesets.flat()
}

const permissionNextAsk = fn(S.AskInput, async (input) => S.ask(input))

const permissionNextReply = fn(S.ReplyInput, async (input) => S.reply(input))

async function permissionNextList() {
  return S.list()
}

function permissionNextEvaluate(permission: string, pattern: string, ...rulesets: Ruleset[]): Rule {
  return S.evaluate(permission, pattern, ...rulesets)
}

const EDIT_TOOLS = ["edit", "write", "patch", "multiedit"]

function permissionNextDisabled(tools: string[], ruleset: Ruleset): Set<string> {
  const result = new Set<string>()
  for (const tool of tools) {
    const permission = EDIT_TOOLS.includes(tool) ? "edit" : tool
    const rule = ruleset.findLast((rule) => Wildcard.match(permission, rule.permission))
    if (!rule) continue
    if (rule.pattern === "*" && rule.action === "deny") result.add(tool)
  }
  return result
}

/**
 * Get capability-enriched info for a permission/tool.
 * Used by the UI to display risk level and explain what a tool can do.
 */
function permissionNextCapabilityInfo(permission: string) {
  const capabilities = getToolCapabilities(permission)
  return {
    risk: getToolRisk(permission),
    readOnly: isReadOnly(permission),
    capabilities: capabilities
      ? {
          reads: [...capabilities.reads],
          writes: [...capabilities.writes],
          sideEffects: capabilities.sideEffects,
          executesCode: capabilities.executesCode ?? false,
        }
      : undefined,
  }
}

export const PermissionNext = {
  Action,
  Rule,
  Ruleset,
  Request,
  Reply,
  Approval,
  Event,
  RejectedError,
  CorrectedError,
  DeniedError,
  fromConfig: permissionNextFromConfig,
  merge: permissionNextMerge,
  ask: permissionNextAsk,
  reply: permissionNextReply,
  list: permissionNextList,
  evaluate: permissionNextEvaluate,
  disabled: permissionNextDisabled,
  capabilityInfo: permissionNextCapabilityInfo,
} as const

// biome-ignore lint/style/noNamespace: type companion for declaration merging
export declare namespace PermissionNext {
  type Action = ActionType
  type Rule = RuleType
  type Ruleset = RulesetType
  type Request = RequestType
  type Reply = ReplyType
}
