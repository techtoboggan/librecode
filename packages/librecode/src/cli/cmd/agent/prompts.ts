import * as prompts from "@clack/prompts"
import { UI } from "../../ui"
import { Global } from "../../../global"
import { Instance } from "../../../project/instance"
import path from "path"

export const AVAILABLE_TOOLS = [
  "bash",
  "read",
  "write",
  "edit",
  "list",
  "glob",
  "grep",
  "webfetch",
  "task",
  "todowrite",
  "todoread",
]

export type AgentMode = "all" | "primary" | "subagent"

export async function resolveTargetPath(cliPath?: string): Promise<string> {
  if (cliPath) return path.join(cliPath, "agent")

  const project = Instance.project
  let scope: "global" | "project" = "global"
  if (project.vcs === "git") {
    const scopeResult = await prompts.select({
      message: "Location",
      options: [
        { label: "Current project", value: "project" as const, hint: Instance.worktree },
        { label: "Global", value: "global" as const, hint: Global.Path.config },
      ],
    })
    if (prompts.isCancel(scopeResult)) throw new UI.CancelledError()
    scope = scopeResult
  }

  return path.join(scope === "global" ? Global.Path.config : path.join(Instance.worktree, ".librecode"), "agent")
}

export async function resolveDescription(cliDescription?: string): Promise<string> {
  if (cliDescription) return cliDescription
  const query = await prompts.text({
    message: "Description",
    placeholder: "What should this agent do?",
    validate: (x) => (x && x.length > 0 ? undefined : "Required"),
  })
  if (prompts.isCancel(query)) throw new UI.CancelledError()
  return query
}

export async function resolveTools(cliTools?: string): Promise<string[]> {
  if (cliTools !== undefined) {
    return cliTools ? cliTools.split(",").map((t) => t.trim()) : AVAILABLE_TOOLS
  }
  const result = await prompts.multiselect({
    message: "Select tools to enable (Space to toggle)",
    options: AVAILABLE_TOOLS.map((tool) => ({ label: tool, value: tool })),
    initialValues: AVAILABLE_TOOLS,
  })
  if (prompts.isCancel(result)) throw new UI.CancelledError()
  return result
}

export async function resolveMode(cliMode?: AgentMode): Promise<AgentMode> {
  if (cliMode) return cliMode
  const modeResult = await prompts.select({
    message: "Agent mode",
    options: [
      { label: "All", value: "all" as const, hint: "Can function in both primary and subagent roles" },
      { label: "Primary", value: "primary" as const, hint: "Acts as a primary/main agent" },
      { label: "Subagent", value: "subagent" as const, hint: "Can be used as a subagent by other agents" },
    ],
    initialValue: "all" as const,
  })
  if (prompts.isCancel(modeResult)) throw new UI.CancelledError()
  return modeResult
}
