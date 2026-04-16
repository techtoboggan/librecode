import { EOL } from "node:os"
import type { Message, Part, Session as SDKSession } from "@librecode/sdk/v2"
import type { Argv } from "yargs"
import { Instance } from "../../project/instance"
import { Session } from "../../session"
import { MessageV2 } from "../../session/message-v2"
import { MessageTable, PartTable, SessionTable } from "../../session/session.sql"
import { Database } from "../../storage/db"
import { Filesystem } from "../../util/filesystem"
import { bootstrap } from "../bootstrap"
import { cmd } from "./cmd"

type ExportData = { info: SDKSession; messages: Array<{ info: Message; parts: Part[] }> }

function saveSessionToDb(exportData: ExportData): void {
  const info = Session.Info.parse({ ...exportData.info, projectID: Instance.project.id })
  const row = Session.toRow(info)
  Database.use((db) =>
    db
      .insert(SessionTable)
      .values(row)
      .onConflictDoUpdate({ target: SessionTable.id, set: { project_id: row.project_id } })
      .run(),
  )
  for (const msg of exportData.messages) {
    const msgInfo = MessageV2.Info.parse(msg.info)
    const { id, sessionID: _, ...msgData } = msgInfo
    Database.use((db) =>
      db
        .insert(MessageTable)
        .values({ id, session_id: row.id, time_created: msgInfo.time?.created ?? Date.now(), data: msgData })
        .onConflictDoNothing()
        .run(),
    )
    for (const part of msg.parts) {
      const partInfo = MessageV2.Part.parse(part)
      const { id: partId, sessionID: _s, messageID, ...partData } = partInfo
      Database.use((db) =>
        db
          .insert(PartTable)
          .values({ id: partId, message_id: messageID, session_id: row.id, data: partData })
          .onConflictDoNothing()
          .run(),
      )
    }
  }
}

export const ImportCommand = cmd({
  command: "import <file>",
  describe: "import session data from a JSON file",
  builder: (yargs: Argv) => {
    return yargs.positional("file", {
      describe: "path to JSON export file",
      type: "string",
      demandOption: true,
    })
  },
  handler: async (args) => {
    await bootstrap(process.cwd(), async () => {
      const exportData = await Filesystem.readJson<ExportData>(args.file).catch(() => undefined)
      if (!exportData) {
        process.stdout.write(`File not found: ${args.file}${EOL}`)
        return
      }
      saveSessionToDb(exportData)
      process.stdout.write(`Imported session: ${exportData.info.id}${EOL}`)
    })
  },
})
