import { describe, expect, test } from "bun:test"
import { redactSecrets, redactSecretsInString } from "../../src/util/redact.ts"

// A02 / A09 — Scrub obvious secrets from log payloads before they hit
// disk. Tokens/keys/passwords that make it into log files are usually
// there by accident (an entire response object logged; a config dump;
// an error object with headers). This redaction is the second line of
// defense after explicit '[REDACTED]' at the call site.

describe("redactSecretsInString", () => {
  test("redacts GitHub personal access tokens", () => {
    expect(redactSecretsInString("Bearer ghp_abc123def456ghi789jkl012mno345pqr6")).toBe(
      "Bearer [REDACTED:github-token]",
    )
  })

  test("redacts OpenAI-style sk- keys", () => {
    expect(redactSecretsInString("Authorization: Bearer sk-abc123def456ghi789jkl012mno345pqr678stu90vwx")).toBe(
      "Authorization: Bearer [REDACTED:api-key]",
    )
  })

  test("redacts AWS access key IDs", () => {
    expect(redactSecretsInString("aws_access_key_id: AKIAIOSFODNN7EXAMPLE")).toBe(
      "aws_access_key_id: [REDACTED:aws-key]",
    )
  })

  test("redacts JWT tokens", () => {
    const jwt = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1c2VyIn0.signature-part-here-xxx"
    expect(redactSecretsInString(`token=${jwt}`)).toBe("token=[REDACTED:jwt]")
  })

  test("leaves non-secret text alone", () => {
    expect(redactSecretsInString("just a regular log message")).toBe("just a regular log message")
    expect(redactSecretsInString("path=/home/alice/project/src/index.ts")).toBe(
      "path=/home/alice/project/src/index.ts",
    )
  })

  test("redacts multiple secrets in one string", () => {
    const input = "header: Bearer ghp_abc123def456ghi789jkl012mno345pqr6 and sk-abc123def456ghi789jkl012mno345pqr678stu90vwx"
    const out = redactSecretsInString(input)
    expect(out).toContain("[REDACTED:github-token]")
    expect(out).toContain("[REDACTED:api-key]")
    expect(out).not.toContain("ghp_")
    expect(out).not.toContain("sk-abc")
  })
})

describe("redactSecrets (object walker)", () => {
  test("redacts values whose key name matches the secret pattern", () => {
    const input = {
      service: "provider.anthropic",
      api_key: "sk-real-key-value",
      authorization: "Bearer secret-xxx",
      refreshToken: "ya29.abc",
      username: "alice", // not redacted — not a secret keyname
    }
    const out = redactSecrets(input)
    expect(out.api_key).toBe("[REDACTED:secret-key]")
    expect(out.authorization).toBe("[REDACTED:secret-key]")
    expect(out.refreshToken).toBe("[REDACTED:secret-key]")
    // non-secret fields survive
    expect(out.service).toBe("provider.anthropic")
    expect(out.username).toBe("alice")
  })

  test("recurses into nested objects", () => {
    const input = {
      config: {
        provider: {
          apiKey: "secret",
          name: "anthropic",
        },
      },
    }
    const out = redactSecrets(input)
    expect((out.config as { provider: { apiKey: string; name: string } }).provider.apiKey).toBe(
      "[REDACTED:secret-key]",
    )
    expect((out.config as { provider: { apiKey: string; name: string } }).provider.name).toBe("anthropic")
  })

  test("walks arrays — key-name redaction applies to elements with matching key", () => {
    const input = {
      // Array of objects where each element has a 'token' key directly
      items: [{ id: 1, token: "should-be-redacted" }],
    }
    const out = redactSecrets(input)
    const item = (out.items as Array<{ id: number; token: string }>)[0]
    expect(item.token).toBe("[REDACTED:secret-key]")
    expect(item.id).toBe(1)
  })

  test("walks arrays — value-pattern redaction applies to string items", () => {
    const input = {
      log: ["user 123", "Bearer ghp_abcdefghijklmnopqrstuvwxyz0123456789", "done"],
    }
    const out = redactSecrets(input)
    const log = out.log as string[]
    expect(log[0]).toBe("user 123")
    expect(log[1]).toContain("[REDACTED:github-token]")
    expect(log[2]).toBe("done")
  })

  test("still scrubs string values that contain obvious secret patterns", () => {
    const input = { message: "failed with token ghp_abc123def456ghi789jkl012mno345pqr6" }
    const out = redactSecrets(input)
    expect(out.message).toContain("[REDACTED:github-token]")
    expect(out.message).not.toContain("ghp_")
  })

  test("handles circular references without hanging", () => {
    const input: Record<string, unknown> = { name: "alice" }
    input.self = input
    const out = redactSecrets(input)
    expect(out.name).toBe("alice")
    // self-reference preserved or replaced with marker — either is fine
    expect(out.self).toBeDefined()
  })

  test("passes through primitives", () => {
    expect(redactSecrets(null as unknown as Record<string, unknown>)).toEqual({})
    expect(redactSecrets(undefined as unknown as Record<string, unknown>)).toEqual({})
  })
})
