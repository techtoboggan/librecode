import { existsSync } from "node:fs"
import path from "node:path"
import { fn } from "@librecode/util/fn"
import z from "zod"
import { BusEvent } from "@/bus/bus-event"
import { GlobalBus } from "@/bus/global"
import { Flag } from "@/flag/flag"
import { SessionTable } from "../session/session.sql"
import { and, Database, eq } from "../storage/db"
import { Filesystem } from "../util/filesystem"
import { git } from "../util/git"
import { Glob } from "../util/glob"
import { Log } from "../util/log"
import { which } from "../util/which"
import { ProjectTable } from "./project.sql"
import { ProjectID } from "./schema"

const projectLog = Log.create({ service: "project" })

const ProjectInfo = z
  .object({
    id: ProjectID.zod,
    worktree: z.string(),
    vcs: z.literal("git").optional(),
    name: z.string().optional(),
    icon: z
      .object({
        url: z.string().optional(),
        override: z.string().optional(),
        color: z.string().optional(),
      })
      .optional(),
    commands: z
      .object({
        start: z.string().optional().describe("Startup script to run when creating a new workspace (worktree)"),
      })
      .optional(),
    time: z.object({
      created: z.number(),
      updated: z.number(),
      initialized: z.number().optional(),
    }),
    sandboxes: z.array(z.string()),
  })
  .meta({
    ref: "Project",
  })

type ProjectInfoType = z.infer<typeof ProjectInfo>

const ProjectEvent = {
  Updated: BusEvent.define("project.updated", ProjectInfo),
}

type Row = typeof ProjectTable.$inferSelect

function projectFromRow(row: Row): ProjectInfoType {
  const icon =
    row.icon_url || row.icon_color
      ? { url: row.icon_url ?? undefined, color: row.icon_color ?? undefined }
      : undefined
  return {
    id: ProjectID.make(row.id),
    worktree: row.worktree,
    vcs: row.vcs ? ProjectInfo.shape.vcs.parse(row.vcs) : undefined,
    name: row.name ?? undefined,
    icon,
    time: {
      created: row.time_created,
      updated: row.time_updated,
      initialized: row.time_initialized ?? undefined,
    },
    sandboxes: row.sandboxes,
    commands: row.commands ?? undefined,
  }
}

function gitpath(cwd: string, name: string) {
  if (!name) return cwd
  // git output includes trailing newlines; keep path whitespace intact.
  name = name.replace(/[\r\n]+$/, "")
  if (!name) return cwd

  name = Filesystem.windowsPath(name)

  if (path.isAbsolute(name)) return path.normalize(name)
  return path.resolve(cwd, name)
}

function readCachedId(dir: string) {
  return Filesystem.readText(path.join(dir, "librecode"))
    .then((x) => x.trim())
    .then(ProjectID.make)
    .catch(() => undefined)
}

type DirectoryData = {
  id: ProjectID
  worktree: string
  sandbox: string
  vcs: ProjectInfoType["vcs"]
}

const noVcsResult: DirectoryData = {
  id: ProjectID.global,
  worktree: "/",
  sandbox: "/",
  vcs: ProjectInfo.shape.vcs.parse(Flag.LIBRECODE_FAKE_VCS),
}

function fakeVcsResult(id: ProjectID, sandbox: string): DirectoryData {
  return { id, worktree: sandbox, sandbox, vcs: ProjectInfo.shape.vcs.parse(Flag.LIBRECODE_FAKE_VCS) }
}

async function resolveProjectId(sandbox: string, worktree: string, dotgit: string): Promise<ProjectID | undefined> {
  let id = await readCachedId(dotgit)
  if (id == null) {
    id = await readCachedId(path.join(worktree, ".git"))
  }
  if (id) return id

  const roots = await git(["rev-list", "--max-parents=0", "HEAD"], { cwd: sandbox })
    .then(async (result) =>
      (await result.text())
        .split("\n")
        .filter(Boolean)
        .map((x) => x.trim())
        .toSorted(),
    )
    .catch(() => undefined)

  if (!roots) return undefined

  const resolved = roots[0] ? ProjectID.make(roots[0]) : undefined
  if (resolved) {
    await Filesystem.write(path.join(worktree, ".git", "librecode"), resolved).catch(() => undefined)
  }
  return resolved
}

async function resolveWorktree(sandbox: string): Promise<string | undefined> {
  return git(["rev-parse", "--git-common-dir"], { cwd: sandbox })
    .then(async (result) => {
      const common = gitpath(sandbox, await result.text())
      return common === sandbox ? sandbox : path.dirname(common)
    })
    .catch(() => undefined)
}

