import fs from "node:fs/promises"
import path from "node:path"
import { NamedError } from "@librecode/util/error"
import z from "zod"
import { git } from "@/util/git"
import { Global } from "../global"
import { Filesystem } from "../util/filesystem"
import { Glob } from "../util/glob"
import { lazy } from "../util/lazy"
import { Lock } from "../util/lock"
import { Log } from "../util/log"

const log = Log.create({ service: "storage" })

type Migration = (dir: string) => Promise<void>

const StorageNotFoundError = NamedError.create(
  "NotFoundError",
  z.object({
    message: z.string(),
  }),
)

async function migrateMessageParts(
  dir: string,
  fullProjectDir: string,
  sessionId: string,
  messageId: string,
): Promise<void> {
  for (const partFile of await Glob.scan(`storage/session/part/${sessionId}/${messageId}/*.json`, {
    cwd: fullProjectDir,
    absolute: true,
  })) {
    const dest = path.join(dir, "part", messageId, path.basename(partFile))
    const part = await Filesystem.readJson(partFile)
    log.info("copying", { partFile, dest })
    await Filesystem.writeJson(dest, part)
  }
}

async function migrateSessionMessages(
  dir: string,
  fullProjectDir: string,
  projectID: string,
  sessionFile: string,
): Promise<void> {
  const dest = path.join(dir, "session", projectID, path.basename(sessionFile))
  log.info("copying", { sessionFile, dest })
  const session = await Filesystem.readJson<Record<string, unknown> & { id: string }>(sessionFile)
  await Filesystem.writeJson(dest, session)
  log.info(`migrating messages for session ${session.id}`)
  for (const msgFile of await Glob.scan(`storage/session/message/${session.id}/*.json`, {
    cwd: fullProjectDir,
    absolute: true,
  })) {
    const msgDest = path.join(dir, "message", session.id, path.basename(msgFile))
    log.info("copying", { msgFile, dest: msgDest })
    const message = await Filesystem.readJson<Record<string, unknown> & { id: string }>(msgFile)
    await Filesystem.writeJson(msgDest, message)
    log.info(`migrating parts for message ${message.id}`)
    await migrateMessageParts(dir, fullProjectDir, session.id, message.id)
  }
}

async function resolveProjectWorktree(project: string, projectDir: string): Promise<string | undefined> {
  for (const msgFile of await Glob.scan("storage/session/message/*/*.json", {
    cwd: path.join(project, projectDir),
    absolute: true,
  })) {
    const json = await Filesystem.readJson<Record<string, unknown> & { path?: { root?: string } }>(msgFile)
    if (json.path?.root) return json.path.root
  }
  return undefined
}

async function resolveGitRootId(worktree: string): Promise<string | undefined> {
  const result = await git(["rev-list", "--max-parents=0", "--all"], { cwd: worktree })
  const [id] = result
    .text()
    .split("\n")
    .filter(Boolean)
    .map((x) => x.trim())
    .toSorted()
  return id || undefined
}

async function migrateProject(dir: string, project: string, projectDir: string): Promise<void> {
  const fullPath = path.join(project, projectDir)
  if (!(await Filesystem.isDir(fullPath))) return
  log.info(`migrating project ${projectDir}`)
  const fullProjectDir = path.join(project, projectDir)
  if (projectDir === "global") return

  const worktree = await resolveProjectWorktree(project, projectDir)
  if (!worktree) return
  if (!(await Filesystem.isDir(worktree))) return

  const id = await resolveGitRootId(worktree)
  if (!id) return

  await Filesystem.writeJson(path.join(dir, "project", `${id}.json`), {
    id,
    vcs: "git",
    worktree,
    time: { created: Date.now(), initialized: Date.now() },
  })

  log.info(`migrating sessions for project ${id}`)
  for (const sessionFile of await Glob.scan("storage/session/info/*.json", {
    cwd: fullProjectDir,
    absolute: true,
  })) {
    await migrateSessionMessages(dir, fullProjectDir, id, sessionFile)
  }
}

