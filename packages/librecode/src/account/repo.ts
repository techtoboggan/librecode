import { eq } from "drizzle-orm"

import { Database } from "@/storage/db"
import { AccountStateTable, AccountTable } from "./account.sql"
import type { Account, AccountID, OrgID, AccessToken, RefreshToken } from "./schema"

export type AccountRow = (typeof AccountTable)["$inferSelect"]

type DbClient = Parameters<typeof Database.use>[0] extends (db: infer T) => unknown ? T : never

const ACCOUNT_STATE_ID = 1

function decode(row: AccountRow & { active_org_id?: string | null }): Account {
  return row as unknown as Account
}

function current(db: DbClient) {
  const state = db.select().from(AccountStateTable).where(eq(AccountStateTable.id, ACCOUNT_STATE_ID)).get()
  if (!state?.active_account_id) return undefined
  const account = db.select().from(AccountTable).where(eq(AccountTable.id, state.active_account_id)).get()
  if (!account) return undefined
  return { ...account, active_org_id: state.active_org_id ?? null }
}

function setActive(db: DbClient, accountID: AccountID, orgID: OrgID | null | undefined) {
  return db
    .insert(AccountStateTable)
    .values({ id: ACCOUNT_STATE_ID, active_account_id: accountID, active_org_id: orgID ?? null })
    .onConflictDoUpdate({
      target: AccountStateTable.id,
      set: { active_account_id: accountID, active_org_id: orgID ?? null },
    })
    .run()
}

export namespace AccountRepo {
  export function active(): Account | undefined {
    const row = Database.use((db) => current(db))
    if (!row) return undefined
    return decode(row)
  }

  export function list(): Account[] {
    return Database.use((db) =>
      db
        .select()
        .from(AccountTable)
        .all()
        .map((row: AccountRow) => decode({ ...row, active_org_id: null })),
    )
  }

  export function remove(accountID: AccountID): void {
    Database.transaction((db) => {
      db.update(AccountStateTable)
        .set({ active_account_id: null, active_org_id: null })
        .where(eq(AccountStateTable.active_account_id, accountID))
        .run()
      db.delete(AccountTable).where(eq(AccountTable.id, accountID)).run()
    })
  }

  export function use(accountID: AccountID, orgID: OrgID | null | undefined): void {
    Database.use((db) => setActive(db, accountID, orgID))
  }

  export function getRow(accountID: AccountID): AccountRow | undefined {
    return Database.use((db) => db.select().from(AccountTable).where(eq(AccountTable.id, accountID)).get())
  }

  export function persistToken(input: {
    accountID: AccountID
    accessToken: AccessToken
    refreshToken: RefreshToken
    expiry: number | null | undefined
  }): void {
    Database.use((db) =>
      db
        .update(AccountTable)
        .set({
          access_token: input.accessToken,
          refresh_token: input.refreshToken,
          token_expiry: input.expiry ?? null,
        })
        .where(eq(AccountTable.id, input.accountID))
        .run(),
    )
  }

  export function persistAccount(input: {
    id: AccountID
    email: string
    url: string
    accessToken: AccessToken
    refreshToken: RefreshToken
    expiry: number
    orgID: OrgID | null | undefined
  }): void {
    Database.transaction((db) => {
      db.insert(AccountTable)
        .values({
          id: input.id,
          email: input.email,
          url: input.url,
          access_token: input.accessToken,
          refresh_token: input.refreshToken,
          token_expiry: input.expiry,
        })
        .onConflictDoUpdate({
          target: AccountTable.id,
          set: {
            access_token: input.accessToken,
            refresh_token: input.refreshToken,
            token_expiry: input.expiry,
          },
        })
        .run()
      setActive(db, input.id, input.orgID)
    })
  }
}
