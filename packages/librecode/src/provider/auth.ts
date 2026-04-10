import z from "zod"

import { fn } from "@/util/fn"
import * as S from "./auth-service"
import { ProviderID } from "./schema"

export namespace ProviderAuth {
  export const Method = S.Method
  export type Method = S.Method

  export async function methods() {
    return S.ProviderAuthService.methods()
  }

  export const Authorization = S.Authorization
  export type Authorization = S.Authorization

  export const authorize = fn(
    z.object({
      providerID: ProviderID.zod,
      method: z.number(),
    }),
    async (input): Promise<Authorization | undefined> => S.ProviderAuthService.authorize(input),
  )

  export const callback = fn(
    z.object({
      providerID: ProviderID.zod,
      method: z.number(),
      code: z.string().optional(),
    }),
    async (input) => S.ProviderAuthService.callback(input),
  )

  export const api = fn(
    z.object({
      providerID: ProviderID.zod,
      key: z.string(),
      inputs: z.record(z.string(), z.string()).optional(),
    }),
    async (input) => S.ProviderAuthService.api(input),
  )

  export import OauthMissing = S.OauthMissing
  export import OauthCodeMissing = S.OauthCodeMissing
  export import OauthCallbackFailed = S.OauthCallbackFailed
}
