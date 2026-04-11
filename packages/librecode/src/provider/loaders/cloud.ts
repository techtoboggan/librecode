/**
 * Loaders for cloud platform providers (AWS Bedrock, Google Vertex, SAP, Cloudflare).
 */

import { Config } from "../../config/config"
import { Auth } from "../../auth"
import { Env } from "../../env"
import { iife } from "@/util/iife"
import { fromNodeProviderChain } from "@aws-sdk/credential-providers"
import { GoogleAuth } from "google-auth-library"
import type { AmazonBedrockProviderSettings } from "@ai-sdk/amazon-bedrock"
import type { CustomLoader } from "./types"

const US_PREFIXED_MODELS = ["nova-micro", "nova-lite", "nova-pro", "nova-premier", "nova-2", "claude", "deepseek"]
const EU_PREFIXED_MODELS = ["claude", "nova-lite", "nova-micro", "llama3", "pixtral"]
const EU_PREFIXED_REGIONS = ["eu-west-1", "eu-west-2", "eu-west-3", "eu-north-1", "eu-central-1", "eu-south-1", "eu-south-2"]
const AP_PREFIXED_MODELS = ["claude", "nova-lite", "nova-micro", "nova-pro"]
const AP_AUSTRALIA_MODELS = ["anthropic.claude-sonnet-4-5", "anthropic.claude-haiku"]
const CROSS_REGION_PREFIXES = ["global.", "us.", "eu.", "jp.", "apac.", "au."]

function applyUsPrefix(modelID: string, region: string): string {
  const modelRequiresPrefix = US_PREFIXED_MODELS.some((m) => modelID.includes(m))
  const isGovCloud = region.startsWith("us-gov")
  return modelRequiresPrefix && !isGovCloud ? `us.${modelID}` : modelID
}

function applyEuPrefix(modelID: string, region: string): string {
  const regionRequiresPrefix = EU_PREFIXED_REGIONS.some((r) => region.includes(r))
  const modelRequiresPrefix = EU_PREFIXED_MODELS.some((m) => modelID.includes(m))
  return regionRequiresPrefix && modelRequiresPrefix ? `eu.${modelID}` : modelID
}

function applyApPrefix(modelID: string, region: string): string {
  const isAustraliaRegion = ["ap-southeast-2", "ap-southeast-4"].includes(region)
  const isTokyoRegion = region === "ap-northeast-1"

  if (isAustraliaRegion && AP_AUSTRALIA_MODELS.some((m) => modelID.includes(m))) {
    return `au.${modelID}`
  }
  if (isTokyoRegion && AP_PREFIXED_MODELS.some((m) => modelID.includes(m))) {
    return `jp.${modelID}`
  }
  if (AP_PREFIXED_MODELS.some((m) => modelID.includes(m))) {
    return `apac.${modelID}`
  }
  return modelID
}

function applyBedrockRegionPrefix(modelID: string, region: string): string {
  if (CROSS_REGION_PREFIXES.some((prefix) => modelID.startsWith(prefix))) return modelID
  const regionPrefix = region.split("-")[0]
  switch (regionPrefix) {
    case "us": return applyUsPrefix(modelID, region)
    case "eu": return applyEuPrefix(modelID, region)
    case "ap": return applyApPrefix(modelID, region)
    default: return modelID
  }
}

export const amazonBedrock: CustomLoader = async () => {
  const config = await Config.get()
  const providerConfig = config.provider?.["amazon-bedrock"]

  const auth = await Auth.get("amazon-bedrock")

  const configRegion = providerConfig?.options?.region
  const envRegion = Env.get("AWS_REGION")
  const defaultRegion = configRegion ?? envRegion ?? "us-east-1"

  const configProfile = providerConfig?.options?.profile
  const envProfile = Env.get("AWS_PROFILE")
  const profile = configProfile ?? envProfile

  const awsAccessKeyId = Env.get("AWS_ACCESS_KEY_ID")

  const awsBearerToken = iife(() => {
    const envToken = process.env.AWS_BEARER_TOKEN_BEDROCK
    if (envToken) return envToken
    if (auth?.type === "api") {
      process.env.AWS_BEARER_TOKEN_BEDROCK = auth.key
      return auth.key
    }
    return undefined
  })

  const awsWebIdentityTokenFile = Env.get("AWS_WEB_IDENTITY_TOKEN_FILE")

  const containerCreds = Boolean(
    process.env.AWS_CONTAINER_CREDENTIALS_RELATIVE_URI || process.env.AWS_CONTAINER_CREDENTIALS_FULL_URI,
  )

  if (!profile && !awsAccessKeyId && !awsBearerToken && !awsWebIdentityTokenFile && !containerCreds)
    return { autoload: false }

  const providerOptions: AmazonBedrockProviderSettings = {
    region: defaultRegion,
  }

  if (!awsBearerToken) {
    const credentialProviderOptions = profile ? { profile } : {}
    providerOptions.credentialProvider = fromNodeProviderChain(credentialProviderOptions)
  }

  const endpoint = providerConfig?.options?.endpoint ?? providerConfig?.options?.baseURL
  if (endpoint) {
    providerOptions.baseURL = endpoint
  }

  return {
    autoload: true,
    options: providerOptions,
    async getModel(sdk: unknown, modelID: string, options?: Record<string, unknown>) {
      const prefixedModelID = applyBedrockRegionPrefix(modelID, options?.region as string | undefined ?? defaultRegion)
      return (sdk as { languageModel: (id: string) => unknown }).languageModel(prefixedModelID)
    },
  }
}

