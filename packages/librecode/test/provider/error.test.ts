import { describe, expect, test } from "bun:test"
import { ProviderError } from "../../src/provider/error"
import type { APICallError } from "ai"

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeAPICallError(overrides: Partial<APICallError>): APICallError {
  return {
    name: "AI_APICallError",
    message: overrides.message ?? "test error",
    statusCode: overrides.statusCode,
    responseBody: overrides.responseBody,
    responseHeaders: overrides.responseHeaders,
    isRetryable: overrides.isRetryable ?? false,
    url: overrides.url,
    requestBodyValues: overrides.requestBodyValues ?? {},
    cause: overrides.cause,
  } as APICallError
}

// ─── parseStreamError ─────────────────────────────────────────────────────────

describe("ProviderError.parseStreamError", () => {
  test("returns undefined for non-object input", () => {
    expect(ProviderError.parseStreamError("not json")).toBeUndefined()
    expect(ProviderError.parseStreamError(null)).toBeUndefined()
    expect(ProviderError.parseStreamError(42)).toBeUndefined()
  })

  test("returns undefined for object without type=error", () => {
    expect(ProviderError.parseStreamError({ type: "other" })).toBeUndefined()
  })

  test("returns undefined for object with type=error but no matching error code", () => {
    const input = { type: "error", error: { code: "unknown_code" } }
    expect(ProviderError.parseStreamError(input)).toBeUndefined()
  })

  test("returns undefined for invalid JSON string", () => {
    expect(ProviderError.parseStreamError("{not valid json")).toBeUndefined()
  })

  test("context_length_exceeded returns context_overflow", () => {
    const input = { type: "error", error: { code: "context_length_exceeded" } }
    const result = ProviderError.parseStreamError(input)
    expect(result?.type).toBe("context_overflow")
    expect(result?.message).toContain("context window")
  })

  test("insufficient_quota returns api_error with isRetryable=false", () => {
    const input = { type: "error", error: { code: "insufficient_quota" } }
    const result = ProviderError.parseStreamError(input)
    expect(result?.type).toBe("api_error")
    if (result?.type === "api_error") {
      expect(result.isRetryable).toBe(false)
      expect(result.message).toContain("Quota")
    }
  })

  test("usage_not_included returns api_error with Plus upgrade message", () => {
    const input = { type: "error", error: { code: "usage_not_included" } }
    const result = ProviderError.parseStreamError(input)
    expect(result?.type).toBe("api_error")
    if (result?.type === "api_error") {
      expect(result.message).toContain("Plus")
    }
  })

  test("invalid_prompt returns api_error with error message from body", () => {
    const input = { type: "error", error: { code: "invalid_prompt", message: "Your prompt is invalid" } }
    const result = ProviderError.parseStreamError(input)
    expect(result?.type).toBe("api_error")
    if (result?.type === "api_error") {
      expect(result.message).toBe("Your prompt is invalid")
    }
  })

  test("invalid_prompt falls back to default message when no message field", () => {
    const input = { type: "error", error: { code: "invalid_prompt" } }
    const result = ProviderError.parseStreamError(input)
    expect(result?.type).toBe("api_error")
    if (result?.type === "api_error") {
      expect(result.message).toBe("Invalid prompt.")
    }
  })

  test("parses from a JSON string input", () => {
    const input = JSON.stringify({ type: "error", error: { code: "context_length_exceeded" } })
    const result = ProviderError.parseStreamError(input)
    expect(result?.type).toBe("context_overflow")
  })
})

// ─── parseAPICallError ────────────────────────────────────────────────────────

