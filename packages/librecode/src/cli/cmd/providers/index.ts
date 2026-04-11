import { cmd } from "../cmd"
import * as prompts from "@clack/prompts"
import { UI } from "../../ui"
import { Auth } from "../../../auth"
import { ModelsDev } from "../../../provider/models"
import path from "path"
import os from "os"
import { Global } from "../../../global"
import { Instance } from "../../../project/instance"
import { loginWithUrl } from "./login-url"
import { loginInteractive } from "./login-interactive"

export { resolvePluginProviders } from "./select"

async function displayActiveEnvVars(database: Awaited<ReturnType<typeof ModelsDev.get>>): Promise<void> {
  const activeEnvVars: Array<{ provider: string; envVar: string }> = []
  for (const [providerID, provider] of Object.entries(database)) {
    for (const envVar of provider.env) {
      if (process.env[envVar]) activeEnvVars.push({ provider: provider.name || providerID, envVar })
    }
  }
  if (activeEnvVars.length === 0) return
  UI.empty()
  prompts.intro("Environment")
  for (const { provider, envVar } of activeEnvVars) {
    prompts.log.info(`${provider} ${UI.Style.TEXT_DIM}${envVar}`)
  }
  prompts.outro(`${activeEnvVars.length} environment variable` + (activeEnvVars.length === 1 ? "" : "s"))
}

export const ProvidersCommand = cmd({
  command: "providers",
  aliases: ["auth"],
  describe: "manage AI providers and credentials",
  builder: (yargs) =>
    yargs.command(ProvidersListCommand).command(ProvidersLoginCommand).command(ProvidersLogoutCommand).demandCommand(),
  async handler() {},
})

export const ProvidersListCommand = cmd({
  command: "list",
  aliases: ["ls"],
  describe: "list providers and credentials",
  async handler(_args) {
    UI.empty()
    const authPath = path.join(Global.Path.data, "auth.json")
    const homedir = os.homedir()
    const displayPath = authPath.startsWith(homedir) ? authPath.replace(homedir, "~") : authPath
    prompts.intro(`Credentials ${UI.Style.TEXT_DIM}${displayPath}`)
    const results = Object.entries(await Auth.all())
    const database = await ModelsDev.get()

    for (const [providerID, result] of results) {
      const name = database[providerID]?.name || providerID
      prompts.log.info(`${name} ${UI.Style.TEXT_DIM}${result.type}`)
    }

    prompts.outro(`${results.length} credentials`)
    await displayActiveEnvVars(database)
  },
})

export const ProvidersLoginCommand = cmd({
  command: "login [url]",
  describe: "log in to a provider",
  builder: (yargs) =>
    yargs
      .positional("url", {
        describe: "librecode auth provider",
        type: "string",
      })
      .option("provider", {
        alias: ["p"],
        describe: "provider id or name to log in to (skips provider selection)",
        type: "string",
      })
      .option("method", {
        alias: ["m"],
        describe: "login method label (skips method selection)",
        type: "string",
      }),
  async handler(args) {
    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        UI.empty()
        prompts.intro("Add credential")
        if (args.url) {
          await loginWithUrl(args.url)
          return
        }
        await loginInteractive(args.provider, args.method)
      },
    })
  },
})

export const ProvidersLogoutCommand = cmd({
  command: "logout",
  describe: "log out from a configured provider",
  async handler(_args) {
    UI.empty()
    const credentials = await Auth.all().then((x) => Object.entries(x))
    prompts.intro("Remove credential")
    if (credentials.length === 0) {
      prompts.log.error("No credentials found")
      return
    }
    const database = await ModelsDev.get()
    const providerID = await prompts.select({
      message: "Select provider",
      options: credentials.map(([key, value]) => ({
        label: (database[key]?.name || key) + UI.Style.TEXT_DIM + " (" + value.type + ")",
        value: key,
      })),
    })
    if (prompts.isCancel(providerID)) throw new UI.CancelledError()
    await Auth.remove(providerID)
    prompts.outro("Logout successful")
  },
})
