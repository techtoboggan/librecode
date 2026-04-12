import os from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { NamedError } from "@librecode/util/error"
import z from "zod"
import type { Agent } from "@/agent/agent"
import { Bus } from "@/bus"
import { Flag } from "@/flag/flag"
import { Global } from "@/global"
import { PermissionNext } from "@/permission/next"
import { Session } from "@/session"
import { Filesystem } from "@/util/filesystem"
import { Config } from "../config/config"
import { ConfigMarkdown } from "../config/markdown"
import { Instance } from "../project/instance"
import { Glob } from "../util/glob"
import { Log } from "../util/log"
import { Discovery } from "./discovery"

const skillLog = Log.create({ service: "skill" })

const SKILL_EXTERNAL_DIRS = [".claude", ".agents"]
const SKILL_EXTERNAL_PATTERN = "skills/**/SKILL.md"
const SKILL_LIBRECODE_PATTERN = "{skill,skills}/**/SKILL.md"
const SKILL_GLOB_PATTERN = "**/SKILL.md"

async function addSkill(match: string, skills: Record<string, Skill.Info>, dirs: Set<string>): Promise<void> {
  const md = await ConfigMarkdown.parse(match).catch((err) => {
    const message = ConfigMarkdown.FrontmatterError.isInstance(err)
      ? err.data.message
      : `Failed to parse skill ${match}`
    Bus.publish(Session.Event.Error, { error: new NamedError.Unknown({ message }).toObject() })
    skillLog.error("failed to load skill", { skill: match, err })
    return undefined
  })

  if (!md) return

  const parsed = Skill.Info.pick({ name: true, description: true }).safeParse(md.data)
  if (!parsed.success) return

  if (skills[parsed.data.name]) {
    skillLog.warn("duplicate skill name", {
      name: parsed.data.name,
      existing: skills[parsed.data.name].location,
      duplicate: match,
    })
  }

  dirs.add(path.dirname(match))
  skills[parsed.data.name] = {
    name: parsed.data.name,
    description: parsed.data.description,
    location: match,
    content: md.content,
  }
}

async function scanExternal(
  root: string,
  scope: "global" | "project",
  addSkillFn: (match: string) => Promise<void>,
): Promise<void> {
  await Glob.scan(SKILL_EXTERNAL_PATTERN, {
    cwd: root,
    absolute: true,
    include: "file",
    dot: true,
    symlink: true,
  })
    .then((matches) => Promise.all(matches.map(addSkillFn)))
    .catch((error) => {
      skillLog.error(`failed to scan ${scope} skills`, { dir: root, error })
    })
}

async function scanConfigPath(skillPath: string, addSkillFn: (match: string) => Promise<void>): Promise<void> {
  const expanded = skillPath.startsWith("~/") ? path.join(os.homedir(), skillPath.slice(2)) : skillPath
  const resolved = path.isAbsolute(expanded) ? expanded : path.join(Instance.directory, expanded)
  if (!(await Filesystem.isDir(resolved))) {
    skillLog.warn("skill path not found", { path: resolved })
    return
  }
  const matches = await Glob.scan(SKILL_GLOB_PATTERN, {
    cwd: resolved,
    absolute: true,
    include: "file",
    symlink: true,
  })
  for (const match of matches) {
    await addSkillFn(match)
  }
}

async function scanLibrecodeDirs(addSkillFn: (match: string) => Promise<void>): Promise<void> {
  for (const dir of await Config.directories()) {
    const matches = await Glob.scan(SKILL_LIBRECODE_PATTERN, {
      cwd: dir,
      absolute: true,
      include: "file",
      symlink: true,
    })
    for (const match of matches) {
      await addSkillFn(match)
    }
  }
}

async function scanUrlSkills(
  urls: string[],
  dirs: Set<string>,
  addSkillFn: (match: string) => Promise<void>,
): Promise<void> {
  for (const url of urls) {
    const list = await Discovery.pull(url)
    for (const dir of list) {
      dirs.add(dir)
      const matches = await Glob.scan(SKILL_GLOB_PATTERN, {
        cwd: dir,
        absolute: true,
        include: "file",
        symlink: true,
      })
      for (const match of matches) {
        await addSkillFn(match)
      }
    }
  }
}

async function scanExternalDirs(addSkillFn: (match: string) => Promise<void>): Promise<void> {
  const scanExternalDir = (root: string, scope: "global" | "project") => scanExternal(root, scope, addSkillFn)

  for (const dir of SKILL_EXTERNAL_DIRS) {
    const root = path.join(Global.Path.home, dir)
    if (!(await Filesystem.isDir(root))) continue
    await scanExternalDir(root, "global")
  }

  for await (const root of Filesystem.up({
    targets: SKILL_EXTERNAL_DIRS,
    start: Instance.directory,
    stop: Instance.worktree,
  })) {
    await scanExternalDir(root, "project")
  }
}

export namespace Skill {
  export const Info = z.object({
    name: z.string(),
    description: z.string(),
    location: z.string(),
    content: z.string(),
  })
  export type Info = z.infer<typeof Info>

  export const InvalidError = NamedError.create(
    "SkillInvalidError",
    z.object({
      path: z.string(),
      message: z.string().optional(),
      issues: z.custom<z.core.$ZodIssue[]>().optional(),
    }),
  )

  export const NameMismatchError = NamedError.create(
    "SkillNameMismatchError",
    z.object({
      path: z.string(),
      expected: z.string(),
      actual: z.string(),
    }),
  )

  export const state = Instance.state(async () => {
    const skills: Record<string, Info> = {}
    const dirs = new Set<string>()
    const addSkillToState = (match: string) => addSkill(match, skills, dirs)

    // Scan external skill directories (.claude/skills/, .agents/skills/, etc.)
    // Load global (home) first, then project-level (so project-level overwrites)
    if (!Flag.LIBRECODE_DISABLE_EXTERNAL_SKILLS) {
      await scanExternalDirs(addSkillToState)
    }

    // Scan .librecode/skill/ directories
    await scanLibrecodeDirs(addSkillToState)

    // Scan additional skill paths from config
    const config = await Config.get()
    for (const skillPath of config.skills?.paths ?? []) {
      await scanConfigPath(skillPath, addSkillToState)
    }

    // Download and load skills from URLs
    await scanUrlSkills(config.skills?.urls ?? [], dirs, addSkillToState)

    return {
      skills,
      dirs: Array.from(dirs),
    }
  })

  export async function get(name: string) {
    return state().then((x) => x.skills[name])
  }

  export async function all() {
    return state().then((x) => Object.values(x.skills))
  }

  export async function dirs() {
    return state().then((x) => x.dirs)
  }

  export async function available(agent?: Agent.Info) {
    const list = await all()
    if (!agent) return list
    return list.filter((skill) => PermissionNext.evaluate("skill", skill.name, agent.permission).action !== "deny")
  }

  export function fmt(list: Info[], opts: { verbose: boolean }) {
    if (list.length === 0) {
      return "No skills are currently available."
    }
    if (opts.verbose) {
      return [
        "<available_skills>",
        ...list.flatMap((skill) => [
          `  <skill>`,
          `    <name>${skill.name}</name>`,
          `    <description>${skill.description}</description>`,
          `    <location>${pathToFileURL(skill.location).href}</location>`,
          `  </skill>`,
        ]),
        "</available_skills>",
      ].join("\n")
    }
    return ["## Available Skills", ...list.flatMap((skill) => `- **${skill.name}**: ${skill.description}`)].join("\n")
  }
}
