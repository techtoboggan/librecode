/**
 * Loaders for platform-specific providers (GitLab, LibreCode built-in).
 */

import os from "os"
import { Config } from "../../config/config"
import { Auth } from "../../auth"
import { Env } from "../../env"
import { Installation } from "../../installation"
import { VERSION as GITLAB_PROVIDER_VERSION } from "@gitlab/gitlab-ai-provider"
import { createGitLab } from "@gitlab/gitlab-ai-provider"
import type { CustomLoader } from "./types"

export const librecode: CustomLoader = async (input) => {
  const hasKey = await (async () => {
    const env = Env.all()
    if (input.env.some((item) => env[item])) return true
    if (await Auth.get(input.id)) return true
    const config = await Config.get()
    if (config.provider?.["librecode"]?.options?.apiKey) return true
    return false
  })()

  if (!hasKey) {
    for (const [key, value] of Object.entries(input.models)) {
      if (value.cost.input === 0) continue
      delete input.models[key]
    }
  }

  return {
    autoload: Object.keys(input.models).length > 0,
    options: hasKey ? {} : { apiKey: "public" },
  }
}

export const gitlab: CustomLoader = async (input) => {
  const instanceUrl = Env.get("GITLAB_INSTANCE_URL") || "https://gitlab.com"

  const auth = await Auth.get(input.id)
  const apiKey = await (async () => {
    if (auth?.type === "oauth") return auth.access
    if (auth?.type === "api") return auth.key
    return Env.get("GITLAB_TOKEN")
  })()

  const config = await Config.get()
  const providerConfig = config.provider?.["gitlab"]

  const aiGatewayHeaders = {
    "User-Agent": `librecode/${Installation.VERSION} gitlab-ai-provider/${GITLAB_PROVIDER_VERSION} (${os.platform()} ${os.release()}; ${os.arch()})`,
    "anthropic-beta": "context-1m-2025-08-07",
    ...(providerConfig?.options?.aiGatewayHeaders || {}),
  }

  return {
    autoload: !!apiKey,
    options: {
      instanceUrl,
      apiKey,
      aiGatewayHeaders,
      featureFlags: {
        duo_agent_platform_agentic_chat: true,
        duo_agent_platform: true,
        ...(providerConfig?.options?.featureFlags || {}),
      },
    },
    async getModel(sdk: ReturnType<typeof createGitLab>, modelID: string) {
      return sdk.agenticChat(modelID, {
        aiGatewayHeaders,
        featureFlags: {
          duo_agent_platform_agentic_chat: true,
          duo_agent_platform: true,
          ...(providerConfig?.options?.featureFlags || {}),
        },
      })
    },
  }
}
