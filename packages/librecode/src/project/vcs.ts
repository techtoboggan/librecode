import z from "zod"
import { Bus } from "@/bus"
import { BusEvent } from "@/bus/bus-event"
import { FileWatcher } from "@/file/watcher"
import { git } from "@/util/git"
import { Log } from "@/util/log"
import { Instance } from "./instance"

const log = Log.create({ service: "vcs" })

const VcsEvent = {
  BranchUpdated: BusEvent.define(
    "vcs.branch.updated",
    z.object({
      branch: z.string().optional(),
    }),
  ),
}

const VcsInfo = z
  .object({
    branch: z.string(),
  })
  .meta({
    ref: "VcsInfo",
  })

async function currentBranch(): Promise<string | undefined> {
  const result = await git(["rev-parse", "--abbrev-ref", "HEAD"], {
    cwd: Instance.worktree,
  })
  if (result.exitCode !== 0) return
  const text = result.text().trim()
  if (!text) return
  return text
}

const state = Instance.state(
  async () => {
    if (Instance.project.vcs !== "git") {
      return { branch: async () => undefined, unsubscribe: undefined }
    }
    let current = await currentBranch()
    log.info("initialized", { branch: current })

    const unsubscribe = Bus.subscribe(FileWatcher.Event.Updated, async (evt) => {
      if (!evt.properties.file.endsWith("HEAD")) return
      const next = await currentBranch()
      if (next !== current) {
        log.info("branch changed", { from: current, to: next })
        current = next
        Bus.publish(VcsEvent.BranchUpdated, { branch: next })
      }
    })

    return {
      branch: async () => current,
      unsubscribe,
    }
  },
  async (s) => {
    s.unsubscribe?.()
  },
)

async function vcsInit(): Promise<ReturnType<typeof state>> {
  return state()
}

async function vcsBranch(): Promise<string | undefined> {
  return await state().then((s) => s.branch())
}

export const Vcs = {
  Event: VcsEvent,
  Info: VcsInfo,
  init: vcsInit,
  branch: vcsBranch,
} as const
// biome-ignore lint/style/noNamespace: type companion for declaration merging
export declare namespace Vcs {
  type Info = z.infer<typeof VcsInfo>
}
