import { expect, test, beforeEach, mock } from "bun:test"
import { AccountRepo } from "../../src/account/repo"
import { AccountService } from "../../src/account/service"
import { AccessToken, AccountID, DeviceCode, Login, OrgID, RefreshToken, UserCode } from "../../src/account/schema"
import { Database } from "../../src/storage/db"

beforeEach(() => {
  const db = Database.Client()
  db.run(/*sql*/ `DELETE FROM account_state`)
  db.run(/*sql*/ `DELETE FROM account`)
})

function mockFetch(handler: (url: string, init?: RequestInit) => { body: unknown; status?: number }) {
  const original = globalThis.fetch
  const seen: string[] = []
  const headers: Record<string, string | undefined>[] = []
  const mocked = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url
    seen.push(`${init?.method ?? "GET"} ${url}`)
    headers.push({
      auth: (init?.headers as Record<string, string>)?.["Authorization"],
      org: (init?.headers as Record<string, string>)?.["x-org-id"],
    })
    const result = handler(url, init)
    return new Response(JSON.stringify(result.body), {
      status: result.status ?? 200,
      headers: { "content-type": "application/json" },
    })
  })
  globalThis.fetch = mocked as unknown as typeof fetch
  return {
    seen,
    headers,
    restore() {
      globalThis.fetch = original
    },
  }
}

test("orgsByAccount groups orgs per account", async () => {
  AccountRepo.persistAccount({
    id: AccountID.make("user-1"),
    email: "one@example.com",
    url: "https://one.example.com",
    accessToken: AccessToken.make("at_1"),
    refreshToken: RefreshToken.make("rt_1"),
    expiry: Date.now() + 60_000,
    orgID: null,
  })

  AccountRepo.persistAccount({
    id: AccountID.make("user-2"),
    email: "two@example.com",
    url: "https://two.example.com",
    accessToken: AccessToken.make("at_2"),
    refreshToken: RefreshToken.make("rt_2"),
    expiry: Date.now() + 60_000,
    orgID: null,
  })

  const f = mockFetch((url) => {
    if (url === "https://one.example.com/api/orgs") return { body: [{ id: "org-1", name: "One" }] }
    if (url === "https://two.example.com/api/orgs")
      return {
        body: [
          { id: "org-2", name: "Two A" },
          { id: "org-3", name: "Two B" },
        ],
      }
    return { body: [], status: 404 }
  })

  try {
    const rows = await AccountService.orgsByAccount()
    expect(rows.map((row) => [row.account.id, row.orgs.map((org) => org.id)]).map(([id, orgs]) => [id, orgs])).toEqual([
      [AccountID.make("user-1"), [OrgID.make("org-1")]],
      [AccountID.make("user-2"), [OrgID.make("org-2"), OrgID.make("org-3")]],
    ])
    expect(f.seen).toEqual(["GET https://one.example.com/api/orgs", "GET https://two.example.com/api/orgs"])
  } finally {
    f.restore()
  }
})

test("token refresh persists the new token", async () => {
  const id = AccountID.make("user-1")

  AccountRepo.persistAccount({
    id,
    email: "user@example.com",
    url: "https://one.example.com",
    accessToken: AccessToken.make("at_old"),
    refreshToken: RefreshToken.make("rt_old"),
    expiry: Date.now() - 1_000,
    orgID: null,
  })

  const f = mockFetch((url) => {
    if (url === "https://one.example.com/auth/device/token")
      return { body: { access_token: "at_new", refresh_token: "rt_new", expires_in: 60 } }
    return { body: {}, status: 404 }
  })

  try {
    const token = await AccountService.token(id)
    expect(token).toBeDefined()
    expect(String(token)).toBe("at_new")

    const row = AccountRepo.getRow(id)
    expect(row!.access_token).toBe(AccessToken.make("at_new"))
    expect(row!.refresh_token).toBe(RefreshToken.make("rt_new"))
    expect(row!.token_expiry).toBeGreaterThan(Date.now())
  } finally {
    f.restore()
  }
})

test("config sends the selected org header", async () => {
  const id = AccountID.make("user-1")

  AccountRepo.persistAccount({
    id,
    email: "user@example.com",
    url: "https://one.example.com",
    accessToken: AccessToken.make("at_1"),
    refreshToken: RefreshToken.make("rt_1"),
    expiry: Date.now() + 60_000,
    orgID: null,
  })

  const f = mockFetch((url) => {
    if (url === "https://one.example.com/api/config") return { body: { config: { theme: "light", seats: 5 } } }
    return { body: {}, status: 404 }
  })

  try {
    const cfg = await AccountService.config(id, OrgID.make("org-9"))
    expect(cfg).toEqual({ theme: "light", seats: 5 })
    expect(f.headers[0]).toEqual({
      auth: "Bearer at_1",
      org: "org-9",
    })
  } finally {
    f.restore()
  }
})

test("poll stores the account and first org on success", async () => {
  const login = new Login({
    code: DeviceCode.make("device-code"),
    user: UserCode.make("user-code"),
    url: "https://one.example.com/verify",
    server: "https://one.example.com",
    expiry: 600 * 1000,
    interval: 5 * 1000,
  })

  const f = mockFetch((url) => {
    if (url === "https://one.example.com/auth/device/token")
      return {
        body: {
          access_token: "at_1",
          refresh_token: "rt_1",
          token_type: "Bearer",
          expires_in: 60,
        },
      }
    if (url === "https://one.example.com/api/user") return { body: { id: "user-1", email: "user@example.com" } }
    if (url === "https://one.example.com/api/orgs") return { body: [{ id: "org-1", name: "One" }] }
    return { body: {}, status: 404 }
  })

  try {
    const res = await AccountService.poll(login)
    expect(res._tag).toBe("PollSuccess")
    if (res._tag === "PollSuccess") {
      expect(res.email).toBe("user@example.com")
    }

    const active = AccountRepo.active()
    expect(active).toEqual(
      expect.objectContaining({
        id: "user-1",
        email: "user@example.com",
        active_org_id: "org-1",
      }),
    )
  } finally {
    f.restore()
  }
})
