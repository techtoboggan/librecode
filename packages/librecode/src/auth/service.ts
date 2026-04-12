import path from "node:path"
import z from "zod"
import { Global } from "../global"
import { Filesystem } from "../util/filesystem"

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

const file = path.join(Global.Path.data, "auth.json")

export async function all(): Promise<Record<string, Info>> {
  let data: Record<string, unknown>
  try {
    data = await Filesystem.readJson<Record<string, unknown>>(file)
  } catch {
    data = {}
  }
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
  const data = await all()
  if (norm !== key) delete data[key]
  delete data[`${norm}/`]
  await Filesystem.writeJson(file, { ...data, [norm]: info }, 0o600)
}

export async function remove(key: string): Promise<void> {
  const norm = key.replace(/\/+$/, "")
  const data = await all()
  delete data[key]
  delete data[norm]
  await Filesystem.writeJson(file, data, 0o600)
}
