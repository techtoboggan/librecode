import { retry } from "@librecode/util/retry"
import z from "zod"

import { AccountRepo, type AccountRow } from "./repo"
import {
  type AccessToken,
  Account,
  AccountID,
  DeviceCode,
  RefreshToken,
  Login,
  Org,
  OrgID,
  PollDenied,
  PollError,
  PollExpired,
  PollPending,
  type PollResult,
  PollSlow,
  PollSuccess,
  UserCode,
} from "./schema"

export * from "./schema"

export type AccountOrgs = {
  account: Account
  orgs: readonly Org[]
}

const RemoteConfig = z.object({
  config: z.record(z.string(), z.unknown()),
})

const TokenRefresh = z.object({
  access_token: z.string(),
  refresh_token: z.string(),
  expires_in: z.number(),
})

const DeviceAuth = z.object({
  device_code: z.string(),
  user_code: z.string(),
  verification_uri_complete: z.string(),
  expires_in: z.number(),
  interval: z.number(),
})

const DeviceTokenSuccess = z.object({
  access_token: z.string(),
  refresh_token: z.string(),
  token_type: z.literal("Bearer"),
  expires_in: z.number(),
})

const DeviceTokenError = z.object({
  error: z.string(),
  error_description: z.string(),
})

const User = z.object({
  id: z.string(),
  email: z.string(),
})

const clientId = "librecode-cli"

async function fetchWithRetry(input: RequestInfo, init?: RequestInit): Promise<Response> {
  return retry(() => fetch(input, init), { attempts: 3, delay: 200 })
}

async function fetchJson<T>(input: RequestInfo, init?: RequestInit): Promise<T> {
  const response = await fetchWithRetry(input, init)
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`)
  }
  return response.json() as Promise<T>
}

async function resolveToken(row: AccountRow): Promise<AccessToken> {
  const now = Date.now()
  if (row.token_expiry && row.token_expiry > now) return row.access_token as AccessToken

  const body = JSON.stringify({
    grant_type: "refresh_token",
    refresh_token: row.refresh_token,
    client_id: clientId,
  })

  const data = await fetchJson<unknown>(`${row.url}/auth/device/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body,
  })

  const parsed = TokenRefresh.parse(data)
  const expiry = now + parsed.expires_in * 1000

  AccountRepo.persistToken({
    accountID: row.id as AccountID,
    accessToken: parsed.access_token as AccessToken,
    refreshToken: parsed.refresh_token as RefreshToken,
    expiry,
  })

  return parsed.access_token as AccessToken
}

function resolveAccess(accountID: AccountID): { account: AccountRow; accessToken: AccessToken } | undefined {
  const row = AccountRepo.getRow(accountID)
  if (!row) return undefined
  // Note: token resolution is sync-safe when token hasn't expired.
  // For expired tokens this returns the cached token — callers that need
  // fresh tokens should use resolveAccessAsync.
  return { account: row, accessToken: row.access_token as AccessToken }
}

async function resolveAccessAsync(
  accountID: AccountID,
): Promise<{ account: AccountRow; accessToken: AccessToken } | undefined> {
  const row = AccountRepo.getRow(accountID)
  if (!row) return undefined
  const accessToken = await resolveToken(row)
  return { account: row, accessToken }
}

async function fetchOrgs(url: string, accessToken: AccessToken): Promise<readonly Org[]> {
  const data = await fetchJson<Array<{ id: string; name: string }>>(`${url}/api/orgs`, {
    headers: { Accept: "application/json", Authorization: `Bearer ${accessToken}` },
  })
  return data.map((d) => new Org({ id: OrgID.make(d.id), name: d.name }))
}

async function fetchUser(url: string, accessToken: AccessToken): Promise<z.infer<typeof User>> {
  const data = await fetchJson<unknown>(`${url}/api/user`, {
    headers: { Accept: "application/json", Authorization: `Bearer ${accessToken}` },
  })
  return User.parse(data)
}

