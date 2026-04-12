import z from "zod"

import { fn } from "@/util/fn"
import * as S from "./auth-service"
import { ProviderID } from "./schema"

async function authMethods() {
  return S.ProviderAuthService.methods()
}

const authorize = fn(
  z.object({
    providerID: ProviderID.zod,
    method: z.number(),
  }),
  async (input): Promise<S.Authorization | undefined> => S.ProviderAuthService.authorize(input),
)

const callback = fn(
  z.object({
    providerID: ProviderID.zod,
    method: z.number(),
    code: z.string().optional(),
  }),
  async (input) => S.ProviderAuthService.callback(input),
)

const api = fn(
  z.object({
    providerID: ProviderID.zod,
    key: z.string(),
    inputs: z.record(z.string(), z.string()).optional(),
  }),
  async (input) => S.ProviderAuthService.api(input),
)

export const ProviderAuth = {
  Method: S.Method,
  Authorization: S.Authorization,
  methods: authMethods,
  authorize,
  callback,
  api,
  OauthMissing: S.OauthMissing,
  OauthCodeMissing: S.OauthCodeMissing,
  OauthCallbackFailed: S.OauthCallbackFailed,
} as const

export type { S as _ProviderAuthService }

// Type companion — gives consumers access to ProviderAuth.Method / Authorization types
export declare namespace ProviderAuth {
  type Method = S.Method
  type Authorization = S.Authorization
}
