import path from "node:path"
import { pathToFileURL } from "node:url"
import type { ToolContext as PluginToolContext, ToolDefinition } from "@librecode/plugin"
import z from "zod"
import { Flag } from "@/flag/flag"
import { Log } from "@/util/log"
import type { AgentInfo } from "../agent/agent"
import { Config } from "../config/config"
import { Plugin } from "../plugin"
import { Instance } from "../project/instance"
import type { ModelID, ProviderID } from "../provider/schema"
import { Glob } from "../util/glob"
import { ApplyPatchTool } from "./apply_patch"
import { BashTool } from "./bash"
import { BatchTool } from "./batch"
import { CodeSearchTool } from "./codesearch"
import { EditTool } from "./edit"
import { GlobTool } from "./glob"
import { GrepTool } from "./grep"
import { InvalidTool } from "./invalid"
import { LspTool } from "./lsp"
import { PlanExitTool } from "./plan"
import { QuestionTool } from "./question"
import { ReadTool } from "./read"
import { SkillTool } from "./skill"
import { TaskTool } from "./task"
import { TodoWriteTool } from "./todo"
import type { Tool } from "./tool"
import { Truncate } from "./truncation"
import { WebFetchTool } from "./webfetch"
import { WebSearchTool } from "./websearch"
import { WriteTool } from "./write"

const log = Log.create({ service: "tool.registry" })

const registryState = Instance.state(async () => {
  const custom = [] as Tool.Info[]

  const matches = await Config.directories().then((dirs) =>
    dirs.flatMap((dir) =>
      Glob.scanSync("{tool,tools}/*.{js,ts}", { cwd: dir, absolute: true, dot: true, symlink: true }),
    ),
  )
  if (matches.length) await Config.waitForDependencies()
  for (const match of matches) {
    const namespace = path.basename(match, path.extname(match))
    const mod = await import(pathToFileURL(match).href)
    for (const [id, def] of Object.entries<ToolDefinition>(mod)) {
      custom.push(fromPlugin(id === "default" ? namespace : `${namespace}_${id}`, def))
    }
  }

  const plugins = await Plugin.list()
  for (const plugin of plugins) {
    for (const [id, def] of Object.entries(plugin.tool ?? {})) {
      custom.push(fromPlugin(id, def))
    }
  }

  return { custom }
})

function fromPlugin(id: string, def: ToolDefinition): Tool.Info {
  return {
    id,
    init: async (initCtx) => ({
      parameters: z.object(def.args),
      description: def.description,
      execute: async (args, ctx) => {
        const pluginCtx = {
          ...ctx,
          directory: Instance.directory,
          worktree: Instance.worktree,
        } as unknown as PluginToolContext
        // biome-ignore lint/suspicious/noExplicitAny: plugin execute args are opaque to registry
        const result = await def.execute(args as any, pluginCtx)
        const out = await Truncate.output(result, {}, initCtx?.agent)
        return {
          title: "",
          output: out.truncated ? out.content : result,
          metadata: { truncated: out.truncated, outputPath: out.truncated ? out.outputPath : undefined },
        }
      },
    }),
  }
}

async function registryRegister(tool: Tool.Info) {
  const { custom } = await registryState()
  const idx = custom.findIndex((t) => t.id === tool.id)
  if (idx >= 0) {
    custom.splice(idx, 1, tool)
    return
  }
  custom.push(tool)
}

async function all(): Promise<Tool.Info[]> {
  const custom = await registryState().then((x) => x.custom)
  const config = await Config.get()
  const question = ["app", "cli", "desktop"].includes(Flag.LIBRECODE_CLIENT) || Flag.LIBRECODE_ENABLE_QUESTION_TOOL

  return [
    InvalidTool,
    ...(question ? [QuestionTool] : []),
    BashTool,
    ReadTool,
    GlobTool,
    GrepTool,
    EditTool,
    WriteTool,
    TaskTool,
    WebFetchTool,
    TodoWriteTool,
    WebSearchTool,
    CodeSearchTool,
    SkillTool,
    ApplyPatchTool,
    ...(Flag.LIBRECODE_EXPERIMENTAL_LSP_TOOL ? [LspTool] : []),
    ...(config.experimental?.batch_tool === true ? [BatchTool] : []),
    ...(Flag.LIBRECODE_EXPERIMENTAL_PLAN_MODE && Flag.LIBRECODE_CLIENT === "cli" ? [PlanExitTool] : []),
    ...custom,
  ]
}

async function registryIds() {
  return all().then((x) => x.map((t) => t.id))
}

async function registryTools(
  model: {
    providerID: ProviderID
    modelID: ModelID
  },
  agent?: AgentInfo,
) {
  const tools = await all()
  const result = await Promise.all(
    tools
      .filter((t) => {
        // Enable websearch/codesearch via enable flag
        if (t.id === "codesearch" || t.id === "websearch") {
          return Flag.LIBRECODE_ENABLE_EXA
        }

        // use apply tool in same format as codex
        const usePatch =
          model.modelID.includes("gpt-") && !model.modelID.includes("oss") && !model.modelID.includes("gpt-4")
        if (t.id === "apply_patch") return usePatch
        if (t.id === "edit" || t.id === "write") return !usePatch

        return true
      })
      .map(async (t) => {
        using _ = log.time(t.id)
        const tool = await t.init({ agent })
        const output = {
          description: tool.description,
          parameters: tool.parameters,
        }
        await Plugin.trigger("tool.definition", { toolID: t.id }, output)
        return {
          id: t.id,
          ...tool,
          description: output.description,
          parameters: output.parameters,
        }
      }),
  )
  return result
}

export const ToolRegistry = {
  state: registryState,
  register: registryRegister,
  ids: registryIds,
  tools: registryTools,
} as const
