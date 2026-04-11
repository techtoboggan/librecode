import { cmd } from "../cmd"
import { GithubInstallCommand } from "./install"
import { GithubRunCommand } from "./run"

// Re-export utility functions (tests import these from "cmd/github")
export { parseGitHubRemote, extractResponseText, formatPromptTooLargeError } from "./util"

// ---------------------------------------------------------------------------
// Top-level command
// ---------------------------------------------------------------------------

export const GithubCommand = cmd({
  command: "github",
  describe: "manage GitHub agent",
  builder: (yargs) => yargs.command(GithubInstallCommand).command(GithubRunCommand).demandCommand(),
  async handler() {},
})

// Re-export subcommands for callers that import them directly
export { GithubInstallCommand } from "./install"
export { GithubRunCommand } from "./run"
