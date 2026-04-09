import z from "zod"

import type { Brand } from "@/util/brand"

export type ProviderID = Brand<string, "ProviderID">
export const ProviderID = {
  make: (id: string) => id as ProviderID,
  zod: z.string() as unknown as z.ZodType<ProviderID>,
  // Well-known providers
  librecode: "librecode" as ProviderID,
  anthropic: "anthropic" as ProviderID,
  openai: "openai" as ProviderID,
  google: "google" as ProviderID,
  googleVertex: "google-vertex" as ProviderID,
  githubCopilot: "github-copilot" as ProviderID,
  githubCopilotEnterprise: "github-copilot-enterprise" as ProviderID,
  amazonBedrock: "amazon-bedrock" as ProviderID,
  azure: "azure" as ProviderID,
  openrouter: "openrouter" as ProviderID,
  mistral: "mistral" as ProviderID,
}

export type ModelID = Brand<string, "ModelID">
export const ModelID = {
  make: (id: string) => id as ModelID,
  zod: z.string() as unknown as z.ZodType<ModelID>,
}
