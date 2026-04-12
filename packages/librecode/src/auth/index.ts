import z from "zod"
import * as S from "./service"

export { OAUTH_DUMMY_KEY } from "./service"

const AuthOauth = z
  .object({
    type: z.literal("oauth"),
    refresh: z.string(),
    access: z.string(),
    expires: z.number(),
    accountId: z.string().optional(),
    enterpriseUrl: z.string().optional(),
  })
  .meta({ ref: "OAuth" })

const AuthApi = z
  .object({
    type: z.literal("api"),
    key: z.string(),
  })
  .meta({ ref: "ApiAuth" })

const AuthWellKnown = z
  .object({
    type: z.literal("wellknown"),
    key: z.string(),
    token: z.string(),
  })
  .meta({ ref: "WellKnownAuth" })

const AuthInfo = z.discriminatedUnion("type", [AuthOauth, AuthApi, AuthWellKnown]).meta({ ref: "Auth" })
type AuthInfoType = z.infer<typeof AuthInfo>

export const Auth = {
  Oauth: AuthOauth,
  Api: AuthApi,
  WellKnown: AuthWellKnown,
  Info: AuthInfo,
  get: async (providerID: string) => S.get(providerID),
  all: async (): Promise<Record<string, AuthInfoType>> => S.all(),
  set: async (key: string, info: AuthInfoType) => S.set(key, info),
  remove: async (key: string) => S.remove(key),
}
// biome-ignore lint/style/noNamespace: type companion for declaration merging
export declare namespace Auth {
  type Info = AuthInfoType
}
