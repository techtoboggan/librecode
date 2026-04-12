import type {
  PermissionOption,
  PlanEntry,
  PromptRequest,
  ToolCallContent,
  ToolKind,
} from "@agentclientprotocol/sdk"

import { pathToFileURL } from "node:url"
import { Provider } from "../provider/provider"
import { ModelID, ProviderID } from "../provider/schema"
import { Todo } from "@/session/todo"
import { z } from "zod"
import { applyPatch } from "diff"
import { Log } from "../util/log"
import type { ACPConfig } from "./types"
import type { OpencodeClient } from "@librecode/sdk/v2"

const log = Log.create({ service: "acp-agent" })

export const DEFAULT_VARIANT_VALUE = "default"

export type ModeOption = { id: string; name: string; description?: string }
export type ModelOption = { modelId: string; name: string }

export type PromptPart =
  | { type: "text"; text: string; synthetic?: boolean; ignored?: boolean }
  | { type: "file"; url: string; filename: string; mime: string }

export const PERMISSION_OPTIONS: PermissionOption[] = [
  { optionId: "once", kind: "allow_once", name: "Allow once" },
  { optionId: "always", kind: "allow_always", name: "Always allow" },
  { optionId: "reject", kind: "reject_once", name: "Reject" },
]

export function toToolKind(toolName: string): ToolKind {
  const tool = toolName.toLocaleLowerCase()
  switch (tool) {
    case "bash":
      return "execute"
    case "webfetch":
      return "fetch"

    case "edit":
    case "patch":
    case "write":
      return "edit"

    case "grep":
    case "glob":
    case "context7_resolve_library_id":
    case "context7_get_library_docs":
      return "search"

    case "list":
    case "read":
      return "read"

    default:
      return "other"
  }
}

export function toLocations(toolName: string, input: Record<string, unknown>): { path: string }[] {
  const tool = toolName.toLocaleLowerCase()
  switch (tool) {
    case "read":
    case "edit":
    case "write":
      return input["filePath"] ? [{ path: input["filePath"] as string }] : []
    case "glob":
    case "grep":
      return input["path"] ? [{ path: input["path"] as string }] : []
    case "bash":
      return []
    case "list":
      return input["path"] ? [{ path: input["path"] as string }] : []
    default:
      return []
  }
}

export function buildEditDiffContent(input: Record<string, unknown>): Extract<ToolCallContent, { type: "diff" }> {
  const filePath = typeof input["filePath"] === "string" ? input["filePath"] : ""
  const oldText = typeof input["oldString"] === "string" ? input["oldString"] : ""
  const newText =
    typeof input["newString"] === "string"
      ? input["newString"]
      : typeof input["content"] === "string"
        ? input["content"]
        : ""
  return { type: "diff", path: filePath, oldText, newText }
}

export function getNewContent(fileOriginal: string, unifiedDiff: string): string | undefined {
  const result = applyPatch(fileOriginal, unifiedDiff)
  if (result === false) {
    log.error("Failed to apply unified diff (context mismatch)")
    return undefined
  }
  return result
}

export function sortProvidersByName<T extends { name: string }>(providers: T[]): T[] {
  return [...providers].sort((a, b) => {
    const nameA = a.name.toLowerCase()
    const nameB = b.name.toLowerCase()
    if (nameA < nameB) return -1
    if (nameA > nameB) return 1
    return 0
  })
}

export function modelVariantsFromProviders(
  providers: Array<{ id: string; models: Record<string, { variants?: Record<string, unknown> }> }>,
  model: { providerID: ProviderID; modelID: ModelID },
): string[] {
  const provider = providers.find((entry) => entry.id === model.providerID)
  if (!provider) return []
  const modelInfo = provider.models[model.modelID]
  if (!modelInfo?.variants) return []
  return Object.keys(modelInfo.variants)
}

