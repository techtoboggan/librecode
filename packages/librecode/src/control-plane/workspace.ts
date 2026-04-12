import z from "zod"
import { BusEvent } from "@/bus/bus-event"
import { GlobalBus } from "@/bus/global"
import type { Project } from "@/project/project"
import { ProjectID } from "@/project/schema"
import { Database, eq } from "@/storage/db"
import { fn } from "@/util/fn"
import { Log } from "@/util/log"
import { getAdaptor } from "./adaptors"
import { WorkspaceID } from "./schema"
import { parseSSE } from "./sse"
import { WorkspaceInfo } from "./types"
import { WorkspaceTable } from "./workspace.sql"

const WorkspaceEvent = {
  Ready: BusEvent.define(
    "workspace.ready",
    z.object({
      name: z.string(),
    }),
  ),
  Failed: BusEvent.define(
    "workspace.failed",
    z.object({
      message: z.string(),
    }),
  ),
}

const WorkspaceInfoSchema = WorkspaceInfo.meta({
  ref: "Workspace",
})
type WorkspaceInfoType = z.infer<typeof WorkspaceInfoSchema>

function fromRow(row: typeof WorkspaceTable.$inferSelect): WorkspaceInfoType {
  return {
    id: row.id,
    type: row.type,
    branch: row.branch,
    name: row.name,
    directory: row.directory,
    extra: row.extra,
    projectID: row.project_id,
  }
}

const CreateInput = z.object({
  id: WorkspaceID.zod.optional(),
  type: WorkspaceInfoSchema.shape.type,
  branch: WorkspaceInfoSchema.shape.branch,
  projectID: ProjectID.zod,
  extra: WorkspaceInfoSchema.shape.extra,
})

const workspaceCreate = fn(CreateInput, async (input) => {
  const id = WorkspaceID.ascending(input.id)
  const adaptor = await getAdaptor(input.type)

  const config = await adaptor.configure({ ...input, id, name: null, directory: null })

  const info: WorkspaceInfoType = {
    id,
    type: config.type,
    branch: config.branch ?? null,
    name: config.name ?? null,
    directory: config.directory ?? null,
    extra: config.extra ?? null,
    projectID: input.projectID,
  }

  Database.use((db) => {
    db.insert(WorkspaceTable)
      .values({
        id: info.id,
        type: info.type,
        branch: info.branch,
        name: info.name,
        directory: info.directory,
        extra: info.extra,
        project_id: info.projectID,
      })
      .run()
  })

  await adaptor.create(config)
  return info
})

function workspaceList(project: Project.Info) {
  const rows = Database.use((db) =>
    db.select().from(WorkspaceTable).where(eq(WorkspaceTable.project_id, project.id)).all(),
  )
  return rows.map(fromRow).sort((a, b) => a.id.localeCompare(b.id))
}

const workspaceGet = fn(WorkspaceID.zod, async (id) => {
  const row = Database.use((db) => db.select().from(WorkspaceTable).where(eq(WorkspaceTable.id, id)).get())
  if (!row) return
  return fromRow(row)
})

const workspaceRemove = fn(WorkspaceID.zod, async (id) => {
  const row = Database.use((db) => db.select().from(WorkspaceTable).where(eq(WorkspaceTable.id, id)).get())
  if (row) {
    const info = fromRow(row)
    const adaptor = await getAdaptor(row.type)
    adaptor.remove(info)
    Database.use((db) => db.delete(WorkspaceTable).where(eq(WorkspaceTable.id, id)).run())
    return info
  }
})

const log = Log.create({ service: "workspace-sync" })

async function workspaceEventLoop(space: WorkspaceInfoType, stop: AbortSignal) {
  while (!stop.aborted) {
    const adaptor = await getAdaptor(space.type)
    const res = await adaptor.fetch(space, "/event", { method: "GET", signal: stop }).catch(() => undefined)
    if (!res?.ok || !res.body) {
      await Bun.sleep(1000)
      continue
    }
    await parseSSE(res.body, stop, (event) => {
      GlobalBus.emit("event", {
        directory: space.id,
        payload: event,
      })
    })
    // Wait 250ms and retry if SSE connection fails
    await Bun.sleep(250)
  }
}

function workspaceStartSyncing(project: Project.Info) {
  const stop = new AbortController()
  const spaces = workspaceList(project).filter((space) => space.type !== "worktree")

  spaces.forEach((space) => {
    void workspaceEventLoop(space, stop.signal).catch((error) => {
      log.warn("workspace sync listener failed", {
        workspaceID: space.id,
        error,
      })
    })
  })

  return {
    async stop() {
      stop.abort()
    },
  }
}

export const Workspace = {
  Event: WorkspaceEvent,
  Info: WorkspaceInfoSchema,
  create: workspaceCreate,
  list: workspaceList,
  get: workspaceGet,
  remove: workspaceRemove,
  startSyncing: workspaceStartSyncing,
} as const

// biome-ignore lint/style/noNamespace: type companion for declaration merging
export declare namespace Workspace {
  type Info = WorkspaceInfoType
}
