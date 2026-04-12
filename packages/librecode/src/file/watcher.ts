import { readdir } from "node:fs/promises"
import path from "node:path"
import type ParcelWatcher from "@parcel/watcher"
// @ts-expect-error
import { createWrapper } from "@parcel/watcher/wrapper"
import z from "zod"
import { Bus } from "@/bus"
import { BusEvent } from "@/bus/bus-event"
import { Flag } from "@/flag/flag"
import { git } from "@/util/git"
import { lazy } from "@/util/lazy"
import { withTimeout } from "@/util/timeout"
import { Config } from "../config/config"
import { Instance } from "../project/instance"
import { Log } from "../util/log"
import { FileIgnore } from "./ignore"
import { Protected } from "./protected"

const SUBSCRIBE_TIMEOUT_MS = 10_000

declare const LIBRECODE_LIBC: string | undefined

const _fwLog = Log.create({ service: "file.watcher" })

const _fwEvent = {
  Updated: BusEvent.define(
    "file.watcher.updated",
    z.object({
      file: z.string(),
      event: z.union([z.literal("add"), z.literal("change"), z.literal("unlink")]),
    }),
  ),
}

const _fwWatcher = lazy((): typeof import("@parcel/watcher") | undefined => {
  try {
    const binding = require(
      `@parcel/watcher-${process.platform}-${process.arch}${process.platform === "linux" ? `-${LIBRECODE_LIBC || "glibc"}` : ""}`,
    )
    return createWrapper(binding) as typeof import("@parcel/watcher")
  } catch (error) {
    _fwLog.error("failed to load watcher binding", { error })
    return
  }
})

function _fwPublishEvent(evt: ParcelWatcher.Event): void {
  if (evt.type === "create") Bus.publish(_fwEvent.Updated, { file: evt.path, event: "add" })
  if (evt.type === "update") Bus.publish(_fwEvent.Updated, { file: evt.path, event: "change" })
  if (evt.type === "delete") Bus.publish(_fwEvent.Updated, { file: evt.path, event: "unlink" })
}

function _fwMakeSubscribeCallback(): ParcelWatcher.SubscribeCallback {
  return (err, evts) => {
    if (err) return
    for (const evt of evts) {
      _fwPublishEvent(evt)
    }
  }
}

async function _fwResolveVcsDir(): Promise<string | undefined> {
  const result = await git(["rev-parse", "--git-dir"], {
    cwd: Instance.worktree,
  })
  return result.exitCode === 0 ? path.resolve(Instance.worktree, result.text().trim()) : undefined
}

async function _fwSubscribeToDir(
  w: typeof import("@parcel/watcher"),
  dir: string,
  ignoreList: string[],
  backend: string,
  label: string,
): Promise<ParcelWatcher.AsyncSubscription | undefined> {
  const subscribe = _fwMakeSubscribeCallback()
  const pending = w.subscribe(dir, subscribe, { ignore: ignoreList, backend: backend as ParcelWatcher.BackendType })
  return withTimeout(pending, SUBSCRIBE_TIMEOUT_MS).catch((err) => {
    _fwLog.error(`failed to subscribe to ${label}`, { error: err })
    pending.then((s) => s.unsubscribe()).catch(() => {})
    return undefined
  })
}

function _fwResolveBackend(): string | undefined {
  if (process.platform === "win32") return "windows"
  if (process.platform === "darwin") return "fs-events"
  if (process.platform === "linux") return "inotify"
  return undefined
}

async function _fwSubscribeMainDir(
  w: typeof import("@parcel/watcher"),
  backend: string,
  cfgIgnores: string[],
): Promise<ParcelWatcher.AsyncSubscription | undefined> {
  if (!Flag.LIBRECODE_EXPERIMENTAL_FILEWATCHER) return undefined
  return _fwSubscribeToDir(
    w,
    Instance.directory,
    [...FileIgnore.PATTERNS, ...cfgIgnores, ...Protected.paths()],
    backend,
    "Instance.directory",
  )
}

async function _fwSubscribeGitDir(
  w: typeof import("@parcel/watcher"),
  backend: string,
  cfgIgnores: string[],
): Promise<ParcelWatcher.AsyncSubscription | undefined> {
  if (Instance.project.vcs !== "git") return undefined
  const vcsDir = await _fwResolveVcsDir()
  if (!vcsDir || cfgIgnores.includes(".git") || cfgIgnores.includes(vcsDir)) return undefined
  const gitDirContents = await readdir(vcsDir).catch(() => [])
  const ignoreList = gitDirContents.filter((entry) => entry !== "HEAD")
  return _fwSubscribeToDir(w, vcsDir, ignoreList, backend, "vcsDir")
}

const _fwState = Instance.state(
  async () => {
    _fwLog.info("init")
    const cfg = await Config.get()
    const backend = _fwResolveBackend()
    if (!backend) {
      _fwLog.error("watcher backend not supported", { platform: process.platform })
      return {}
    }
    _fwLog.info("watcher backend", { platform: process.platform, backend })

    const w = _fwWatcher()
    if (!w) return {}

    const cfgIgnores = cfg.watcher?.ignore ?? []
    const results = await Promise.all([
      _fwSubscribeMainDir(w, backend, cfgIgnores),
      _fwSubscribeGitDir(w, backend, cfgIgnores),
    ])
    const subs = results.filter((s): s is ParcelWatcher.AsyncSubscription => s !== undefined)

    return { subs }
  },
  async (state) => {
    if (!state.subs) return
    await Promise.all(state.subs.map((sub) => sub?.unsubscribe()))
  },
)

function fileWatcherInit(): void {
  if (Flag.LIBRECODE_EXPERIMENTAL_DISABLE_FILEWATCHER) {
    return
  }
  _fwState()
}

export const FileWatcher = {
  Event: _fwEvent,
  init: fileWatcherInit,
} as const
