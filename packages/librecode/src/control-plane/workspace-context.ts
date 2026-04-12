import { Context } from "../util/context"
import type { WorkspaceID } from "./schema"

interface WorkspaceData {
  workspaceID?: WorkspaceID
}

const context = Context.create<WorkspaceData>("workspace")

export const WorkspaceContext = {
  async provide<R>(input: { workspaceID?: WorkspaceID; fn: () => R }): Promise<R> {
    return context.provide({ workspaceID: input.workspaceID }, async () => {
      return input.fn()
    })
  },

  get workspaceID() {
    try {
      return context.use().workspaceID
    } catch (_e) {
      return undefined
    }
  },
}
