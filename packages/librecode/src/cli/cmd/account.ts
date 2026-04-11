import { cmd } from "./cmd"
import * as prompts from "@clack/prompts"
import { UI } from "../ui"
import { AccountService } from "@/account/service"
import { AccountID, OrgID, PollExpired, type PollResult } from "@/account/schema"
import open from "open"

function handlePollResult(result: PollResult, spinner: ReturnType<typeof prompts.spinner>): void {
  switch (result._tag) {
    case "PollSuccess":
      spinner.stop("Logged in as " + result.email)
      prompts.outro("Done")
      break
    case "PollExpired":
      spinner.stop("Device code expired", 1)
      break
    case "PollDenied":
      spinner.stop("Authorization denied", 1)
      break
    case "PollError":
      spinner.stop("Error: " + String(result.cause), 1)
      break
    default:
      spinner.stop("Unexpected state", 1)
  }
}

async function login(url: string) {
  prompts.intro("Log in")
  const loginResult = await AccountService.login(url)

  prompts.log.info("Go to: " + loginResult.url)
  prompts.log.info("Enter code: " + loginResult.user)
  open(loginResult.url).catch(() => undefined)

  const s = prompts.spinner()
  s.start("Waiting for authorization...")

  const poll = async (wait: number): Promise<PollResult> => {
    await new Promise((resolve) => setTimeout(resolve, wait))
    const result = await AccountService.poll(loginResult)
    if (result._tag === "PollPending") return poll(wait)
    if (result._tag === "PollSlow") return poll(wait + 5000)
    return result
  }

  const timeout = new Promise<PollResult>((resolve) => setTimeout(() => resolve(new PollExpired()), loginResult.expiry))
  const result = await Promise.race([poll(loginResult.interval), timeout])
  handlePollResult(result, s)
}

async function logout(email?: string) {
  const accounts = AccountService.list()
  if (accounts.length === 0) return UI.println("Not logged in")

  if (email) {
    const match = accounts.find((a) => a.email === email)
    if (!match) return UI.println("Account not found: " + email)
    AccountService.remove(match.id)
    prompts.outro("Logged out from " + email)
    return
  }

  const active = AccountService.active()

  prompts.intro("Log out")

  const opts = accounts.map((a) => {
    const isActive = active && active.id === a.id
    const server = UI.Style.TEXT_DIM + a.url + UI.Style.TEXT_NORMAL
    return {
      value: a,
      label: isActive ? `${a.email} ${server}` + UI.Style.TEXT_DIM + " (active)" : `${a.email} ${server}`,
    }
  })

  const result = await prompts.select({ message: "Select account to log out", options: opts })
  if (prompts.isCancel(result)) return

  AccountService.remove(result.id)
  prompts.outro("Logged out from " + result.email)
}

interface OrgChoice {
  orgID: OrgID
  accountID: AccountID
  label: string
}

async function switchOrg() {
  const groups = await AccountService.orgsByAccount()
  if (groups.length === 0) return UI.println("Not logged in")

  const active = AccountService.active()
  const activeOrgID = active?.active_org_id ?? undefined

  const opts = groups.flatMap((group) =>
    group.orgs.map((org) => {
      const isActive = activeOrgID && activeOrgID === org.id
      return {
        value: { orgID: org.id, accountID: group.account.id, label: org.name } as OrgChoice,
        label: isActive
          ? `${org.name} (${group.account.email})` + UI.Style.TEXT_DIM + " (active)"
          : `${org.name} (${group.account.email})`,
      }
    }),
  )
  if (opts.length === 0) return UI.println("No orgs found")

  prompts.intro("Switch org")

  const result = await prompts.select<OrgChoice>({ message: "Select org", options: opts })
  if (prompts.isCancel(result)) return

  const choice = result as OrgChoice
  AccountService.use(choice.accountID, choice.orgID)
  prompts.outro("Switched to " + choice.label)
}

function formatOrgLine(
  org: { name: string; id: string },
  email: string,
  isActive: boolean | "" | undefined,
): string {
  const dot = isActive ? UI.Style.TEXT_SUCCESS + "\u25CF" + UI.Style.TEXT_NORMAL : " "
  const name = isActive ? UI.Style.TEXT_HIGHLIGHT_BOLD + org.name + UI.Style.TEXT_NORMAL : org.name
  return `  ${dot} ${name}  ${UI.Style.TEXT_DIM}${email}${UI.Style.TEXT_NORMAL}  ${UI.Style.TEXT_DIM}${org.id}${UI.Style.TEXT_NORMAL}`
}

async function listOrgs() {
  const groups = await AccountService.orgsByAccount()
  if (groups.length === 0) return UI.println("No accounts found")
  if (!groups.some((group) => group.orgs.length > 0)) return UI.println("No orgs found")

  const activeOrgID = AccountService.active()?.active_org_id
  for (const group of groups) {
    for (const org of group.orgs) {
      UI.println(formatOrgLine(org, group.account.email, activeOrgID && activeOrgID === org.id))
    }
  }
}

export const LoginCommand = cmd({
  command: "login <url>",
  describe: false,
  builder: (yargs) =>
    yargs.positional("url", {
      describe: "server URL",
      type: "string",
      demandOption: true,
    }),
  async handler(args) {
    UI.empty()
    await login(args.url)
  },
})

export const LogoutCommand = cmd({
  command: "logout [email]",
  describe: false,
  builder: (yargs) =>
    yargs.positional("email", {
      describe: "account email to log out from",
      type: "string",
    }),
  async handler(args) {
    UI.empty()
    await logout(args.email)
  },
})

export const SwitchCommand = cmd({
  command: "switch",
  describe: false,
  async handler() {
    UI.empty()
    await switchOrg()
  },
})

export const OrgsCommand = cmd({
  command: "orgs",
  describe: false,
  async handler() {
    UI.empty()
    await listOrgs()
  },
})

export const ConsoleCommand = cmd({
  command: "console",
  describe: false,
  builder: (yargs) =>
    yargs
      .command({
        ...LoginCommand,
        describe: "log in to console",
      })
      .command({
        ...LogoutCommand,
        describe: "log out from console",
      })
      .command({
        ...SwitchCommand,
        describe: "switch active org",
      })
      .command({
        ...OrgsCommand,
        describe: "list orgs",
      })
      .demandCommand(),
  async handler() {},
})
