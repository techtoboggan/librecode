import fs from "node:fs/promises"
import { EOL } from "node:os"
import path from "node:path"
import * as prompts from "@clack/prompts"
import matter from "gray-matter"
import type { Argv } from "yargs"
import { Agent } from "../../../agent/agent"
import { Instance } from "../../../project/instance"
import { Provider } from "../../../provider/provider"
import { Filesystem } from "../../../util/filesystem"
import { UI } from "../../ui"
import { cmd } from "../cmd"
import type { AgentMode } from "./prompts"
import { AVAILABLE_TOOLS, resolveDescription, resolveMode, resolveTargetPath, resolveTools } from "./prompts"

function buildDisabledTools(selected: string[]): Record<string, boolean> {
  const tools: Record<string, boolean> = {}
  for (const tool of AVAILABLE_TOOLS) {
    if (!selected.includes(tool)) tools[tool] = false
  }
  return tools
}

async function generateWithSpinner(description: string, model: unknown, nonInteractive: boolean) {
  const spinner = prompts.spinner()
  spinner.start("Generating agent configuration...")
  const generated = await Agent.generate({ description, model: model as any }).catch((err: Error) => {
    spinner.stop(`LLM failed to generate agent: ${err.message}`, 1)
    if (nonInteractive) process.exit(1)
    throw new UI.CancelledError()
  })
  spinner.stop(`Agent ${generated.identifier} generated`)
  return generated
}

async function writeAgentFile(filePath: string, content: string, nonInteractive: boolean): Promise<void> {
  if (!(await Filesystem.exists(filePath))) {
    await Filesystem.write(filePath, content)
    return
  }
  if (nonInteractive) {
    console.error(`Error: Agent file already exists: ${filePath}`)
    process.exit(1)
  }
  prompts.log.error(`Agent file already exists: ${filePath}`)
  throw new UI.CancelledError()
}

async function runCreateAgent(
  args: {
    path?: string
    description?: string
    tools?: string
    model?: string
    mode?: string
  },
  nonInteractive: boolean,
): Promise<void> {
  const targetPath = await resolveTargetPath(args.path)
  const description = await resolveDescription(args.description)
  const model = args.model ? Provider.parseModel(args.model) : undefined
  const generated = await generateWithSpinner(description, model, nonInteractive)
  const selectedTools = await resolveTools(args.tools)
  const mode = await resolveMode(args.mode as AgentMode | undefined)

  const disabled = buildDisabledTools(selectedTools)
  const frontmatter: { description: string; mode: AgentMode; tools?: Record<string, boolean> } = {
    description: generated.whenToUse,
    mode,
  }
  if (Object.keys(disabled).length > 0) frontmatter.tools = disabled

  const content = matter.stringify(generated.systemPrompt, frontmatter)
  const filePath = path.join(targetPath, `${generated.identifier}.md`)
  await fs.mkdir(targetPath, { recursive: true })
  await writeAgentFile(filePath, content, nonInteractive)

  if (nonInteractive) {
    console.log(filePath)
  } else {
    prompts.log.success(`Agent created: ${filePath}`)
    prompts.outro("Done")
  }
}

const AgentCreateCommand = cmd({
  command: "create",
  describe: "create a new agent",
  builder: (yargs: Argv) =>
    yargs
      .option("path", { type: "string", describe: "directory path to generate the agent file" })
      .option("description", { type: "string", describe: "what the agent should do" })
      .option("mode", { type: "string", describe: "agent mode", choices: ["all", "primary", "subagent"] as const })
      .option("tools", {
        type: "string",
        describe: `comma-separated list of tools to enable (default: all). Available: "${AVAILABLE_TOOLS.join(", ")}"`,
      })
      .option("model", { type: "string", alias: ["m"], describe: "model to use in the format of provider/model" }),
  async handler(args) {
    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        const cliMode = args.mode as AgentMode | undefined
        const nonInteractive = !!(args.path && args.description && cliMode && args.tools !== undefined)
        if (!nonInteractive) {
          UI.empty()
          prompts.intro("Create agent")
        }
        await runCreateAgent(args, nonInteractive)
      },
    })
  },
})

const AgentListCommand = cmd({
  command: "list",
  describe: "list all available agents",
  async handler() {
    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        const agents = await Agent.list()
        const sorted = agents.sort((a, b) => {
          if (a.native !== b.native) return a.native ? -1 : 1
          return a.name.localeCompare(b.name)
        })
        for (const agent of sorted) {
          process.stdout.write(`${agent.name} (${agent.mode})${EOL}`)
          process.stdout.write(`  ${JSON.stringify(agent.permission, null, 2)}${EOL}`)
        }
      },
    })
  },
})

export const AgentCommand = cmd({
  command: "agent",
  describe: "manage agents",
  builder: (yargs) => yargs.command(AgentCreateCommand).command(AgentListCommand).demandCommand(),
  async handler() {},
})