export const googleVertex: CustomLoader = async (provider) => {
  const project =
    provider.options?.project ??
    Env.get("GOOGLE_CLOUD_PROJECT") ??
    Env.get("GCP_PROJECT") ??
    Env.get("GCLOUD_PROJECT")

  const location = String(
    provider.options?.location ??
      Env.get("GOOGLE_VERTEX_LOCATION") ??
      Env.get("GOOGLE_CLOUD_LOCATION") ??
      Env.get("VERTEX_LOCATION") ??
      "us-central1",
  )

  if (!project) return { autoload: false }

  return {
    autoload: true,
    vars() {
      const endpoint = location === "global" ? "aiplatform.googleapis.com" : `${location}-aiplatform.googleapis.com`
      return {
        ...(project && { GOOGLE_VERTEX_PROJECT: project }),
        GOOGLE_VERTEX_LOCATION: location,
        GOOGLE_VERTEX_ENDPOINT: endpoint,
      }
    },
    options: {
      project,
      location,
      fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
        const auth = new GoogleAuth()
        const client = await auth.getApplicationDefault()
        const token = await client.credential.getAccessToken()
        const headers = new Headers(init?.headers)
        headers.set("Authorization", `Bearer ${token.token}`)
        return fetch(input, { ...init, headers })
      },
    },
    async getModel(sdk: any, modelID: string) {
      return sdk.languageModel(String(modelID).trim())
    },
  }
}

export const googleVertexAnthropic: CustomLoader = async () => {
  const project = Env.get("GOOGLE_CLOUD_PROJECT") ?? Env.get("GCP_PROJECT") ?? Env.get("GCLOUD_PROJECT")
  const location = Env.get("GOOGLE_CLOUD_LOCATION") ?? Env.get("VERTEX_LOCATION") ?? "global"
  if (!project) return { autoload: false }
  return {
    autoload: true,
    options: { project, location },
    async getModel(sdk: any, modelID: string) {
      return sdk.languageModel(String(modelID).trim())
    },
  }
}

export const sapAiCore: CustomLoader = async () => {
  const auth = await Auth.get("sap-ai-core")
  const envServiceKey = iife(() => {
    const envAICoreServiceKey = process.env.AICORE_SERVICE_KEY
    if (envAICoreServiceKey) return envAICoreServiceKey
    if (auth?.type === "api") {
      process.env.AICORE_SERVICE_KEY = auth.key
      return auth.key
    }
    return undefined
  })
  const deploymentId = process.env.AICORE_DEPLOYMENT_ID
  const resourceGroup = process.env.AICORE_RESOURCE_GROUP

  return {
    autoload: !!envServiceKey,
    options: envServiceKey ? { deploymentId, resourceGroup } : {},
    async getModel(sdk: any, modelID: string) {
      return sdk(modelID)
    },
  }
}

export const cloudflareWorkersAi: CustomLoader = async (input) => {
  const accountId = Env.get("CLOUDFLARE_ACCOUNT_ID")
  if (!accountId) return { autoload: false }

  const apiKey = await iife(async () => {
    const envToken = Env.get("CLOUDFLARE_API_KEY")
    if (envToken) return envToken
    const auth = await Auth.get(input.id)
    if (auth?.type === "api") return auth.key
    return undefined
  })

  return {
    autoload: !!apiKey,
    options: { apiKey },
    async getModel(sdk: any, modelID: string) {
      return sdk.languageModel(modelID)
    },
    vars() {
      return { CLOUDFLARE_ACCOUNT_ID: accountId }
    },
  }
}

export const cloudflareAiGateway: CustomLoader = async (input) => {
  const accountId = Env.get("CLOUDFLARE_ACCOUNT_ID")
  const gateway = Env.get("CLOUDFLARE_GATEWAY_ID")

  if (!accountId || !gateway) return { autoload: false }

  const apiToken = await (async () => {
    const envToken = Env.get("CLOUDFLARE_API_TOKEN") || Env.get("CF_AIG_TOKEN")
    if (envToken) return envToken
    const auth = await Auth.get(input.id)
    if (auth?.type === "api") return auth.key
    return undefined
  })()

  if (!apiToken) {
    throw new Error(
      "CLOUDFLARE_API_TOKEN (or CF_AIG_TOKEN) is required for Cloudflare AI Gateway. " +
        "Set it via environment variable or run `librecode auth cloudflare-ai-gateway`.",
    )
  }

  const { createAiGateway } = await import("ai-gateway-provider")
  const { createUnified } = await import("ai-gateway-provider/providers/unified")

  const metadata = iife(() => {
    if (input.options?.metadata) return input.options.metadata
    try {
      return JSON.parse(input.options?.headers?.["cf-aig-metadata"])
    } catch {
      return undefined
    }
  })
  const opts = {
    metadata,
    cacheTtl: input.options?.cacheTtl,
    cacheKey: input.options?.cacheKey,
    skipCache: input.options?.skipCache,
    collectLog: input.options?.collectLog,
  }

  const aigateway = createAiGateway({
    accountId,
    gateway,
    apiKey: apiToken,
    ...(Object.values(opts).some((v) => v !== undefined) ? { options: opts } : {}),
  })
  const unified = createUnified()

  return {
    autoload: true,
    async getModel(_sdk: any, modelID: string) {
      return aigateway(unified(modelID))
    },
    options: {},
  }
}
