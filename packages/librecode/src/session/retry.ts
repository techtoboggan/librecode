import type { NamedError } from "@librecode/util/error"
import { MessageV2 } from "./message-v2"
import { iife } from "@/util/iife"

export namespace SessionRetry {
  export const RETRY_INITIAL_DELAY = 2000
  export const RETRY_BACKOFF_FACTOR = 2
  export const RETRY_MAX_DELAY_NO_HEADERS = 30_000 // 30 seconds
  export const RETRY_MAX_DELAY = 2_147_483_647 // max 32-bit signed integer for setTimeout

  export async function sleep(ms: number, signal: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      const abortHandler = () => {
        clearTimeout(timeout)
        reject(new DOMException("Aborted", "AbortError"))
      }
      const timeout = setTimeout(
        () => {
          signal.removeEventListener("abort", abortHandler)
          resolve()
        },
        Math.min(ms, RETRY_MAX_DELAY),
      )
      signal.addEventListener("abort", abortHandler, { once: true })
    })
  }

  function delayFromRetryAfterMs(value: string): number | undefined {
    const parsed = Number.parseFloat(value)
    return Number.isNaN(parsed) ? undefined : parsed
  }

  function delayFromRetryAfter(value: string): number | undefined {
    const parsedSeconds = Number.parseFloat(value)
    if (!Number.isNaN(parsedSeconds)) return Math.ceil(parsedSeconds * 1000)
    const parsed = Date.parse(value) - Date.now()
    if (!Number.isNaN(parsed) && parsed > 0) return Math.ceil(parsed)
    return undefined
  }

  function delayFromHeaders(headers: Record<string, string>, attempt: number): number {
    const retryAfterMs = headers["retry-after-ms"]
    if (retryAfterMs) {
      const ms = delayFromRetryAfterMs(retryAfterMs)
      if (ms !== undefined) return ms
    }

    const retryAfter = headers["retry-after"]
    if (retryAfter) {
      const ms = delayFromRetryAfter(retryAfter)
      if (ms !== undefined) return ms
    }

    return RETRY_INITIAL_DELAY * Math.pow(RETRY_BACKOFF_FACTOR, attempt - 1)
  }

  export function delay(attempt: number, error?: MessageV2.APIError): number {
    if (error) {
      const headers = error.data.responseHeaders
      if (headers) return delayFromHeaders(headers, attempt)
    }
    return Math.min(RETRY_INITIAL_DELAY * Math.pow(RETRY_BACKOFF_FACTOR, attempt - 1), RETRY_MAX_DELAY_NO_HEADERS)
  }

  function parseErrorJson(error: ReturnType<NamedError["toObject"]>): unknown {
    return iife(() => {
      try {
        if (typeof error.data?.message === "string") {
          return JSON.parse(error.data.message)
        }
        return JSON.parse(error.data.message)
      } catch {
        return undefined
      }
    })
  }

  function retryableFromJson(json: unknown): string | undefined {
    if (!json || typeof json !== "object") return undefined
    const obj = json as Record<string, unknown>
    const code = typeof obj.code === "string" ? obj.code : ""

    if (obj.type === "error" && (obj.error as Record<string, unknown>)?.type === "too_many_requests") {
      return "Too Many Requests"
    }
    if (code.includes("exhausted") || code.includes("unavailable")) {
      return "Provider is overloaded"
    }
    if (obj.type === "error" && ((obj.error as Record<string, unknown>)?.code as string)?.includes("rate_limit")) {
      return "Rate Limited"
    }
    return JSON.stringify(json)
  }

  export function retryable(error: ReturnType<NamedError["toObject"]>): string | undefined {
    // context overflow errors should not be retried
    if (MessageV2.ContextOverflowError.isInstance(error)) return undefined
    if (MessageV2.APIError.isInstance(error)) {
      if (!error.data.isRetryable) return undefined
      if (error.data.responseBody?.includes("FreeUsageLimitError"))
        return `Free usage exceeded. Configure a provider API key to continue.`
      return error.data.message.includes("Overloaded") ? "Provider is overloaded" : error.data.message
    }

    const json = parseErrorJson(error)
    try {
      return retryableFromJson(json)
    } catch {
      return undefined
    }
  }
}
