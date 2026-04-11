import { UI } from "../../ui"
import { cmd } from "../cmd"
import { Instance } from "@/project/instance"
import { checkoutPrBranch, fetchPrInfo, configureForkRemote, importPrSession, launchLibrecode } from "./helpers"

export const PrCommand = cmd({
  command: "pr <number>",
  describe: "fetch and checkout a GitHub PR branch, then run librecode",
  builder: (yargs) =>
    yargs.positional("number", {
      type: "number",
      describe: "PR number to checkout",
      demandOption: true,
    }),
  async handler(args) {
    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        const project = Instance.project
        if (project.vcs !== "git") {
          UI.error("Could not find git repository. Please run this command from a git repository.")
          process.exit(1)
        }

        const prNumber = args.number
        const localBranchName = `pr/${prNumber}`

        const checked = await checkoutPrBranch(prNumber, localBranchName)
        if (!checked) process.exit(1)

        const prInfo = await fetchPrInfo(prNumber)
        let sessionId: string | undefined
        if (prInfo) {
          await configureForkRemote(prInfo, localBranchName)
          sessionId = await importPrSession(prInfo.body)
        }

        UI.println(`Successfully checked out PR #${prNumber} as branch '${localBranchName}'`)
        UI.println()
        await launchLibrecode(sessionId)
      },
    })
  },
})
