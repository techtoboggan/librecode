import type { Brand } from "@/util/brand"

// ── Branded string types ──────────────────────────────────────────────

export type AccountID = Brand<string, "AccountID">
export const AccountID = { make: (id: string) => id as AccountID }

export type OrgID = Brand<string, "OrgID">
export const OrgID = { make: (id: string) => id as OrgID }

export type AccessToken = Brand<string, "AccessToken">
export const AccessToken = { make: (token: string) => token as AccessToken }

export type RefreshToken = Brand<string, "RefreshToken">
export const RefreshToken = { make: (token: string) => token as RefreshToken }

export type DeviceCode = Brand<string, "DeviceCode">
export const DeviceCode = { make: (code: string) => code as DeviceCode }

export type UserCode = Brand<string, "UserCode">
export const UserCode = { make: (code: string) => code as UserCode }

// ── Data classes ──────────────────────────────────────────────────────

export class Account {
  readonly id: AccountID
  readonly email: string
  readonly url: string
  readonly active_org_id: OrgID | null

  constructor(props: { id: AccountID; email: string; url: string; active_org_id: OrgID | null }) {
    this.id = props.id
    this.email = props.email
    this.url = props.url
    this.active_org_id = props.active_org_id
  }
}

export class Org {
  readonly id: OrgID
  readonly name: string

  constructor(props: { id: OrgID; name: string }) {
    this.id = props.id
    this.name = props.name
  }
}

export class Login {
  readonly code: DeviceCode
  readonly user: UserCode
  readonly url: string
  readonly server: string
  /** Expiry duration in milliseconds */
  readonly expiry: number
  /** Poll interval in milliseconds */
  readonly interval: number

  constructor(props: {
    code: DeviceCode
    user: UserCode
    url: string
    server: string
    expiry: number
    interval: number
  }) {
    this.code = props.code
    this.user = props.user
    this.url = props.url
    this.server = props.server
    this.expiry = props.expiry
    this.interval = props.interval
  }
}

// ── Error classes ─────────────────────────────────────────────────────

export class AccountRepoError extends Error {
  readonly _tag = "AccountRepoError" as const
  override readonly cause?: unknown

  constructor(props: { message: string; cause?: unknown }) {
    super(props.message)
    this.name = "AccountRepoError"
    this.cause = props.cause
  }
}

export class AccountServiceError extends Error {
  readonly _tag = "AccountServiceError" as const
  override readonly cause?: unknown

  constructor(props: { message: string; cause?: unknown }) {
    super(props.message)
    this.name = "AccountServiceError"
    this.cause = props.cause
  }
}

export type AccountError = AccountRepoError | AccountServiceError

// ── Poll result types (tagged union) ──────────────────────────────────

export class PollSuccess {
  readonly _tag = "PollSuccess" as const
  readonly email: string

  constructor(props: { email: string }) {
    this.email = props.email
  }
}

export class PollPending {
  readonly _tag = "PollPending" as const
}

export class PollSlow {
  readonly _tag = "PollSlow" as const
}

export class PollExpired {
  readonly _tag = "PollExpired" as const
}

export class PollDenied {
  readonly _tag = "PollDenied" as const
}

export class PollError {
  readonly _tag = "PollError" as const
  readonly cause: unknown

  constructor(props: { cause: unknown }) {
    this.cause = props.cause
  }
}

export type PollResult = PollSuccess | PollPending | PollSlow | PollExpired | PollDenied | PollError
