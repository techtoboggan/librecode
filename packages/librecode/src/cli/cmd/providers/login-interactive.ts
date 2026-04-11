import { Auth } from "../../../auth"
import * as prompts from "@clack/prompts"
import { UI } from "../../ui"
import { Plugin } from "../../../plugin"
import { handlePluginAuth } from "./auth-flow"
import { buildProviderOptions, selectProvider } from "./select"

function handleProviderSpecificInfo(provider: string): void {
  if (provider === "amazon-bedrock") {
    prompts.log.info(
      "Amazon Bedrock authentication priority:\n" +
        "  1. Bearer token (AWS_BEARER_TOKEN_BEDROCK or /connect)\n" +
        "  2. AWS credential chain (profile, access keys, IAM roles, EKS IRSA)\n\n" +
        "Configure via librecode.json options (profile, region, endpoint) or\n" +
        "AWS environment variables (AWS_PROFILE, AWS_REGION, AWS_ACCESS_KEY_ID, AWS_WEB_IDENTITY_TOKEN_FILE).",
    )
  }
  if (provider === "vercel") {
    prompts.log.info("You can create an api key at https://vercel.link/ai-gateway-token")
  }
  if (["cloudflare", "cloudflare-ai-gateway"].includes(provider)) {
    prompts.log.info(
      "Cloudflare AI Gateway can be configured with CLOUDFLARE_GATEWAY_ID, CLOUDFLARE_ACCOUNT_ID, and CLOUDFLARE_API_TOKEN environment variables. Read more: https://github.com/techtoboggan/librecode/docs/providers/#cloudflare-ai-gateway",
    )
  }
}

async function handleOtherProvider(method?: string): Promise<string | null> {
  const custom = await prompts.text({
    message: "Enter provider id",
    validate: (x) => (x && x.match(/^[0-9a-z-]+$/) ? undefined : "a-z, 0-9 and hyphens only"),
  })
  if (prompts.isCancel(custom)) throw new UI.CancelledError()
  const provider = custom.replace(/^@ai-sdk\//, "")

  const customPlugin = await Plugin.list().then((x) => x.findLast((x) => x.auth?.provider === provider))
  if (customPlugin?.auth) {
    const handled = await handlePluginAuth({ auth: customPlugin.auth }, provider, method)
    if (handled) return null
  }

  prompts.log.warn(
    `This only stores a credential for ${provider} - you will need configure it in librecode.json, check the docs for examples.`,
  )
  return provider
}

export async function loginInteractive(argProvider?: string, method?: string): Promise<void> {
  const { options } = await buildProviderOptions()
  let provider = await selectProvider(options, argProvider)

  const plugin = await Plugin.list().then((x) => x.findLast((x) => x.auth?.provider === provider))
  if (plugin?.auth) {
    const handled = await handlePluginAuth({ auth: plugin.auth }, provider, method)
    if (handled) return
  }

  if (provider === "other") {
    const resolved = await handleOtherProvider(method)
    if (resolved === null) return
    provider = resolved
  }

  handleProviderSpecificInfo(provider)

  const key = await prompts.password({
    message: "Enter your API key",
    validate: (x) => (x && x.length > 0 ? undefined : "Required"),
  })
  if (prompts.isCancel(key)) throw new UI.CancelledError()
  await Auth.set(provider, { type: "api", key })
  prompts.outro("Done")
}
