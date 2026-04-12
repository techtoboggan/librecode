import { BusEvent } from "@/bus/bus-event"
import { Bus } from "@/bus"
import z from "zod"
import { Instance } from "../project/instance"
import { Log } from "../util/log"
import { FileIgnore } from "./ignore"
import { Config } from "../config/config"
import path from "path"
// @ts-expect-error
import { createWrapper } from "@parcel/watcher/wrapper"
import { lazy } from "@/util/lazy"
import { withTimeout } from "@/util/timeout"
import type ParcelWatcher from "@parcel/watcher"
import { Flag } from "@/flag/flag"
import { readdir } from "fs/promises"
import { git } from "@/util/git"
import { Protected } from "./protected"

const SUBSCRIBE_TIMEOUT_MS = 10_000

declare const LIBRECODE_LIBC: string | undefined

export namespace FileWatcher {
  const log = Log.create({ service: "file.watcher" })

  export const Event = {
    Updated: BusEvent.define(
      "file.watcher.updated",
      z.object({
        file: z.string(),
        event: z.union([z.literal("add"), z.literal("change"), z.literal("unlink")]),
      }),
    ),
  }

  const watcher = lazy((): typeof import("@parcel/watcher") | undefined => {
    try {
      const binding = require(
        `@parcel/watcher-${process.platform}-${process.arch}${process.platform === "linux" ? `-${LIBRECODE_LIBC || "glibc"}` : ""}`,
      )
      return createWrapper(binding) as typeof import("@parcel/watcher")
    } catch (error) {
      log.error("failed to load watcher binding", { error })
      return
    }
  })

  function publishWatcherEvent(evt: ParcelWatcher.Event): void {
    if (evt.type === "create") Bus.publish(Event.Updated, { file: evt.path, event: "add" })
    if (evt.type === "update") Bus.publish(Event.Updated, { file: evt.path, event: "change" })
    if (evt.type === "delete") Bus.publish(Event.Updated, { file: evt.path, event: "unlink" })
  }

  function makeSubscribeCallback(): ParcelWatcher.SubscribeCallback {
    return (err, evts) => {
      if (err) return
      for (const evt of evts) {
        publishWatcherEvent(evt)
      }
    }
  }

  async function resolveVcsDir(): Promise<string | undefined> {
    const result = await git(["rev-parse", "--git-dir"], {
      cwd: Instance.worktree,
    })
    return result.exitCode === 0 ? path.resolve(Instance.worktree, result.text().trim()) : undefined
  }

  async function subscribeToDir(
    w: typeof import("@parcel/watcher"),
    dir: string,
    ignoreList: string[],
    backend: string,
    label: string,
  ): Promise<ParcelWatcher.AsyncSubscription | undefined> {
    const subscribe = makeSubscribeCallback()
    const pending = w.subscribe(dir, subscribe, { ignore: ignoreList, backend: backend as ParcelWatcher.BackendType })
    return withTimeout(pending, SUBSCRIBE_TIMEOUT_MS).catch((err) => {
      log.error(`failed to subscribe to ${label}`, { error: err })
      pending.then((s) => s.unsubscribe()).catch(() => {})
      return undefined
    })
  }

  function resolveBackend(): string | undefined {
    if (process.platform === "win32") return "windows"
    if (process.platform === "darwin") return "fs-events"
    if (process.platform === "linux") return "inotify"
    return undefined
  }

  async function subscribeMainDir(
    w: typeof import("@parcel/watcher"),
    backend: string,
    cfgIgnores: string[],
  ): Promise<ParcelWatcher.AsyncSubscription | undefined> {
    if (!Flag.LIBRECODE_EXPERIMENTAL_FILEWATCHER) return undefined
    return subscribeToDir(
      w,
      Instance.directory,
      [...FileIgnore.PATTERNS, ...cfgIgnores, ...Protected.paths()],
      backend,
      "Instance.directory",
    )
  }

  async function subscribeGitDir(
    w: typeof import("@parcel/watcher"),
    backend: string,
    cfgIgnores: string[],
  ): Promise<ParcelWatcher.AsyncSubscription | undefined> {
    if (Instance.project.vcs !== "git") return undefined
    const vcsDir = await resolveVcsDir()
    if (!vcsDir || cfgIgnores.includes(".git") || cfgIgnores.includes(vcsDir)) return undefined
    const gitDirContents = await readdir(vcsDir).catch(() => [])
    const ignoreList = gitDirContents.filter((entry) => entry !== "HEAD")
    return subscribeToDir(w, vcsDir, ignoreList, backend, "vcsDir")
  }

  const state = Instance.state(
    async () => {
      log.info("init")
      const cfg = await Config.get()
      const backend = resolveBackend()
      if (!backend) {
        log.error("watcher backend not supported", { platform: process.platform })
        return {}
      }
      log.info("watcher backend", { platform: process.platform, backend })

      const w = watcher()
      if (!w) return {}

      const cfgIgnores = cfg.watcher?.ignore ?? []
      const results = await Promise.all([
        subscribeMainDir(w, backend, cfgIgnores),
        subscribeGitDir(w, backend, cfgIgnores),
      ])
      const subs = results.filter((s): s is ParcelWatcher.AsyncSubscription => s !== undefined)

      return { subs }
    },
    async (state) => {
      if (!state.subs) return
      await Promise.all(state.subs.map((sub) => sub?.unsubscribe()))
    },
  )

  export function init(): void {
    if (Flag.LIBRECODE_EXPERIMENTAL_DISABLE_FILEWATCHER) {
      return
    }
    state()
  }
}
