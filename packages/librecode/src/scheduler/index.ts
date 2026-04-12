import { Instance } from "../project/instance"
import { Log } from "../util/log"

const log = Log.create({ service: "scheduler" })

export type SchedulerTask = {
  id: string
  interval: number
  run: () => Promise<void>
  scope?: "instance" | "global"
}

type Timer = ReturnType<typeof setInterval>
type Entry = {
  tasks: Map<string, SchedulerTask>
  timers: Map<string, Timer>
}

const createEntry = (): Entry => {
  const tasks = new Map<string, SchedulerTask>()
  const timers = new Map<string, Timer>()
  return { tasks, timers }
}

const shared = createEntry()

const state = Instance.state(
  () => createEntry(),
  async (entry) => {
    for (const timer of entry.timers.values()) {
      clearInterval(timer)
    }
    entry.tasks.clear()
    entry.timers.clear()
  },
)

async function run(task: SchedulerTask) {
  log.info("run", { id: task.id })
  await task.run().catch((error) => {
    log.error("run failed", { id: task.id, error })
  })
}

function register(task: SchedulerTask) {
  const scope = task.scope ?? "instance"
  const entry = scope === "global" ? shared : state()
  const current = entry.timers.get(task.id)
  if (current && scope === "global") return
  if (current) clearInterval(current)

  entry.tasks.set(task.id, task)
  void run(task)
  const timer = setInterval(() => {
    void run(task)
  }, task.interval)
  timer.unref()
  entry.timers.set(task.id, timer)
}

export const Scheduler = {
  register,
} as const
