import z from "zod"
import { Bus } from "@/bus"
import { BusEvent } from "@/bus/bus-event"
import { asc, Database, eq } from "../storage/db"
import { SessionID } from "./schema"
import { TodoTable } from "./session.sql"

export namespace Todo {
  export const Info = z
    .object({
      content: z.string().describe("Brief description of the task"),
      status: z.string().describe("Current status of the task: pending, in_progress, completed, cancelled"),
      priority: z.string().describe("Priority level of the task: high, medium, low"),
    })
    .meta({ ref: "Todo" })
  export type Info = z.infer<typeof Info>

  export const Event = {
    Updated: BusEvent.define(
      "todo.updated",
      z.object({
        sessionID: SessionID.zod,
        todos: z.array(Info),
      }),
    ),
  }

  export function update(input: { sessionID: SessionID; todos: Info[] }) {
    Database.transaction((db) => {
      db.delete(TodoTable).where(eq(TodoTable.session_id, input.sessionID)).run()
      if (input.todos.length === 0) return
      db.insert(TodoTable)
        .values(
          input.todos.map((todo, position) => ({
            session_id: input.sessionID,
            content: todo.content,
            status: todo.status,
            priority: todo.priority,
            position,
          })),
        )
        .run()
    })
    Bus.publish(Event.Updated, input)
  }

  export function get(sessionID: SessionID) {
    const rows = Database.use((db) =>
      db.select().from(TodoTable).where(eq(TodoTable.session_id, sessionID)).orderBy(asc(TodoTable.position)).all(),
    )
    return rows.map((row) => ({
      content: row.content,
      status: row.status,
      priority: row.priority,
    }))
  }
}