export namespace AccountService {
  export function active(): Account | undefined {
    return AccountRepo.active()
  }

  export function list(): Account[] {
    return AccountRepo.list()
  }

  export async function orgsByAccount(): Promise<readonly AccountOrgs[]> {
    const accounts = AccountRepo.list()
    const results: AccountOrgs[] = []
    const settled = await Promise.allSettled(
      accounts.map(async (account) => {
        const o = await orgs(account.id)
        return { account, orgs: o }
      }),
    )
    for (const result of settled) {
      if (result.status === "fulfilled") {
        results.push(result.value)
      }
    }
    return results
  }

  export function remove(accountID: AccountID): void {
    AccountRepo.remove(accountID)
  }

  export function use(accountID: AccountID, orgID: OrgID | null | undefined): void {
    AccountRepo.use(accountID, orgID)
  }

  export async function orgs(accountID: AccountID): Promise<readonly Org[]> {
    const resolved = await resolveAccessAsync(accountID)
    if (!resolved) return []
    return fetchOrgs(resolved.account.url, resolved.accessToken)
  }

  export async function config(
    accountID: AccountID,
    orgID: OrgID,
  ): Promise<Record<string, unknown> | undefined> {
    const resolved = await resolveAccessAsync(accountID)
    if (!resolved) return undefined

    const response = await fetchWithRetry(`${resolved.account.url}/api/config`, {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${resolved.accessToken}`,
        "x-org-id": orgID,
      },
    })

    if (response.status === 404) return undefined
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`)

    const data = await response.json()
    const parsed = RemoteConfig.parse(data)
    return parsed.config as Record<string, unknown>
  }

  export async function token(accountID: AccountID): Promise<AccessToken | undefined> {
    const resolved = await resolveAccessAsync(accountID)
    if (!resolved) return undefined
    return resolved.accessToken
  }

  export async function login(server: string): Promise<Login> {
    const body = JSON.stringify({ client_id: clientId })

    const data = await fetchJson<unknown>(`${server}/auth/device/code`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body,
    })

    const parsed = DeviceAuth.parse(data)
    return new Login({
      code: DeviceCode.make(parsed.device_code),
      user: UserCode.make(parsed.user_code),
      url: `${server}${parsed.verification_uri_complete}`,
      server,
      expiry: parsed.expires_in * 1000,
      interval: parsed.interval * 1000,
    })
  }

  export async function poll(input: Login): Promise<PollResult> {
    const body = JSON.stringify({
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      device_code: input.code,
      client_id: clientId,
    })

    const response = await fetch(`${input.server}/auth/device/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body,
    })

    if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`)

    const data = await response.json()

    // Try parsing as error first
    const errorResult = DeviceTokenError.safeParse(data)
    if (errorResult.success && errorResult.data.error) {
      const err = errorResult.data
      if (err.error === "authorization_pending") return new PollPending()
      if (err.error === "slow_down") return new PollSlow()
      if (err.error === "expired_token") return new PollExpired()
      if (err.error === "access_denied") return new PollDenied()
      return new PollError({ cause: err.error })
    }

    const parsed = DeviceTokenSuccess.parse(data)
    const accessToken = parsed.access_token as AccessToken

    const [account, remoteOrgs] = await Promise.all([
      fetchUser(input.server, accessToken),
      fetchOrgs(input.server, accessToken),
    ])

    const firstOrgID: OrgID | null = remoteOrgs.length > 0 ? (remoteOrgs[0].id as OrgID) : null

    const now = Date.now()
    const expiry = now + parsed.expires_in * 1000
    const refreshToken = parsed.refresh_token as RefreshToken

    AccountRepo.persistAccount({
      id: account.id as AccountID,
      email: account.email,
      url: input.server,
      accessToken,
      refreshToken,
      expiry,
      orgID: firstOrgID,
    })

    return new PollSuccess({ email: account.email })
  }
}