async function migration0(dir: string): Promise<void> {
  const project = path.resolve(dir, "../project")
  if (!(await Filesystem.isDir(project))) return
  const projectDirs = await Glob.scan("*", { cwd: project, include: "all" })
  for (const projectDir of projectDirs) {
    await migrateProject(dir, project, projectDir)
  }
}

async function migration1(dir: string): Promise<void> {
  for (const item of await Glob.scan("session/*/*.json", { cwd: dir, absolute: true })) {
    const session = await Filesystem.readJson<
      Record<string, unknown> & {
        id: string
        projectID?: string
        summary?: { diffs?: Array<{ additions: number; deletions: number }> }
      }
    >(item)
    if (!session.projectID) continue
    if (!session.summary?.diffs) continue
    const { diffs } = session.summary
    await Filesystem.write(path.join(dir, "session_diff", `${session.id}.json`), JSON.stringify(diffs))
    await Filesystem.writeJson(path.join(dir, "session", session.projectID, `${session.id}.json`), {
      ...session,
      summary: {
        additions: diffs.reduce((sum, x) => sum + x.additions, 0),
        deletions: diffs.reduce((sum, x) => sum + x.deletions, 0),
      },
    })
  }
}

const MIGRATIONS: Migration[] = [migration0, migration1]

const storageState = lazy(async () => {
  const dir = path.join(Global.Path.data, "storage")
  const migration = await Filesystem.readJson<string>(path.join(dir, "migration"))
    .then((x) => parseInt(x, 10))
    .catch(() => 0)
  for (let index = migration; index < MIGRATIONS.length; index++) {
    log.info("running migration", { index })
    const migration = MIGRATIONS[index]
    await migration(dir).catch(() => log.error("failed to run migration", { index }))
    await Filesystem.write(path.join(dir, "migration"), (index + 1).toString())
  }
  return {
    dir,
  }
})

async function storageRemove(key: string[]) {
  const dir = await storageState().then((x) => x.dir)
  const target = `${path.join(dir, ...key)}.json`
  return withErrorHandling(async () => {
    await fs.unlink(target).catch(() => {})
  })
}

async function storageRead<T>(key: string[]) {
  const dir = await storageState().then((x) => x.dir)
  const target = `${path.join(dir, ...key)}.json`
  return withErrorHandling(async () => {
    using _ = await Lock.read(target)
    const result = await Filesystem.readJson<T>(target)
    return result as T
  })
}

async function storageUpdate<T>(key: string[], fn: (draft: T) => void) {
  const dir = await storageState().then((x) => x.dir)
  const target = `${path.join(dir, ...key)}.json`
  return withErrorHandling(async () => {
    using _ = await Lock.write(target)
    const content = await Filesystem.readJson<T>(target)
    fn(content as T)
    await Filesystem.writeJson(target, content)
    return content
  })
}

async function storageWrite<T>(key: string[], content: T) {
  const dir = await storageState().then((x) => x.dir)
  const target = `${path.join(dir, ...key)}.json`
  return withErrorHandling(async () => {
    using _ = await Lock.write(target)
    await Filesystem.writeJson(target, content)
  })
}

async function withErrorHandling<T>(body: () => Promise<T>) {
  return body().catch((e) => {
    if (!(e instanceof Error)) throw e
    const errnoException = e as NodeJS.ErrnoException
    if (errnoException.code === "ENOENT") {
      throw new StorageNotFoundError({ message: `Resource not found: ${errnoException.path}` })
    }
    throw e
  })
}

async function storageList(prefix: string[]) {
  const dir = await storageState().then((x) => x.dir)
  try {
    const result = await Glob.scan("**/*", {
      cwd: path.join(dir, ...prefix),
      include: "file",
    }).then((results) => results.map((x) => [...prefix, ...x.slice(0, -5).split(path.sep)]))
    result.sort()
    return result
  } catch {
    return []
  }
}

export const Storage = {
  NotFoundError: StorageNotFoundError,
  remove: storageRemove,
  read: storageRead,
  update: storageUpdate,
  write: storageWrite,
  list: storageList,
} as const
