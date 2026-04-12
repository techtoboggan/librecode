import path from "node:path"
import z from "zod"
import { Global } from "../global"
import { Filesystem } from "../util/filesystem"

const Tokens = z.object({
  accessToken: z.string(),
  refreshToken: z.string().optional(),
  expiresAt: z.number().optional(),
  scope: z.string().optional(),
})

const ClientInfo = z.object({
  clientId: z.string(),
  clientSecret: z.string().optional(),
  clientIdIssuedAt: z.number().optional(),
  clientSecretExpiresAt: z.number().optional(),
})

const Entry = z.object({
  tokens: Tokens.optional(),
  clientInfo: ClientInfo.optional(),
  codeVerifier: z.string().optional(),
  oauthState: z.string().optional(),
  serverUrl: z.string().optional(), // Track the URL these credentials are for
})

const filepath = path.join(Global.Path.data, "mcp-auth.json")

async function get(mcpName: string): Promise<McpAuth.Entry | undefined> {
  const data = await all()
  return data[mcpName]
}

/**
 * Get auth entry and validate it's for the correct URL.
 * Returns undefined if URL has changed (credentials are invalid).
 */
async function getForUrl(mcpName: string, serverUrl: string): Promise<McpAuth.Entry | undefined> {
  const entry = await get(mcpName)
  if (!entry) return undefined

  // If no serverUrl is stored, this is from an old version - consider it invalid
  if (!entry.serverUrl) return undefined

  // If URL has changed, credentials are invalid
  if (entry.serverUrl !== serverUrl) return undefined

  return entry
}

async function all(): Promise<Record<string, McpAuth.Entry>> {
  return Filesystem.readJson<Record<string, McpAuth.Entry>>(filepath).catch(() => ({}))
}

async function set(mcpName: string, entry: McpAuth.Entry, serverUrl?: string): Promise<void> {
  const data = await all()
  // Always update serverUrl if provided
  if (serverUrl) {
    entry.serverUrl = serverUrl
  }
  await Filesystem.writeJson(filepath, { ...data, [mcpName]: entry }, 0o600)
}

async function remove(mcpName: string): Promise<void> {
  const data = await all()
  delete data[mcpName]
  await Filesystem.writeJson(filepath, data, 0o600)
}

async function updateTokens(mcpName: string, tokens: McpAuth.Tokens, serverUrl?: string): Promise<void> {
  const entry = (await get(mcpName)) ?? {}
  entry.tokens = tokens
  await set(mcpName, entry, serverUrl)
}

async function updateClientInfo(mcpName: string, clientInfo: McpAuth.ClientInfo, serverUrl?: string): Promise<void> {
  const entry = (await get(mcpName)) ?? {}
  entry.clientInfo = clientInfo
  await set(mcpName, entry, serverUrl)
}

async function updateCodeVerifier(mcpName: string, codeVerifier: string): Promise<void> {
  const entry = (await get(mcpName)) ?? {}
  entry.codeVerifier = codeVerifier
  await set(mcpName, entry)
}

async function clearCodeVerifier(mcpName: string): Promise<void> {
  const entry = await get(mcpName)
  if (entry) {
    delete entry.codeVerifier
    await set(mcpName, entry)
  }
}

async function updateOAuthState(mcpName: string, oauthState: string): Promise<void> {
  const entry = (await get(mcpName)) ?? {}
  entry.oauthState = oauthState
  await set(mcpName, entry)
}

async function getOAuthState(mcpName: string): Promise<string | undefined> {
  const entry = await get(mcpName)
  return entry?.oauthState
}

async function clearOAuthState(mcpName: string): Promise<void> {
  const entry = await get(mcpName)
  if (entry) {
    delete entry.oauthState
    await set(mcpName, entry)
  }
}

/**
 * Check if stored tokens are expired.
 * Returns null if no tokens exist, false if no expiry or not expired, true if expired.
 */
async function isTokenExpired(mcpName: string): Promise<boolean | null> {
  const entry = await get(mcpName)
  if (!entry?.tokens) return null
  if (!entry.tokens.expiresAt) return false
  return entry.tokens.expiresAt < Date.now() / 1000
}

export const McpAuth = {
  Tokens,
  ClientInfo,
  Entry,
  get,
  getForUrl,
  all,
  set,
  remove,
  updateTokens,
  updateClientInfo,
  updateCodeVerifier,
  clearCodeVerifier,
  updateOAuthState,
  getOAuthState,
  clearOAuthState,
  isTokenExpired,
} as const

// biome-ignore lint/style/noNamespace: type companion for declaration merging
export declare namespace McpAuth {
  type Tokens = z.infer<typeof Tokens>
  type ClientInfo = z.infer<typeof ClientInfo>
  type Entry = z.infer<typeof Entry>
}
