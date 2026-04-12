import fs from "node:fs/promises"
import path from "node:path"
import z from "zod"
import { Process } from "@/util/process"
import { Config } from "../config/config"
import { Global } from "../global"
import { Instance } from "../project/instance"
import { Scheduler } from "../scheduler"
import { Filesystem } from "../util/filesystem"
import { Log } from "../util/log"

const snapshotLog = Log.create({ service: "snapshot" })
const snapshotHour = 60 * 60 * 1000
const snapshotPrune = "7.days"

function snapshotArgs(git: string, cmd: string[]) {
  return ["--git-dir", git, "--work-tree", Instance.worktree, ...cmd]
}

function snapshotInit(): void {
  Scheduler.register({
    id: "snapshot.cleanup",
    interval: snapshotHour,
    run: snapshotCleanup,
    scope: "instance",
  })
}

async function snapshotCleanup(): Promise<void> {
  if (Instance.project.vcs !== "git") return
  const cfg = await Config.get()
  if (cfg.snapshot === false) return
  const git = snapshotGitdir()
  const exists = await fs
    .stat(git)
    .then(() => true)
    .catch(() => false)
  if (!exists) return
  const result = await Process.run(["git", ...snapshotArgs(git, ["gc", `--prune=${snapshotPrune}`])], {
    cwd: Instance.directory,
    nothrow: true,
  })
  if (result.code !== 0) {
    snapshotLog.warn("cleanup failed", {
      exitCode: result.code,
      stderr: result.stderr.toString(),
      stdout: result.stdout.toString(),
    })
    return
  }
  snapshotLog.info("cleanup", { prune: snapshotPrune })
}

async function snapshotTrack(): Promise<string | undefined> {
  if (Instance.project.vcs !== "git") return
  const cfg = await Config.get()
  if (cfg.snapshot === false) return
  const git = snapshotGitdir()
  if (await fs.mkdir(git, { recursive: true })) {
    await Process.run(["git", "init"], {
      env: {
        ...process.env,
        GIT_DIR: git,
        GIT_WORK_TREE: Instance.worktree,
      },
      nothrow: true,
    })

    // Configure git to not convert line endings on Windows
    await Process.run(["git", "--git-dir", git, "config", "core.autocrlf", "false"], { nothrow: true })
    await Process.run(["git", "--git-dir", git, "config", "core.longpaths", "true"], { nothrow: true })
    await Process.run(["git", "--git-dir", git, "config", "core.symlinks", "true"], { nothrow: true })
    await Process.run(["git", "--git-dir", git, "config", "core.fsmonitor", "false"], { nothrow: true })
    snapshotLog.info("initialized")
  }
  await snapshotAdd(git)
  const hash = await Process.text(["git", ...snapshotArgs(git, ["write-tree"])], {
    cwd: Instance.directory,
    nothrow: true,
  }).then((x) => x.text)
  snapshotLog.info("tracking", { hash, cwd: Instance.directory, git })
  return hash.trim()
}

export const SnapshotPatch = z.object({
  hash: z.string(),
  files: z.string().array(),
})
export type SnapshotPatch = z.infer<typeof SnapshotPatch>

async function snapshotPatchFn(hash: string): Promise<SnapshotPatch> {
  const git = snapshotGitdir()
  await snapshotAdd(git)
  const result = await Process.text(
    [
      "git",
      "-c",
      "core.autocrlf=false",
      "-c",
      "core.longpaths=true",
      "-c",
      "core.symlinks=true",
      "-c",
      "core.quotepath=false",
      ...snapshotArgs(git, ["diff", "--no-ext-diff", "--name-only", hash, "--", "."]),
    ],
    {
      cwd: Instance.directory,
      nothrow: true,
    },
  )

  // If git diff fails, return empty patch
  if (result.code !== 0) {
    snapshotLog.warn("failed to get diff", { hash, exitCode: result.code })
    return { hash, files: [] }
  }

  const files = result.text
  return {
    hash,
    files: files
      .trim()
      .split("\n")
      .map((x) => x.trim())
      .filter(Boolean)
      .map((x) => path.join(Instance.worktree, x).replaceAll("\\", "/")),
  }
}

