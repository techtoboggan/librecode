import type { Argv } from "yargs"
import { Database } from "../../storage/db"
import { cmd } from "./cmd"

const QueryCommand = cmd({
  command: "query <sql>",
  describe: "run a SQL query against the database",
  handler: async (args: any) => {
    const sqlite = Database.Client().$client
    const result = sqlite.prepare(args.sql).all()
    console.log(JSON.stringify(result, null, 2))
  },
})

const PathCommand = cmd({
  command: "path",
  describe: "print the database path",
  handler: () => {
    console.log(Database.Path)
  },
})

export const DbCommand = cmd({
  command: "db",
  describe: "database tools",
  builder: (yargs: Argv) => {
    return yargs.command(QueryCommand).command(PathCommand).demandCommand()
  },
  handler: () => {},
})
