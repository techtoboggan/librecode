import type { McpServer } from "@agentclientprotocol/sdk"
import type { OpencodeClient } from "@librecode/sdk/v2"
import type { ModelID, ProviderID } from "../provider/schema"

export interface ACPSessionState {
  id: string
  cwd: string
  mcpServers: McpServer[]
  createdAt: Date
  model?: {
    providerID: ProviderID
    modelID: ModelID
  }
  variant?: string
  modeId?: string
}

export interface ACPConfig {
  sdk: OpencodeClient
  defaultModel?: {
    providerID: ProviderID
    modelID: ModelID
  }
}
