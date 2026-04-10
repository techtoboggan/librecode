import { Instance } from "@/project/instance"
import { Plugin } from "../plugin"
import { filter, fromEntries, map, pipe } from "remeda"
import type { AuthHook, AuthOuathResult } from "@librecode/plugin"
import { NamedError } from "@librecode/util/error"
import * as Auth from "@/auth/service"
import { ProviderID } from "./schema"
import z from "zod"

export const MethodPrompt = z
  .discriminatedUnion("type", [
    z.object({
      type: z.literal("text"),
      key: z.string(),
      message: z.string(),
      placeholder: z.string().optional(),
    }),
    z.object({
      type: z.literal("select"),
      key: z.string(),
      message: z.string(),
      options: z.array(
        z.object({
          label: z.string(),
          value: z.string(),
          hint: z.string().optional(),
        }),
      ),
    }),
  ])
  .meta({ ref: "ProviderAuthMethodPrompt" })
export type MethodPrompt = z.infer<typeof MethodPrompt>

export const Method = z
  .object({
    type: z.union([z.literal("oauth"), z.literal("api")]),
    label: z.string(),
    prompts: z.array(MethodPrompt).optional(),
  })
  .meta({
    ref: "ProviderAuthMethod",
  })
export type Method = z.infer<typeof Method>

export const Authorization = z
  .object({
    url: z.string(),
    method: z.union([z.literal("auto"), z.literal("code")]),
    instructions: z.string(),
  })
  .meta({
    ref: "ProviderAuthAuthorization",
  })
export type Authorization = z.infer<typeof Authorization>

export const OauthMissing = NamedError.create(
  "ProviderAuthOauthMissing",
  z.object({
    providerID: ProviderID.zod,
  }),
)

export const OauthCodeMissing = NamedError.create(
  "ProviderAuthOauthCodeMissing",
  z.object({
    providerID: ProviderID.zod,
  }),
)

export const OauthCallbackFailed = NamedError.create("ProviderAuthOauthCallbackFailed", z.object({}))

export type ProviderAuthError =
  | Error
  | InstanceType<typeof OauthMissing>
  | InstanceType<typeof OauthCodeMissing>
  | InstanceType<typeof OauthCallbackFailed>

interface ProviderAuthState {
  methods: Record<string, AuthHook>
  pending: Map<ProviderID, AuthOuathResult>
}

const state = Instance.state(async (): Promise<ProviderAuthState> => {
  const methods = pipe(
    await Plugin.list(),
    filter((x) => x.auth?.provider !== undefined),
    map((x) => [x.auth!.provider, x.auth!] as const),
    fromEntries(),
  )
  return { methods, pending: new Map<ProviderID, AuthOuathResult>() }
})

export namespace ProviderAuthService {
  export async function methods(): Promise<Record<string, Method[]>> {
    const s = await state()
    const result: Record<string, Method[]> = {}
    for (const [key, value] of Object.entries(s.methods)) {
      result[key] = value.methods.map((m): Method => ({
        type: m.type as "oauth" | "api",
        label: m.label,
        ...(m.prompts?.length
          ? {
              prompts: m.prompts.map((p) => {
                if (p.type === "text") return { type: "text" as const, key: p.key, message: p.message, placeholder: p.placeholder }
                return { type: "select" as const, key: p.key, message: p.message, options: p.options }
              }),
            }
          : {}),
      }))
    }
    return result
  }

  export async function authorize(input: {
    providerID: ProviderID
    method: number
  }): Promise<Authorization | undefined> {
    const s = await state()
    const method = s.methods[input.providerID].methods[input.method]
    if (method.type !== "oauth") return undefined
    const result = await (method as Extract<typeof method, { type: "oauth" }>).authorize()
    s.pending.set(input.providerID, result)
    return {
      url: result.url,
      method: result.method,
      instructions: result.instructions,
    }
  }

  export async function callback(input: {
    providerID: ProviderID
    method: number
    code?: string
  }): Promise<void> {
    const s = await state()
    const match = s.pending.get(input.providerID)
    if (!match) throw new OauthMissing({ providerID: input.providerID })

    if (match.method === "code" && !input.code) throw new OauthCodeMissing({ providerID: input.providerID })

    const result = await (match.method === "code" ? match.callback(input.code!) : match.callback())

    if (!result || result.type !== "success") throw new OauthCallbackFailed({})

    if ("key" in result) {
      await Auth.set(input.providerID, {
        type: "api",
        key: result.key,
      })
    }

    if ("refresh" in result) {
      await Auth.set(input.providerID, {
        type: "oauth",
        access: result.access,
        refresh: result.refresh,
        expires: result.expires,
        ...(result.accountId ? { accountId: result.accountId } : {}),
      })
    }
  }

  export async function api(input: {
    providerID: ProviderID
    key: string
    inputs?: Record<string, string>
  }): Promise<void> {
    // If inputs are provided, look for a custom authorize function on the plugin
    if (input.inputs) {
      const s = await state()
      const hook = s.methods[input.providerID]
      if (hook) {
        const methodIndex = hook.methods.findIndex((m) => m.type === "api")
        if (methodIndex >= 0) {
          const method = hook.methods[methodIndex] as Extract<(typeof hook.methods)[number], { type: "api" }>
          if (method.authorize) {
            const result = await method.authorize(input.inputs)
            if (result.type === "failed") {
              throw new Error("Authorization failed")
            }
            await Auth.set(result.provider ?? input.providerID, {
              type: "api",
              key: result.key,
            })
            return
          }
        }
      }
    }

    await Auth.set(input.providerID, {
      type: "api",
      key: input.key,
    })
  }
}
