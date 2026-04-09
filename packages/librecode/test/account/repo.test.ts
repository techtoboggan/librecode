import { expect, test, beforeEach } from "bun:test"

import { AccountRepo } from "../../src/account/repo"
import { AccessToken, AccountID, OrgID, RefreshToken } from "../../src/account/schema"
import { Database } from "../../src/storage/db"

beforeEach(() => {
  const db = Database.Client()
  db.run(/*sql*/ `DELETE FROM account_state`)
  db.run(/*sql*/ `DELETE FROM account`)
})

test("list returns empty when no accounts exist", () => {
  const accounts = AccountRepo.list()
  expect(accounts).toEqual([])
})

test("active returns undefined when no accounts exist", () => {
  const active = AccountRepo.active()
  expect(active).toBeUndefined()
})

test("persistAccount inserts and getRow retrieves", () => {
  const id = AccountID.make("user-1")
  AccountRepo.persistAccount({
    id,
    email: "test@example.com",
    url: "https://control.example.com",
    accessToken: AccessToken.make("at_123"),
    refreshToken: RefreshToken.make("rt_456"),
    expiry: Date.now() + 3600_000,
    orgID: OrgID.make("org-1"),
  })

  const row = AccountRepo.getRow(id)
  expect(row).toBeDefined()
  expect(row!.id).toBe(AccountID.make("user-1"))
  expect(row!.email).toBe("test@example.com")

  const active = AccountRepo.active()
  expect(active).toBeDefined()
  expect(active!.active_org_id).toBe(OrgID.make("org-1"))
})

test("persistAccount sets the active account and org", () => {
  const id1 = AccountID.make("user-1")
  const id2 = AccountID.make("user-2")

  AccountRepo.persistAccount({
    id: id1,
    email: "first@example.com",
    url: "https://control.example.com",
    accessToken: AccessToken.make("at_1"),
    refreshToken: RefreshToken.make("rt_1"),
    expiry: Date.now() + 3600_000,
    orgID: OrgID.make("org-1"),
  })

  AccountRepo.persistAccount({
    id: id2,
    email: "second@example.com",
    url: "https://control.example.com",
    accessToken: AccessToken.make("at_2"),
    refreshToken: RefreshToken.make("rt_2"),
    expiry: Date.now() + 3600_000,
    orgID: OrgID.make("org-2"),
  })

  // Last persisted account is active with its org
  const active = AccountRepo.active()
  expect(active).toBeDefined()
  expect(active!.id).toBe(AccountID.make("user-2"))
  expect(active!.active_org_id).toBe(OrgID.make("org-2"))
})

test("list returns all accounts", () => {
  const id1 = AccountID.make("user-1")
  const id2 = AccountID.make("user-2")

  AccountRepo.persistAccount({
    id: id1,
    email: "a@example.com",
    url: "https://control.example.com",
    accessToken: AccessToken.make("at_1"),
    refreshToken: RefreshToken.make("rt_1"),
    expiry: Date.now() + 3600_000,
    orgID: null,
  })

  AccountRepo.persistAccount({
    id: id2,
    email: "b@example.com",
    url: "https://control.example.com",
    accessToken: AccessToken.make("at_2"),
    refreshToken: RefreshToken.make("rt_2"),
    expiry: Date.now() + 3600_000,
    orgID: OrgID.make("org-1"),
  })

  const accounts = AccountRepo.list()
  expect(accounts.length).toBe(2)
  expect(accounts.map((a) => a.email).sort()).toEqual(["a@example.com", "b@example.com"])
})

test("remove deletes an account", () => {
  const id = AccountID.make("user-1")

  AccountRepo.persistAccount({
    id,
    email: "test@example.com",
    url: "https://control.example.com",
    accessToken: AccessToken.make("at_1"),
    refreshToken: RefreshToken.make("rt_1"),
    expiry: Date.now() + 3600_000,
    orgID: null,
  })

  AccountRepo.remove(id)

  const row = AccountRepo.getRow(id)
  expect(row).toBeUndefined()
})