export function buildAvailableModels(
  providers: Array<{
    id: string
    name: string
    models: Record<string, { id: string; name: string; variants?: Record<string, unknown> }>
  }>,
  options: { includeVariants?: boolean } = {},
): ModelOption[] {
  const includeVariants = options.includeVariants ?? false
  return providers.flatMap((provider) => {
    const unsorted: Array<{ id: string; name: string; variants?: Record<string, unknown> }> = Object.values(
      provider.models,
    )
    const models = Provider.sort(unsorted)
    return models.flatMap((model) => {
      const base: ModelOption = {
        modelId: `${provider.id}/${model.id}`,
        name: `${provider.name}/${model.name}`,
      }
      if (!includeVariants || !model.variants) return [base]
      const variants = Object.keys(model.variants).filter((variant) => variant !== DEFAULT_VARIANT_VALUE)
      const variantOptions = variants.map((variant) => ({
        modelId: `${provider.id}/${model.id}/${variant}`,
        name: `${provider.name}/${model.name} (${variant})`,
      }))
      return [base, ...variantOptions]
    })
  })
}

export function formatModelIdWithVariant(
  model: { providerID: ProviderID; modelID: ModelID },
  variant: string | undefined,
  availableVariants: string[],
  includeVariant: boolean,
): string {
  const base = `${model.providerID}/${model.modelID}`
  if (!includeVariant || !variant || !availableVariants.includes(variant)) return base
  return `${base}/${variant}`
}

export function buildVariantMeta(input: {
  model: { providerID: ProviderID; modelID: ModelID }
  variant?: string
  availableVariants: string[]
}): { librecode: { modelId: string; variant: string | null; availableVariants: string[] } } {
  return {
    librecode: {
      modelId: `${input.model.providerID}/${input.model.modelID}`,
      variant: input.variant ?? null,
      availableVariants: input.availableVariants,
    },
  }
}

export function parseModelSelection(
  modelId: string,
  providers: Array<{ id: string; models: Record<string, { variants?: Record<string, unknown> }> }>,
): { model: { providerID: ProviderID; modelID: ModelID }; variant?: string } {
  const parsed = Provider.parseModel(modelId)
  const provider = providers.find((p) => p.id === parsed.providerID)
  if (!provider) {
    return { model: parsed, variant: undefined }
  }

  // Check if modelID exists directly
  if (provider.models[parsed.modelID]) {
    return { model: parsed, variant: undefined }
  }

  // Try to extract variant from end of modelID (e.g., "claude-sonnet-4/high" -> model: "claude-sonnet-4", variant: "high")
  const segments = parsed.modelID.split("/")
  if (segments.length > 1) {
    const candidateVariant = segments[segments.length - 1]
    const baseModelId = segments.slice(0, -1).join("/")
    const baseModelInfo = provider.models[baseModelId]
    if (baseModelInfo?.variants && candidateVariant in baseModelInfo.variants) {
      return {
        model: { providerID: parsed.providerID, modelID: ModelID.make(baseModelId) },
        variant: candidateVariant,
      }
    }
  }

  return { model: parsed, variant: undefined }
}

export async function defaultModel(
  config: ACPConfig,
  cwd?: string,
): Promise<{ providerID: ProviderID; modelID: ModelID }> {
  const sdk = config.sdk
  const configured = config.defaultModel
  if (configured) return configured

  const directory = cwd ?? process.cwd()

  const specified = await sdk.config
    .get({ directory }, { throwOnError: true })
    .then((resp) => {
      const cfg = resp.data
      if (!cfg || !cfg.model) return undefined
      return Provider.parseModel(cfg.model.id)
    })
    .catch((error) => {
      log.error("failed to load user config for default model", { error })
      return undefined
    })

  const providers = await sdk.config
    .providers({ directory }, { throwOnError: true })
    .then((x) => x.data?.providers ?? [])
    .catch((error) => {
      log.error("failed to list providers for default model", { error })
      return []
    })

  if (specified && providers.length) {
    const provider = providers.find((p) => p.id === specified.providerID)
    if (provider && provider.models[specified.modelID]) return specified
  }

  if (specified && !providers.length) return specified

  const models = providers.flatMap((p) => Object.values(p.models))
  const [best] = Provider.sort(models)
  if (best) {
    return {
      providerID: ProviderID.make(best.providerID),
      modelID: ModelID.make(best.id),
    }
  }

  if (specified) return specified

  throw new Error("no providers found — connect a provider to get started")
}