async function snapshotRestore(snapshot: string): Promise<void> {
  snapshotLog.info("restore", { commit: snapshot })
  const git = snapshotGitdir()
  const result = await Process.run(
    [
      "git",
      "-c",
      "core.longpaths=true",
      "-c",
      "core.symlinks=true",
      ...snapshotArgs(git, ["read-tree", snapshot]),
    ],
    {
      cwd: Instance.worktree,
      nothrow: true,
    },
  )
  if (result.code === 0) {
    const checkout = await Process.run(
      [
        "git",
        "-c",
        "core.longpaths=true",
        "-c",
        "core.symlinks=true",
        ...snapshotArgs(git, ["checkout-index", "-a", "-f"]),
      ],
      {
        cwd: Instance.worktree,
        nothrow: true,
      },
    )
    if (checkout.code === 0) return
    snapshotLog.error("failed to restore snapshot", {
      snapshot,
      exitCode: checkout.code,
      stderr: checkout.stderr.toString(),
      stdout: checkout.stdout.toString(),
    })
    return
  }

  snapshotLog.error("failed to restore snapshot", {
    snapshot,
    exitCode: result.code,
    stderr: result.stderr.toString(),
    stdout: result.stdout.toString(),
  })
}

async function snapshotRevert(patches: SnapshotPatch[]): Promise<void> {
  const files = new Set<string>()
  const git = snapshotGitdir()
  for (const item of patches) {
    for (const file of item.files) {
      if (files.has(file)) continue
      await revertFile(git, file, item.hash)
      files.add(file)
    }
  }
}

async function revertFile(git: string, file: string, hash: string): Promise<void> {
  snapshotLog.info("reverting", { file, hash })
  const result = await Process.run(
    [
      "git",
      "-c",
      "core.longpaths=true",
      "-c",
      "core.symlinks=true",
      ...snapshotArgs(git, ["checkout", hash, "--", file]),
    ],
    { cwd: Instance.worktree, nothrow: true },
  )
  if (result.code === 0) return
  await handleRevertFailure(git, file, hash)
}

async function handleRevertFailure(git: string, file: string, hash: string): Promise<void> {
  const relativePath = path.relative(Instance.worktree, file)
  const checkTree = await Process.text(
    [
      "git",
      "-c",
      "core.longpaths=true",
      "-c",
      "core.symlinks=true",
      ...snapshotArgs(git, ["ls-tree", hash, "--", relativePath]),
    ],
    { cwd: Instance.worktree, nothrow: true },
  )
  if (checkTree.code === 0 && checkTree.text.trim()) {
    snapshotLog.info("file existed in snapshot but checkout failed, keeping", { file })
  } else {
    snapshotLog.info("file did not exist in snapshot, deleting", { file })
    await fs.unlink(file).catch(() => {})
  }
}

async function snapshotDiff(hash: string): Promise<string> {
  const git = snapshotGitdir()
  await snapshotAdd(git)
  const result = await Process.text(
    [
      "git",
      "-c",
      "core.autocrlf=false",
      "-c",
      "core.longpaths=true",
      "-c",
      "core.symlinks=true",
      "-c",
      "core.quotepath=false",
      ...snapshotArgs(git, ["diff", "--no-ext-diff", hash, "--", "."]),
    ],
    {
      cwd: Instance.worktree,
      nothrow: true,
    },
  )

  if (result.code !== 0) {
    snapshotLog.warn("failed to get diff", {
      hash,
      exitCode: result.code,
      stderr: result.stderr.toString(),
      stdout: result.stdout.toString(),
    })
    return ""
  }

  return result.text.trim()
}

export const SnapshotFileDiff = z
  .object({
    file: z.string(),
    before: z.string(),
    after: z.string(),
    additions: z.number(),
    deletions: z.number(),
    status: z.enum(["added", "deleted", "modified"]).optional(),
  })
  .meta({
    ref: "FileDiff",
  })
export type SnapshotFileDiff = z.infer<typeof SnapshotFileDiff>

async function fetchFileStatusMap(
  git: string,
  from: string,
  to: string,
): Promise<Map<string, "added" | "deleted" | "modified">> {
  const status = new Map<string, "added" | "deleted" | "modified">()
  const statuses = await Process.text(
    [
      "git",
      "-c",
      "core.autocrlf=false",
      "-c",
      "core.longpaths=true",
      "-c",
      "core.symlinks=true",
      "-c",
      "core.quotepath=false",
      ...snapshotArgs(git, ["diff", "--no-ext-diff", "--name-status", "--no-renames", from, to, "--", "."]),
    ],
    { cwd: Instance.directory, nothrow: true },
  ).then((x) => x.text)

  for (const line of statuses.trim().split("\n")) {
    if (!line) continue
    const [code, file] = line.split("\t")
    if (!code || !file) continue
    const kind = code.startsWith("A") ? "added" : code.startsWith("D") ? "deleted" : "modified"
    status.set(file, kind)
  }
  return status
}