test("use stores the selected org and marks the account active", () => {
  const id1 = AccountID.make("user-1")
  const id2 = AccountID.make("user-2")

  AccountRepo.persistAccount({
    id: id1,
    email: "first@example.com",
    url: "https://control.example.com",
    accessToken: AccessToken.make("at_1"),
    refreshToken: RefreshToken.make("rt_1"),
    expiry: Date.now() + 3600_000,
    orgID: null,
  })

  AccountRepo.persistAccount({
    id: id2,
    email: "second@example.com",
    url: "https://control.example.com",
    accessToken: AccessToken.make("at_2"),
    refreshToken: RefreshToken.make("rt_2"),
    expiry: Date.now() + 3600_000,
    orgID: null,
  })

  AccountRepo.use(id1, OrgID.make("org-99"))
  const active1 = AccountRepo.active()
  expect(active1!.id).toBe(id1)
  expect(active1!.active_org_id).toBe(OrgID.make("org-99"))

  AccountRepo.use(id1, null)
  const active2 = AccountRepo.active()
  expect(active2!.active_org_id).toBeNull()
})

test("persistToken updates token fields", () => {
  const id = AccountID.make("user-1")

  AccountRepo.persistAccount({
    id,
    email: "test@example.com",
    url: "https://control.example.com",
    accessToken: AccessToken.make("old_token"),
    refreshToken: RefreshToken.make("old_refresh"),
    expiry: 1000,
    orgID: null,
  })

  const expiry = Date.now() + 7200_000
  AccountRepo.persistToken({
    accountID: id,
    accessToken: AccessToken.make("new_token"),
    refreshToken: RefreshToken.make("new_refresh"),
    expiry,
  })

  const row = AccountRepo.getRow(id)
  expect(row!.access_token).toBe(AccessToken.make("new_token"))
  expect(row!.refresh_token).toBe(RefreshToken.make("new_refresh"))
  expect(row!.token_expiry).toBe(expiry)
})

test("persistToken with no expiry sets token_expiry to null", () => {
  const id = AccountID.make("user-1")

  AccountRepo.persistAccount({
    id,
    email: "test@example.com",
    url: "https://control.example.com",
    accessToken: AccessToken.make("old_token"),
    refreshToken: RefreshToken.make("old_refresh"),
    expiry: 1000,
    orgID: null,
  })

  AccountRepo.persistToken({
    accountID: id,
    accessToken: AccessToken.make("new_token"),
    refreshToken: RefreshToken.make("new_refresh"),
    expiry: null,
  })

  const row = AccountRepo.getRow(id)
  expect(row!.token_expiry).toBeNull()
})

test("persistAccount upserts on conflict", () => {
  const id = AccountID.make("user-1")

  AccountRepo.persistAccount({
    id,
    email: "test@example.com",
    url: "https://control.example.com",
    accessToken: AccessToken.make("at_v1"),
    refreshToken: RefreshToken.make("rt_v1"),
    expiry: 1000,
    orgID: OrgID.make("org-1"),
  })

  AccountRepo.persistAccount({
    id,
    email: "test@example.com",
    url: "https://control.example.com",
    accessToken: AccessToken.make("at_v2"),
    refreshToken: RefreshToken.make("rt_v2"),
    expiry: 2000,
    orgID: OrgID.make("org-2"),
  })

  const accounts = AccountRepo.list()
  expect(accounts.length).toBe(1)

  const row = AccountRepo.getRow(id)
  expect(row!.access_token).toBe(AccessToken.make("at_v2"))

  const active = AccountRepo.active()
  expect(active!.active_org_id).toBe(OrgID.make("org-2"))
})

test("remove clears active state when deleting the active account", () => {
  const id = AccountID.make("user-1")

  AccountRepo.persistAccount({
    id,
    email: "test@example.com",
    url: "https://control.example.com",
    accessToken: AccessToken.make("at_1"),
    refreshToken: RefreshToken.make("rt_1"),
    expiry: Date.now() + 3600_000,
    orgID: OrgID.make("org-1"),
  })

  AccountRepo.remove(id)

  const active = AccountRepo.active()
  expect(active).toBeUndefined()
})

test("getRow returns undefined for nonexistent account", () => {
  const row = AccountRepo.getRow(AccountID.make("nope"))
  expect(row).toBeUndefined()
})