async function resolveDirectoryData(directory: string): Promise<DirectoryData> {
  const matches = Filesystem.up({ targets: [".git"], start: directory })
  const dotgit = await matches.next().then((x) => x.value)
  await matches.return()

  if (!dotgit) return noVcsResult

  const sandbox = path.dirname(dotgit)
  if (!which("git")) {
    const id = (await readCachedId(dotgit)) ?? ProjectID.global
    return fakeVcsResult(id, sandbox)
  }

  const worktree = await resolveWorktree(sandbox)
  if (!worktree) {
    const id = (await readCachedId(dotgit)) ?? ProjectID.global
    return fakeVcsResult(id, sandbox)
  }

  const id = await resolveProjectId(sandbox, worktree, dotgit)
  if (!id) return { id: ProjectID.global, worktree: sandbox, sandbox, vcs: "git" }

  const top = await git(["rev-parse", "--show-toplevel"], { cwd: sandbox })
    .then(async (result) => gitpath(sandbox, await result.text()))
    .catch(() => undefined)

  if (!top) return fakeVcsResult(id, sandbox)

  return { id, sandbox: top, worktree, vcs: "git" }
}

async function projectFromDirectory(directory: string) {
  projectLog.info("fromDirectory", { directory })

  const data = await resolveDirectoryData(directory)

  const row = Database.use((db) => db.select().from(ProjectTable).where(eq(ProjectTable.id, data.id)).get())
  const existing = row
    ? projectFromRow(row)
    : {
        id: data.id,
        worktree: data.worktree,
        vcs: data.vcs as ProjectInfoType["vcs"],
        sandboxes: [] as string[],
        time: {
          created: Date.now(),
          updated: Date.now(),
        },
      }

  if (Flag.LIBRECODE_EXPERIMENTAL_ICON_DISCOVERY) projectDiscover(existing)

  const result: ProjectInfoType = {
    ...existing,
    worktree: data.worktree,
    vcs: data.vcs as ProjectInfoType["vcs"],
    time: {
      ...existing.time,
      updated: Date.now(),
    },
  }
  if (data.sandbox !== result.worktree && !result.sandboxes.includes(data.sandbox))
    result.sandboxes.push(data.sandbox)
  result.sandboxes = result.sandboxes.filter((x) => existsSync(x))
  const insert = {
    id: result.id,
    worktree: result.worktree,
    vcs: result.vcs ?? null,
    name: result.name,
    icon_url: result.icon?.url,
    icon_color: result.icon?.color,
    time_created: result.time.created,
    time_updated: result.time.updated,
    time_initialized: result.time.initialized,
    sandboxes: result.sandboxes,
    commands: result.commands,
  }
  const updateSet = {
    worktree: result.worktree,
    vcs: result.vcs ?? null,
    name: result.name,
    icon_url: result.icon?.url,
    icon_color: result.icon?.color,
    time_updated: result.time.updated,
    time_initialized: result.time.initialized,
    sandboxes: result.sandboxes,
    commands: result.commands,
  }
  Database.use((db) =>
    db.insert(ProjectTable).values(insert).onConflictDoUpdate({ target: ProjectTable.id, set: updateSet }).run(),
  )
  // Runs after upsert so the target project row exists (FK constraint).
  // Runs on every startup because sessions created before git init
  // accumulate under "global" and need migrating whenever they appear.
  if (data.id !== ProjectID.global) {
    Database.use((db) =>
      db
        .update(SessionTable)
        .set({ project_id: data.id })
        .where(and(eq(SessionTable.project_id, ProjectID.global), eq(SessionTable.directory, data.worktree)))
        .run(),
    )
  }
  GlobalBus.emit("event", {
    payload: {
      type: ProjectEvent.Updated.type,
      properties: result,
    },
  })
  return { project: result, sandbox: data.sandbox }
}

async function projectDiscover(input: ProjectInfoType) {
  if (input.vcs !== "git") return
  if (input.icon?.override) return
  if (input.icon?.url) return
  const matches = await Glob.scan("**/favicon.{ico,png,svg,jpg,jpeg,webp}", {
    cwd: input.worktree,
    absolute: true,
    include: "file",
  })
  const shortest = matches.sort((a, b) => a.length - b.length)[0]
  if (!shortest) return
  const buffer = await Filesystem.readBytes(shortest)
  const base64 = buffer.toString("base64")
  const mime = Filesystem.mimeType(shortest) || "image/png"
  const url = `data:${mime};base64,${base64}`
  await projectUpdate({
    projectID: input.id,
    icon: {
      url,
    },
  })
  return
}

