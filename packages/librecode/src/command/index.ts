import z from "zod"
import { BusEvent } from "@/bus/bus-event"
import { MessageID, SessionID } from "@/session/schema"
import { Config } from "../config/config"
import { MCP } from "../mcp"
import { Instance } from "../project/instance"
import { Skill } from "../skill"
import PROMPT_INITIALIZE from "./template/initialize.txt"
import PROMPT_REVIEW from "./template/review.txt"

const CommandEvent = {
  Executed: BusEvent.define(
    "command.executed",
    z.object({
      name: z.string(),
      sessionID: SessionID.zod,
      arguments: z.string(),
      messageID: MessageID.zod,
    }),
  ),
}

const CommandInfo = z
  .object({
    name: z.string(),
    description: z.string().optional(),
    agent: z.string().optional(),
    model: z.string().optional(),
    source: z.enum(["command", "mcp", "skill"]).optional(),
    // workaround for zod not supporting async functions natively so we use getters
    // https://zod.dev/v4/changelog?id=zfunction
    template: z.promise(z.string()).or(z.string()),
    subtask: z.boolean().optional(),
    hints: z.array(z.string()),
  })
  .meta({
    ref: "Command",
  })

// for some reason zod is inferring `string` for z.promise(z.string()).or(z.string()) so we have to manually override it
export type CommandInfoType = Omit<z.infer<typeof CommandInfo>, "template"> & { template: Promise<string> | string }

const CommandDefault = {
  INIT: "init",
  REVIEW: "review",
} as const

function commandHints(template: string): string[] {
  const result: string[] = []
  const numbered = template.match(/\$\d+/g)
  if (numbered) {
    for (const match of [...new Set(numbered)].sort()) result.push(match)
  }
  if (template.includes("$ARGUMENTS")) result.push("$ARGUMENTS")
  return result
}

const state = Instance.state(async () => {
  const cfg = await Config.get()

  const result: Record<string, CommandInfoType> = {
    [CommandDefault.INIT]: {
      name: CommandDefault.INIT,
      description: "create/update AGENTS.md",
      source: "command",
      get template() {
        // biome-ignore lint/suspicious/noTemplateCurlyInString: literal placeholder replaced at runtime
        return PROMPT_INITIALIZE.replace("${path}", Instance.worktree)
      },
      hints: commandHints(PROMPT_INITIALIZE),
    },
    [CommandDefault.REVIEW]: {
      name: CommandDefault.REVIEW,
      description: "review changes [commit|branch|pr], defaults to uncommitted",
      source: "command",
      get template() {
        // biome-ignore lint/suspicious/noTemplateCurlyInString: literal placeholder replaced at runtime
        return PROMPT_REVIEW.replace("${path}", Instance.worktree)
      },
      subtask: true,
      hints: commandHints(PROMPT_REVIEW),
    },
  }

  for (const [name, command] of Object.entries(cfg.command ?? {})) {
    result[name] = {
      name,
      agent: command.agent,
      model: command.model,
      description: command.description,
      source: "command",
      get template() {
        return command.template
      },
      subtask: command.subtask,
      hints: commandHints(command.template),
    }
  }
  for (const [name, prompt] of Object.entries(await MCP.prompts())) {
    result[name] = {
      name,
      source: "mcp",
      description: prompt.description,
      get template() {
        // since a getter can't be async we need to manually return a promise here
        // biome-ignore lint/suspicious/noAsyncPromiseExecutor: getter cannot be async
        return new Promise<string>(async (resolve, reject) => {
          const template = await MCP.getPrompt(
            prompt.client,
            prompt.name,
            prompt.arguments
              ? // substitute each argument with $1, $2, etc.
                Object.fromEntries(prompt.arguments?.map((argument, i) => [argument.name, `$${i + 1}`]))
              : {},
          ).catch(reject)
          resolve(
            template?.messages
              .map((message) => (message.content.type === "text" ? message.content.text : ""))
              .join("\n") || "",
          )
        })
      },
      hints: prompt.arguments?.map((_, i) => `$${i + 1}`) ?? [],
    }
  }

  // Add skills as invokable commands
  for (const skill of await Skill.all()) {
    // Skip if a command with this name already exists
    if (result[skill.name]) continue
    result[skill.name] = {
      name: skill.name,
      description: skill.description,
      source: "skill",
      get template() {
        return skill.content
      },
      hints: [],
    }
  }

  return result
})

async function commandGet(name: string): Promise<CommandInfoType> {
  return state().then((x) => x[name])
}

async function commandList(): Promise<CommandInfoType[]> {
  return state().then((x) => Object.values(x))
}

export const Command = {
  Event: CommandEvent,
  Info: CommandInfo,
  Default: CommandDefault,
  hints: commandHints,
  get: commandGet,
  list: commandList,
} as const
// biome-ignore lint/style/noNamespace: type companion for declaration merging
export declare namespace Command {
  type Info = CommandInfoType
}
