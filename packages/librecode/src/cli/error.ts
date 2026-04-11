import { ConfigMarkdown } from "@/config/markdown"
import { Config } from "../config/config"
import { MCP } from "../mcp"
import { Provider } from "../provider/provider"
import { UI } from "./ui"

function formatModelNotFoundError(input: unknown): string | undefined {
  if (!Provider.ModelNotFoundError.isInstance(input)) return undefined
  const { providerID, modelID, suggestions } = input.data
  return [
    `Model not found: ${providerID}/${modelID}`,
    ...(Array.isArray(suggestions) && suggestions.length ? ["Did you mean: " + suggestions.join(", ")] : []),
    `Try: \`librecode models\` to list available models`,
    `Or check your config (librecode.json) provider/model names`,
  ].join("\n")
}

function formatConfigInvalidError(input: unknown): string | undefined {
  if (!Config.InvalidError.isInstance(input)) return undefined
  const prefix = `Configuration is invalid${input.data.path && input.data.path !== "config" ? ` at ${input.data.path}` : ""}`
  return [
    prefix + (input.data.message ? `: ${input.data.message}` : ""),
    ...(input.data.issues?.map((issue) => "↳ " + issue.message + " " + issue.path.join(".")) ?? []),
  ].join("\n")
}

export function FormatError(input: unknown) {
  if (MCP.Failed.isInstance(input))
    return `MCP server "${input.data.name}" failed. Note, librecode does not support MCP authentication yet.`
  const modelNotFound = formatModelNotFoundError(input)
  if (modelNotFound !== undefined) return modelNotFound
  if (Provider.InitError.isInstance(input)) {
    return `Failed to initialize provider "${input.data.providerID}". Check credentials and configuration.`
  }
  if (Config.JsonError.isInstance(input)) {
    return (
      `Config file at ${input.data.path} is not valid JSON(C)` + (input.data.message ? `: ${input.data.message}` : "")
    )
  }
  if (Config.ConfigDirectoryTypoError.isInstance(input)) {
    return `Directory "${input.data.dir}" in ${input.data.path} is not valid. Rename the directory to "${input.data.suggestion}" or remove it. This is a common typo.`
  }
  if (ConfigMarkdown.FrontmatterError.isInstance(input)) {
    return input.data.message
  }
  const configInvalid = formatConfigInvalidError(input)
  if (configInvalid !== undefined) return configInvalid
  if (UI.CancelledError.isInstance(input)) return ""
}

export function FormatUnknownError(input: unknown): string {
  if (input instanceof Error) {
    return input.stack ?? `${input.name}: ${input.message}`
  }

  if (typeof input === "object" && input !== null) {
    try {
      return JSON.stringify(input, null, 2)
    } catch {
      return "Unexpected error (unserializable)"
    }
  }

  return String(input)
}
