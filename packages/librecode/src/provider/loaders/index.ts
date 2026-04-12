/**
 * Provider custom loaders registry.
 *
 * Each loader handles provider-specific initialization:
 * - Authentication detection (autoload)
 * - SDK method selection (getModel)
 * - Variable resolution (vars)
 * - Provider options injection (options)
 *
 * Loaders are organized by category:
 * - simple:       Header-only configuration (anthropic, openrouter, vercel, etc.)
 * - openai-compat: OpenAI API-compatible providers (openai, copilot, azure)
 * - cloud:        Cloud platform providers (bedrock, vertex, cloudflare, sap)
 * - platform:     Platform-specific providers (gitlab)
 */

import * as cloud from "./cloud"
import * as litellmLoader from "./litellm"
import * as openaiCompat from "./openai-compat"
import * as platform from "./platform"
import * as simple from "./simple"
import type { CustomLoader } from "./types"

export type { CustomLoader, CustomModelLoader, CustomVarsLoader, ProviderInfo, ProviderLoadResult } from "./types"

export const CUSTOM_LOADERS: Record<string, CustomLoader> = {
  // Simple header-only
  anthropic: simple.anthropic,
  openrouter: simple.openrouter,
  vercel: simple.vercel,
  zenmux: simple.zenmux,
  cerebras: simple.cerebras,
  kilo: simple.kilo,

  // OpenAI-compatible
  openai: openaiCompat.openai,
  "github-copilot": openaiCompat.githubCopilot,
  "github-copilot-enterprise": openaiCompat.githubCopilotEnterprise,
  azure: openaiCompat.azure,
  "azure-cognitive-services": openaiCompat.azureCognitiveServices,

  // Cloud platforms
  "amazon-bedrock": cloud.amazonBedrock,
  "google-vertex": cloud.googleVertex,
  "google-vertex-anthropic": cloud.googleVertexAnthropic,
  "sap-ai-core": cloud.sapAiCore,
  "cloudflare-workers-ai": cloud.cloudflareWorkersAi,
  "cloudflare-ai-gateway": cloud.cloudflareAiGateway,

  // Platform-specific
  gitlab: platform.gitlab,

  // Self-hosted proxies
  litellm: litellmLoader.litellm,
}
