# ADR-004: Provider Auth Prompts Extension

**Status:** Accepted
**Date:** 2026-04-10
**Decision:** Extend the provider auth Method type with `prompts` to support providers that need more than a single API key

---

## Context

LibreCode's provider auth system inherited from opencode supports two method types:

- `"api"` — renders a single API key text field
- `"oauth"` — browser-based or device code authorization flow

This works for cloud providers (Anthropic, OpenAI, etc.) but fails for local model
servers like LiteLLM, Ollama, vLLM, and llama.cpp which need:

- **Server URL** (not just an API key)
- **Connection validation** before saving credentials
- **Model discovery** from the running server
- **Optional API key** (some local servers don't require one)

The `@librecode/plugin` package already defined a `prompts` field on auth methods
(text and select input types), but it was never serialized through the pipeline:

| Layer                                        | Had prompts?                        |
| -------------------------------------------- | ----------------------------------- |
| Plugin type definition (`@librecode/plugin`) | Yes (optional field)                |
| Auth service `methods()`                     | No (stripped to `type` + `label`)   |
| Server route `/provider/auth`                | No (Method schema had no prompts)   |
| SDK types                                    | No                                  |
| Frontend `DialogConnectProvider`             | No (hardcoded single API key field) |

## Problem

No way to add a local model server as a proper provider. The only options were:

1. Build a separate wizard component (breaks the provider pattern)
2. Force everything into a single API key field (loses URL configuration)
3. Use env vars only (no UI, bad UX)

## Decision

### 1. Extend the Method Zod schema

Added `prompts` array and `MethodPrompt` discriminated union to `auth-service.ts`:

```typescript
const MethodPrompt = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), key: z.string(), message: z.string(), placeholder: z.string().optional() }),
  z.object({ type: z.literal("select"), key: z.string(), message: z.string(), options: z.array(...) }),
])

const Method = z.object({
  type: z.union([z.literal("oauth"), z.literal("api")]),
  label: z.string(),
  prompts: z.array(MethodPrompt).optional(),
})
```

### 2. Pass prompts through the pipeline

- `ProviderAuthService.methods()` now serializes prompts from plugin definitions
- SDK `ProviderAuthMethod` type includes optional `prompts` array
- `ProviderAuthMethodPrompt` type added to SDK

### 3. Add custom authorize support for API methods

- New server route: `POST /provider/:providerID/api/authorize`
- Accepts `{ key, inputs }` where inputs is the collected prompt values
- Routes through the plugin's `authorize` function when present
- Plugin authorize validates the connection before saving credentials

### 4. Dynamic prompt rendering in DialogConnectProvider

- `ApiAuthView` checks `method().prompts`
- If prompts exist: renders text/select fields from the prompts array
- If no prompts: renders the default single API key field (backward compatible)
- Submits to the new api/authorize route when prompts are present

### 5. LiteLLM as reference implementation

```typescript
methods: [
  {
    label: "Connect to LiteLLM Server",
    type: "api",
    prompts: [
      { type: "text", key: "url", message: "Server URL", placeholder: "http://localhost:4000" },
      { type: "text", key: "apiKey", message: "API Key (optional)", placeholder: "sk-..." },
    ],
    async authorize(inputs) {
      const models = await fetchModelsFromUrl(inputs.url, inputs.apiKey)
      if (models.length === 0) return { type: "failed" }
      return { type: "success", key: `${inputs.url}|${inputs.apiKey}` }
    },
  },
]
```

## Files Modified

| File                                                      | Change                                                                  |
| --------------------------------------------------------- | ----------------------------------------------------------------------- |
| `packages/librecode/src/provider/auth-service.ts`         | Extended Method schema, added MethodPrompt, updated methods() and api() |
| `packages/librecode/src/provider/auth.ts`                 | Updated api() facade to accept inputs                                   |
| `packages/librecode/src/server/routes/provider.ts`        | Added api/authorize route                                               |
| `packages/sdk/openapi.json`                               | Added ProviderAuthMethodPrompt schema                                   |
| `packages/sdk/js/src/v2/gen/types.gen.ts`                 | Added ProviderAuthMethodPrompt type                                     |
| `packages/sdk/js/src/gen/types.gen.ts`                    | Added ProviderAuthMethodPrompt type                                     |
| `packages/librecode/src/plugin/litellm.ts`                | Rewrote with prompts + authorize                                        |
| `packages/app/src/components/dialog-connect-provider.tsx` | Dynamic prompt rendering                                                |

## Consequences

### Positive

- Any provider can now define custom input fields through the standard plugin system
- Local model servers (LiteLLM, Ollama, vLLM) can be first-class providers
- Connection validation happens before credentials are saved
- The UI renders dynamically from plugin definitions (no per-provider UI code)
- Fully backward compatible: providers without prompts work exactly as before

### Negative

- Plugin `authorize` functions run server-side, meaning the connection check happens
  from the LibreCode server process (not the browser) — this is correct for local
  servers but may need adjustment for remote scenarios
- The `key` field is overloaded to store `url|apiKey` for LiteLLM — future work could
  add structured credential storage

### Future Work

- Add `"scan"` prompt type for network discovery (scan ports for servers)
- Add structured credential storage (separate URL from API key)
- Add model capability detection during discovery
- Support Ollama, vLLM, llama.cpp using the same pattern
