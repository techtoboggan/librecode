import z from "zod"
import { type AuthStorage, createAuthStorage } from "./storage"

export const OAUTH_DUMMY_KEY = "librecode-oauth-dummy-key"

export const Oauth = z.object({
  type: z.literal("oauth"),
  refresh: z.string(),
  access: z.string(),
  expires: z.number(),
  accountId: z.string().optional(),
  enterpriseUrl: z.string().optional(),
})
export type Oauth = z.infer<typeof Oauth>

export const Api = z.object({
  type: z.literal("api"),
  key: z.string(),
})
export type Api = z.infer<typeof Api>

export const WellKnown = z.object({
  type: z.literal("wellknown"),
  key: z.string(),
  token: z.string(),
})
export type WellKnown = z.infer<typeof WellKnown>

export const Info = z.discriminatedUnion("type", [Oauth, Api, WellKnown])
export type Info = z.infer<typeof Info>

// A02 — Auth blobs are now stored via AuthStorage (OS keychain on
// macOS/Windows/Linux-with-keyring, file fallback elsewhere). See
// packages/librecode/src/auth/storage.ts. The Filesystem.readJson /
// writeJson calls that used to live here have moved into FileAuthStorage.

let storagePromise: Promise<AuthStorage> | undefined

function storage(): Promise<AuthStorage> {
  if (!storagePromise) storagePromise = createAuthStorage()
  return storagePromise
}

/** Test helper — resets the cached storage so LIBRECODE_AUTH_STORAGE re-applies. */
export function _resetAuthStorageCache(): void {
  storagePromise = undefined
}

export async function all(): Promise<Record<string, Info>> {
  const s = await storage()
  const data = await s.read()
  const result: Record<string, Info> = {}
  for (const [key, value] of Object.entries(data)) {
    const parsed = Info.safeParse(value)
    if (parsed.success) {
      result[key] = parsed.data
    }
  }
  return result
}

export async function get(providerID: string): Promise<Info | undefined> {
  const data = await all()
  return data[providerID]
}

export async function set(key: string, info: Info): Promise<void> {
  const norm = key.replace(/\/+$/, "")
  const s = await storage()
  const data = await s.read()
  if (norm !== key) delete data[key]
  delete data[`${norm}/`]
  await s.write({ ...data, [norm]: info })
}

export async function remove(key: string): Promise<void> {
  const norm = key.replace(/\/+$/, "")
  const s = await storage()
  const data = await s.read()
  delete data[key]
  delete data[norm]
  await s.write(data)
}
