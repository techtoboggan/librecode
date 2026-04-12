import { Account as AccountSchema, type AccessToken, type AccountID, AccountService, type OrgID } from "./service"

export { AccessToken, AccountID, OrgID } from "./service"

export namespace Account {
  export const Account = AccountSchema
  export type Account = AccountSchema

  export function active(): Account | undefined {
    return AccountService.active()
  }

  export async function config(accountID: AccountID, orgID: OrgID): Promise<Record<string, unknown> | undefined> {
    return AccountService.config(accountID, orgID)
  }

  export async function token(accountID: AccountID): Promise<AccessToken | undefined> {
    return AccountService.token(accountID)
  }
}