async function fetchFileContent(git: string, ref: string, file: string): Promise<string> {
  return Process.text(
    [
      "git",
      "-c",
      "core.autocrlf=false",
      "-c",
      "core.longpaths=true",
      "-c",
      "core.symlinks=true",
      ...snapshotArgs(git, ["show", `${ref}:${file}`]),
    ],
    { nothrow: true },
  ).then((x) => x.text)
}

async function buildFileDiff(
  git: string,
  line: string,
  from: string,
  to: string,
  status: Map<string, "added" | "deleted" | "modified">,
): Promise<SnapshotFileDiff | undefined> {
  if (!line) return undefined
  const [additions, deletions, file] = line.split("\t")
  if (!file) return undefined
  const isBinary = additions === "-" && deletions === "-"
  const before = isBinary ? "" : await fetchFileContent(git, from, file)
  const after = isBinary ? "" : await fetchFileContent(git, to, file)
  const added = isBinary ? 0 : parseInt(additions, 10)
  const deleted = isBinary ? 0 : parseInt(deletions, 10)
  return {
    file,
    before,
    after,
    additions: Number.isFinite(added) ? added : 0,
    deletions: Number.isFinite(deleted) ? deleted : 0,
    status: status.get(file) ?? "modified",
  }
}

async function snapshotDiffFull(from: string, to: string): Promise<SnapshotFileDiff[]> {
  const git = snapshotGitdir()
  const status = await fetchFileStatusMap(git, from, to)
  const numstatLines = await Process.lines(
    [
      "git",
      "-c",
      "core.autocrlf=false",
      "-c",
      "core.longpaths=true",
      "-c",
      "core.symlinks=true",
      "-c",
      "core.quotepath=false",
      ...snapshotArgs(git, ["diff", "--no-ext-diff", "--no-renames", "--numstat", from, to, "--", "."]),
    ],
    { cwd: Instance.directory, nothrow: true },
  )
  const result: SnapshotFileDiff[] = []
  for (const line of numstatLines) {
    const entry = await buildFileDiff(git, line, from, to, status)
    if (entry) result.push(entry)
  }
  return result
}

function snapshotGitdir(): string {
  const project = Instance.project
  return path.join(Global.Path.data, "snapshot", project.id)
}

async function snapshotAdd(git: string): Promise<void> {
  await syncExclude(git)
  await Process.run(
    [
      "git",
      "-c",
      "core.autocrlf=false",
      "-c",
      "core.longpaths=true",
      "-c",
      "core.symlinks=true",
      ...snapshotArgs(git, ["add", "."]),
    ],
    {
      cwd: Instance.directory,
      nothrow: true,
    },
  )
}

async function syncExclude(git: string): Promise<void> {
  const file = await excludes()
  const target = path.join(git, "info", "exclude")
  await fs.mkdir(path.join(git, "info"), { recursive: true })
  if (!file) {
    await Filesystem.write(target, "")
    return
  }
  const text = await Filesystem.readText(file).catch(() => "")

  await Filesystem.write(target, text)
}

async function excludes(): Promise<string | undefined> {
  const file = await Process.text(["git", "rev-parse", "--path-format=absolute", "--git-path", "info/exclude"], {
    cwd: Instance.worktree,
    nothrow: true,
  }).then((x) => x.text)
  if (!file.trim()) return
  const exists = await fs
    .stat(file.trim())
    .then(() => true)
    .catch(() => false)
  if (!exists) return
  return file.trim()
}

export const Snapshot = {
  Patch: SnapshotPatch,
  FileDiff: SnapshotFileDiff,
  init: snapshotInit,
  cleanup: snapshotCleanup,
  track: snapshotTrack,
  patch: snapshotPatchFn,
  restore: snapshotRestore,
  revert: snapshotRevert,
  diff: snapshotDiff,
  diffFull: snapshotDiffFull,
} as const
