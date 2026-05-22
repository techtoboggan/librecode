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
    ["git", "-c", "core.longpaths=true", "-c", "core.symlinks=true", ...snapshotArgs(git, ["read-tree", snapshot])],
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

type RevertOp = { hash: string; file: string; rel: string }

/** Paths that would interfere if checked out in the same batch — e.g.
 *  `foo` (a file) and `foo/bar` (a path inside a now-deleted dir).
 *  Adjacent ops with this relationship must be reverted one at a time
 *  so git's checkout doesn't trip over half-applied state. */
function pathsClash(a: string, b: string): boolean {
  return a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`)
}

/**
 * Phase 39 / upstream #20564 — batch snapshot revert without reordering.
 *
 * Previously: one `git checkout HASH -- <file>` subprocess per file. A
 * 200-file revert spawned 200 git processes; large reverts (project-wide
 * rollback after a botched refactor) could take 30+ seconds with most of
 * the time in subprocess overhead. Worse, on Windows the spawn cost is
 * 5-10× higher.
 *
 * Now: walk the ops list in order (preserving patch sequence — crucial
 * for cases where `foo` is a file in one patch and `foo/bar` exists in
 * a later patch). Group adjacent same-hash operations whose paths don't
 * clash into a single `git checkout HASH -- f1 f2 ...` call, gated by
 * a single `git ls-tree --name-only HASH -- <rels...>` to pre-filter
 * paths that don't exist in the snapshot. A 200-file revert now takes
 * 2-5 git subprocesses.
 *
 * Safety: every batched failure falls back to per-file revert (the
 * pre-fix code path). The `pathsClash` predicate ensures we never batch
 * operations that could interact with each other.
 */
async function snapshotRevert(patches: SnapshotPatch[]): Promise<void> {
  const git = snapshotGitdir()
  const seen = new Set<string>()
  const ops: RevertOp[] = []
  for (const item of patches) {
    for (const file of item.files) {
      if (seen.has(file)) continue
      seen.add(file)
      ops.push({
        hash: item.hash,
        file,
        rel: path.relative(Instance.worktree, file).replaceAll("\\", "/"),
      })
    }
  }

  for (let i = 0; i < ops.length; ) {
    const first = ops[i]!
    const run: RevertOp[] = [first]
    let j = i + 1
    while (j < ops.length && run.length < 100) {
      const next = ops[j]!
      if (next.hash !== first.hash) break
      if (run.some((op) => pathsClash(op.rel, next.rel))) break
      run.push(next)
      j += 1
    }

    if (run.length === 1) {
      await revertFile(git, first.file, first.hash)
      i = j
      continue
    }

    await revertBatch(git, run)
    i = j
  }
}

/** Phase 39 — multi-file checkout for a run of same-hash ops. */
async function revertBatch(git: string, run: RevertOp[]): Promise<void> {
  const hash = run[0]!.hash
  const tree = await Process.text(
    [
      "git",
      "-c",
      "core.longpaths=true",
      "-c",
      "core.symlinks=true",
      ...snapshotArgs(git, ["ls-tree", "--name-only", hash, "--", ...run.map((op) => op.rel)]),
    ],
    { cwd: Instance.worktree, nothrow: true },
  )

  if (tree.code !== 0) {
    snapshotLog.info("batched ls-tree failed, falling back to single-file revert", { hash, files: run.length })
    for (const op of run) await revertFile(git, op.file, op.hash)
    return
  }

  const have = new Set(
    tree.text
      .trim()
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean),
  )
  const existing = run.filter((op) => have.has(op.rel))
  const missing = run.filter((op) => !have.has(op.rel))

  if (existing.length > 0) {
    snapshotLog.info("reverting", { hash, files: existing.length })
    const result = await Process.run(
      [
        "git",
        "-c",
        "core.longpaths=true",
        "-c",
        "core.symlinks=true",
        ...snapshotArgs(git, ["checkout", hash, "--", ...existing.map((op) => op.file)]),
      ],
      { cwd: Instance.worktree, nothrow: true },
    )
    if (result.code !== 0) {
      snapshotLog.info("batched checkout failed, falling back to single-file revert", {
        hash,
        files: existing.length,
      })
      for (const op of existing) await revertFile(git, op.file, op.hash)
    }
  }

  // Files not present in the snapshot get deleted — same intent as the
  // single-file path's handleRevertFailure when ls-tree returns empty.
  for (const op of missing) {
    snapshotLog.info("file did not exist in snapshot, deleting", { file: op.file, hash })
    await fs.unlink(op.file).catch(() => {})
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
