/**
 * Loaders for platform-specific providers (GitLab).
 */

import os from "node:os"
import type { LanguageModelV2 } from "@ai-sdk/provider"
import { VERSION as GITLAB_PROVIDER_VERSION } from "@gitlab/gitlab-ai-provider"
import { Auth } from "../../auth"
import { Config } from "../../config/config"
import { Env } from "../../env"
import { Installation } from "../../installation"
import type { CustomLoader } from "./types"

export const gitlab: CustomLoader = async (input) => {
  const instanceUrl = Env.get("GITLAB_INSTANCE_URL") || "https://gitlab.com"

  const auth = await Auth.get(input.id)
  const apiKey = await (async () => {
    if (auth?.type === "oauth") return auth.access
    if (auth?.type === "api") return auth.key
    return Env.get("GITLAB_TOKEN")
  })()

  const config = await Config.get()
  const providerConfig = config.provider?.gitlab

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
    async getModel(sdk: unknown, modelID: string): Promise<LanguageModelV2> {
      const gitlab = sdk as { agenticChat: (id: string, opts?: Record<string, unknown>) => LanguageModelV2 }
      return gitlab.agenticChat(modelID, {
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