function projectSetInitialized(id: ProjectID) {
  Database.use((db) =>
    db
      .update(ProjectTable)
      .set({
        time_initialized: Date.now(),
      })
      .where(eq(ProjectTable.id, id))
      .run(),
  )
}

function projectList() {
  return Database.use((db) =>
    db
      .select()
      .from(ProjectTable)
      .all()
      .map((row) => projectFromRow(row)),
  )
}

function projectGet(id: ProjectID): ProjectInfoType | undefined {
  const row = Database.use((db) => db.select().from(ProjectTable).where(eq(ProjectTable.id, id)).get())
  if (!row) return undefined
  return projectFromRow(row)
}

async function projectInitGit(input: { directory: string; project: ProjectInfoType }) {
  if (input.project.vcs === "git") return input.project
  if (!which("git")) throw new Error("Git is not installed")

  const result = await git(["init", "--quiet"], {
    cwd: input.directory,
  })
  if (result.exitCode !== 0) {
    const text = result.stderr.toString().trim() || result.text().trim()
    throw new Error(text || "Failed to initialize git repository")
  }

  return (await projectFromDirectory(input.directory)).project
}

const projectUpdate = fn(
  z.object({
    projectID: ProjectID.zod,
    name: z.string().optional(),
    icon: ProjectInfo.shape.icon.optional(),
    commands: ProjectInfo.shape.commands.optional(),
  }),
  async (input) => {
    const id = ProjectID.make(input.projectID)
    const result = Database.use((db) =>
      db
        .update(ProjectTable)
        .set({
          name: input.name,
          icon_url: input.icon?.url,
          icon_color: input.icon?.color,
          commands: input.commands,
          time_updated: Date.now(),
        })
        .where(eq(ProjectTable.id, id))
        .returning()
        .get(),
    )
    if (!result) throw new Error(`Project not found: ${input.projectID}`)
    const data = projectFromRow(result)
    GlobalBus.emit("event", {
      payload: {
        type: ProjectEvent.Updated.type,
        properties: data,
      },
    })
    return data
  },
)

async function projectSandboxes(id: ProjectID) {
  const row = Database.use((db) => db.select().from(ProjectTable).where(eq(ProjectTable.id, id)).get())
  if (!row) return []
  const data = projectFromRow(row)
  const valid: string[] = []
  for (const dir of data.sandboxes) {
    const s = Filesystem.stat(dir)
    if (s?.isDirectory()) valid.push(dir)
  }
  return valid
}

async function projectAddSandbox(id: ProjectID, directory: string) {
  const row = Database.use((db) => db.select().from(ProjectTable).where(eq(ProjectTable.id, id)).get())
  if (!row) throw new Error(`Project not found: ${id}`)
  const sandboxes = [...row.sandboxes]
  if (!sandboxes.includes(directory)) sandboxes.push(directory)
  const result = Database.use((db) =>
    db
      .update(ProjectTable)
      .set({ sandboxes, time_updated: Date.now() })
      .where(eq(ProjectTable.id, id))
      .returning()
      .get(),
  )
  if (!result) throw new Error(`Project not found: ${id}`)
  const data = projectFromRow(result)
  GlobalBus.emit("event", {
    payload: {
      type: ProjectEvent.Updated.type,
      properties: data,
    },
  })
  return data
}

async function projectRemoveSandbox(id: ProjectID, directory: string) {
  const row = Database.use((db) => db.select().from(ProjectTable).where(eq(ProjectTable.id, id)).get())
  if (!row) throw new Error(`Project not found: ${id}`)
  const sandboxes = row.sandboxes.filter((s) => s !== directory)
  const result = Database.use((db) =>
    db
      .update(ProjectTable)
      .set({ sandboxes, time_updated: Date.now() })
      .where(eq(ProjectTable.id, id))
      .returning()
      .get(),
  )
  if (!result) throw new Error(`Project not found: ${id}`)
  const data = projectFromRow(result)
  GlobalBus.emit("event", {
    payload: {
      type: ProjectEvent.Updated.type,
      properties: data,
    },
  })
  return data
}

export const Project = {
  Info: ProjectInfo,
  Event: ProjectEvent,
  fromRow: projectFromRow,
  fromDirectory: projectFromDirectory,
  discover: projectDiscover,
  setInitialized: projectSetInitialized,
  list: projectList,
  get: projectGet,
  initGit: projectInitGit,
  update: projectUpdate,
  sandboxes: projectSandboxes,
  addSandbox: projectAddSandbox,
  removeSandbox: projectRemoveSandbox,
} as const

// biome-ignore lint/style/noNamespace: type companion for declaration merging
export declare namespace Project {
  type Info = ProjectInfoType
}