export async function getContextLimit(
  sdk: OpencodeClient,
  providerID: ProviderID,
  modelID: ModelID,
  directory: string,
): Promise<number | null> {
  const providers = await sdk.config
    .providers({ directory })
    .then((x) => x.data?.providers ?? [])
    .catch((error) => {
      log.error("failed to get providers for context limit", { error })
      return []
    })

  const provider = providers.find((p) => p.id === providerID)
  const model = provider?.models[modelID]
  return model?.limit.context ?? null
}

export function buildPromptParts(promptParts: PromptRequest["prompt"]): PromptPart[] {
  return promptParts.flatMap((part) => {
    if (part.type === "text") return convertTextPromptPart(part)
    if (part.type === "image") return convertImagePromptPart(part)
    if (part.type === "resource_link") return convertResourceLinkPromptPart(part)
    if (part.type === "resource") return convertResourcePromptPart(part)
    return []
  })
}

function convertTextPromptPart(part: Extract<PromptRequest["prompt"][number], { type: "text" }>): PromptPart[] {
  const audience = part.annotations?.audience
  const forAssistant = audience?.length === 1 && audience[0] === "assistant"
  const forUser = audience?.length === 1 && audience[0] === "user"
  return [
    {
      type: "text" as const,
      text: part.text,
      ...(forAssistant && { synthetic: true }),
      ...(forUser && { ignored: true }),
    },
  ]
}

function convertImagePromptPart(part: Extract<PromptRequest["prompt"][number], { type: "image" }>): PromptPart[] {
  const parsed = parseUri(part.uri ?? "")
  const filename = parsed.type === "file" ? parsed.filename : "image"
  if (part.data) {
    return [{ type: "file", url: `data:${part.mimeType};base64,${part.data}`, filename, mime: part.mimeType }]
  }
  if (part.uri && part.uri.startsWith("http:")) {
    return [{ type: "file", url: part.uri, filename, mime: part.mimeType }]
  }
  return []
}

function convertResourceLinkPromptPart(
  part: Extract<PromptRequest["prompt"][number], { type: "resource_link" }>,
): PromptPart[] {
  const parsed = parseUri(part.uri)
  // Use the name from resource_link if available
  if (part.name && parsed.type === "file") {
    parsed.filename = part.name
  }
  return [parsed]
}

function convertResourcePromptPart(part: Extract<PromptRequest["prompt"][number], { type: "resource" }>): PromptPart[] {
  const resource = part.resource
  if ("text" in resource && resource.text) {
    return [{ type: "text", text: resource.text }]
  }
  if ("blob" in resource && resource.blob && resource.mimeType) {
    // Binary resource (PDFs, etc.): store as file part with data URL
    const parsed = parseUri(resource.uri ?? "")
    const filename = parsed.type === "file" ? parsed.filename : "file"
    return [
      { type: "file", url: `data:${resource.mimeType};base64,${resource.blob}`, filename, mime: resource.mimeType },
    ]
  }
  return []
}

export function parseUri(
  uri: string,
): { type: "file"; url: string; filename: string; mime: string } | { type: "text"; text: string } {
  try {
    if (uri.startsWith("file://")) {
      const path = uri.slice(7)
      const name = path.split("/").pop() || path
      return {
        type: "file",
        url: uri,
        filename: name,
        mime: "text/plain",
      }
    }
    if (uri.startsWith("zed://")) {
      const url = new URL(uri)
      const path = url.searchParams.get("path")
      if (path) {
        const name = path.split("/").pop() || path
        return {
          type: "file",
          url: pathToFileURL(path).href,
          filename: name,
          mime: "text/plain",
        }
      }
    }
    return {
      type: "text",
      text: uri,
    }
  } catch {
    return {
      type: "text",
      text: uri,
    }
  }
}

// Re-export Todo and z for use in agent-handlers.ts
export { Todo, z }
