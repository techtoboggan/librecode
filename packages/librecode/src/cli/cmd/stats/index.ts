import type { Argv } from "yargs"
import { bootstrap } from "../../bootstrap"
import { cmd } from "../cmd"
import { aggregateSessionStats } from "./aggregate"
import { displayStats } from "./display"

export { aggregateSessionStats } from "./aggregate"
export { displayStats } from "./display"

export const StatsCommand = cmd({
  command: "stats",
  describe: "show token usage and cost statistics",
  builder: (yargs: Argv) => {
    return yargs
      .option("days", {
        describe: "show stats for the last N days (default: all time)",
        type: "number",
      })
      .option("tools", {
        describe: "number of tools to show (default: all)",
        type: "number",
      })
      .option("models", {
        describe: "show model statistics (default: hidden). Pass a number to show top N, otherwise shows all",
      })
      .option("project", {
        describe: "filter by project (default: all projects, empty string: current project)",
        type: "string",
      })
  },
  handler: async (args) => {
    await bootstrap(process.cwd(), async () => {
      const stats = await aggregateSessionStats(args.days, args.project)

      let modelLimit: number | undefined
      if (args.models === true) {
        modelLimit = Infinity
      } else if (typeof args.models === "number") {
        modelLimit = args.models
      }

      displayStats(stats, args.tools, modelLimit)
    })
  },
})