describe("ProviderError.parseAPICallError", () => {
  test("overflow keyword in message produces context_overflow", () => {
    const e = makeAPICallError({ message: "prompt is too long for this model" })
    const result = ProviderError.parseAPICallError({ providerID: "anthropic" as never, error: e })
    expect(result.type).toBe("context_overflow")
  })

  test("status 413 always produces context_overflow", () => {
    const e = makeAPICallError({ message: "some error", statusCode: 413 })
    const result = ProviderError.parseAPICallError({ providerID: "anthropic" as never, error: e })
    expect(result.type).toBe("context_overflow")
  })

  test("normal error produces api_error with message", () => {
    const e = makeAPICallError({ message: "something went wrong", statusCode: 500 })
    const result = ProviderError.parseAPICallError({ providerID: "anthropic" as never, error: e })
    expect(result.type).toBe("api_error")
    if (result.type === "api_error") {
      expect(result.message).toBe("something went wrong")
      expect(result.statusCode).toBe(500)
    }
  })

  test("openai provider 404 is retryable", () => {
    const e = makeAPICallError({ message: "not found", statusCode: 404, isRetryable: false })
    const result = ProviderError.parseAPICallError({ providerID: "openai" as never, error: e })
    expect(result.type).toBe("api_error")
    if (result.type === "api_error") {
      expect(result.isRetryable).toBe(true)
    }
  })

  test("non-openai provider uses isRetryable from error", () => {
    const e = makeAPICallError({ message: "server error", statusCode: 500, isRetryable: true })
    const result = ProviderError.parseAPICallError({ providerID: "anthropic" as never, error: e })
    expect(result.type).toBe("api_error")
    if (result.type === "api_error") {
      expect(result.isRetryable).toBe(true)
    }
  })

  test("url is added to metadata when present", () => {
    const e = makeAPICallError({ message: "error", url: "https://api.example.com/v1/chat" })
    const result = ProviderError.parseAPICallError({ providerID: "anthropic" as never, error: e })
    expect(result.type).toBe("api_error")
    if (result.type === "api_error") {
      expect(result.metadata?.url).toBe("https://api.example.com/v1/chat")
    }
  })

  test("no url means metadata is undefined", () => {
    const e = makeAPICallError({ message: "error" })
    const result = ProviderError.parseAPICallError({ providerID: "anthropic" as never, error: e })
    if (result.type === "api_error") {
      expect(result.metadata).toBeUndefined()
    }
  })

  test("empty message falls back to responseBody", () => {
    const e = makeAPICallError({ message: "", responseBody: "Rate limit exceeded" })
    const result = ProviderError.parseAPICallError({ providerID: "anthropic" as never, error: e })
    if (result.type === "api_error") {
      expect(result.message).toBe("Rate limit exceeded")
    }
  })

  test("empty message with statusCode falls back to HTTP status text", () => {
    const e = makeAPICallError({ message: "", statusCode: 429 })
    const result = ProviderError.parseAPICallError({ providerID: "anthropic" as never, error: e })
    if (result.type === "api_error") {
      expect(result.message).toContain("Too Many Requests")
    }
  })

  test("empty message with no body or statusCode returns 'Unknown error'", () => {
    const e = makeAPICallError({ message: "" })
    const result = ProviderError.parseAPICallError({ providerID: "anthropic" as never, error: e })
    if (result.type === "api_error") {
      expect(result.message).toBe("Unknown error")
    }
  })

  test("response body JSON error message is extracted", () => {
    const e = makeAPICallError({
      message: "Bad Request",
      responseBody: JSON.stringify({ message: "Token limit exceeded" }),
    })
    const result = ProviderError.parseAPICallError({ providerID: "anthropic" as never, error: e })
    if (result.type === "api_error") {
      expect(result.message).toContain("Token limit exceeded")
    }
  })

  test("HTML response body with 401 returns unauthorized message", () => {
    const e = makeAPICallError({
      message: "Unauthorized",
      statusCode: 401,
      responseBody: "<!doctype html><html>...</html>",
    })
    const result = ProviderError.parseAPICallError({ providerID: "anthropic" as never, error: e })
    if (result.type === "api_error") {
      expect(result.message).toContain("Unauthorized")
      expect(result.message).toContain("authentication")
    }
  })

  test("HTML response body with 403 returns forbidden message", () => {
    const e = makeAPICallError({
      message: "Forbidden",
      statusCode: 403,
      responseBody: "<html>...</html>",
    })
    const result = ProviderError.parseAPICallError({ providerID: "anthropic" as never, error: e })
    if (result.type === "api_error") {
      expect(result.message).toContain("Forbidden")
    }
  })

  test("all overflow patterns match correctly", () => {
    const overflowMessages = [
      "input is too long for requested model",
      "exceeds the context window",
      "Input token count 9999 exceeds the maximum",
      "maximum prompt length is 128000",
      "reduce the length of the messages",
      "maximum context length is 4096 tokens",
      "exceeds the limit of 4096",
      "exceeds the available context size",
      "greater than the context length",
      "context window exceeds limit",
      "exceeded model token limit",
      "context_length_exceeded",
    ]
    for (const msg of overflowMessages) {
      const e = makeAPICallError({ message: msg })
      const result = ProviderError.parseAPICallError({ providerID: "anthropic" as never, error: e })
      expect(result.type).toBe("context_overflow")
    }
  })

  test("Cerebras/Mistral 400 no body pattern triggers overflow", () => {
    const e = makeAPICallError({ message: "400 (no body)" })
    const result = ProviderError.parseAPICallError({ providerID: "anthropic" as never, error: e })
    expect(result.type).toBe("context_overflow")
  })

  test("Cerebras/Mistral 413 no body pattern triggers overflow", () => {
    const e = makeAPICallError({ message: "413 status code (no body)" })
    const result = ProviderError.parseAPICallError({ providerID: "anthropic" as never, error: e })
    expect(result.type).toBe("context_overflow")
  })
})
