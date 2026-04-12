import { type AccessToken, type AccountID, Account as AccountSchema, AccountService, type OrgID } from "./service"

export { AccessToken, AccountID, OrgID } from "./service"

function accountActive(): AccountSchema | undefined {
  return AccountService.active()
}

async function accountConfig(accountID: AccountID, orgID: OrgID): Promise<Record<string, unknown> | undefined> {
  return AccountService.config(accountID, orgID)
}

async function accountToken(accountID: AccountID): Promise<AccessToken | undefined> {
  return AccountService.token(accountID)
}

export const Account = {
  Account: AccountSchema,
  active: accountActive,
  config: accountConfig,
  token: accountToken,
}
// biome-ignore lint/style/noNamespace: type companion for declaration merging
export declare namespace Account {
  type Account = AccountSchema
}
