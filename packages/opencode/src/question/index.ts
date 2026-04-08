/**
 * Question module — public API.
 *
 * Migrated from Effect facade to direct re-exports per ADR-001.
 * The service functions are now plain async — no runtime.runPromise() needed.
 */

import * as S from "./service"

export namespace Question {
  export const Option = S.Option
  export type Option = S.Option
  export const Info = S.Info
  export type Info = S.Info
  export const Request = S.Request
  export type Request = S.Request
  export const Answer = S.Answer
  export type Answer = S.Answer
  export const Reply = S.Reply
  export type Reply = S.Reply
  export const Event = S.Event
  export const RejectedError = S.RejectedError

  export const ask = S.ask
  export const reply = S.reply
  export const reject = S.reject
  export const list = S.list
}
