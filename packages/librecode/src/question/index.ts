/**
 * Question module — public API.
 *
 * Migrated from Effect facade to direct re-exports per ADR-001.
 * The service functions are now plain async — no runtime.runPromise() needed.
 */

import * as S from "./service"

export type QuestionOption = S.Option
export type QuestionInfo = S.Info
export type QuestionRequest = S.Request
export type QuestionAnswer = S.Answer
export type QuestionReply = S.Reply

export const Question = {
  Option: S.Option,
  Info: S.Info,
  Request: S.Request,
  Answer: S.Answer,
  Reply: S.Reply,
  Event: S.Event,
  RejectedError: S.RejectedError,
  ask: S.ask,
  reply: S.reply,
  reject: S.reject,
  list: S.list,
} as const
