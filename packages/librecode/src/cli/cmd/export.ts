import type { Argv } from "yargs"
import { Session } from "../../session"
import { SessionID } from "../../session/schema"
import { cmd } from "./cmd"
import { bootstrap } from "../bootstrap"
import { UI } from "../ui"
import * as prompts from "@clack/prompts"
import { EOL } from "os"

async function selectSessionInteractive(): Promise<typeof SessionID.Type | undefined> {
  UI.empty()
  prompts.intro("Export session", { output: process.stderr })

  const sessions: Session.Info[] = []
  for await (const session of Session.list()) sessions.push(session)

  if (sessions.length === 0) {
    prompts.log.error("No sessions found", { output: process.stderr })
    prompts.outro("Done", { output: process.stderr })
    return undefined
  }

  sessions.sort((a, b) => b.time.updated - a.time.updated)

  const selected = await prompts.autocomplete({
    message: "Select session to export",
    maxItems: 10,
    options: sessions.map((s) => ({
      label: s.title,
      value: s.id,
      hint: `${new Date(s.time.updated).toLocaleString()} • ${s.id.slice(-8)}`,
    })),
    output: process.stderr,
  })

  if (prompts.isCancel(selected)) throw new UI.CancelledError()
  prompts.outro("Exporting session...", { output: process.stderr })
  return selected
}

export const ExportCommand = cmd({
  command: "export [sessionID]",
  describe: "export session data as JSON",
  builder: (yargs: Argv) => {
    return yargs.positional("sessionID", {
      describe: "session id to export",
      type: "string",
    })
  },
  handler: async (args) => {
    await bootstrap(process.cwd(), async () => {
      let sessionID = args.sessionID ? SessionID.make(args.sessionID) : undefined
      process.stderr.write(`Exporting session: ${sessionID ?? "latest"}\n`)

      if (!sessionID) {
        sessionID = await selectSessionInteractive()
        if (!sessionID) return
      }

      try {
        const sessionInfo = await Session.get(sessionID!)
        const messages = await Session.messages({ sessionID: sessionInfo.id })
        const exportData = {
          info: sessionInfo,
          messages: messages.map((msg) => ({ info: msg.info, parts: msg.parts })),
        }
        process.stdout.write(JSON.stringify(exportData, null, 2))
        process.stdout.write(EOL)
      } catch {
        UI.error(`Session not found: ${sessionID!}`)
        process.exit(1)
      }
    })
  },
})
