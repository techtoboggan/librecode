# Adding Providers to LibreCode

> How to add new LLM providers. See [ADR-004](/docs/adr/004-provider-auth-prompts.md)
> for the auth prompts design decision.

---

## Overview

LibreCode uses a **plugin-based provider system**. Each provider is an auth plugin that:

1. **Registers** itself with the plugin system (name, auth methods)
2. **Authenticates** the user (API key, OAuth, or custom flow with prompts)
3. **Loads** the provider (configures SDK, discovers models)

```
Plugin definition ──► AuthHook ──► DialogConnectProvider (UI)
                        │                   │
                        │              User fills prompts
                        │                   │
                        ▼                   ▼
                     loader() ◄──── authorize() validates
                        │
                        ▼
                  Models registered
```

### Provider Types

| Type             | Auth Method                    | Examples                        |
| ---------------- | ------------------------------ | ------------------------------- |
| **Cloud API**    | Simple API key                 | Anthropic, OpenRouter, Cerebras |
| **Cloud OAuth**  | Browser/device code            | OpenAI Codex, GitHub Copilot    |
| **Local Server** | URL + optional key + discovery | LiteLLM, Ollama, vLLM           |

---

## Quick Start Templates

### Template A: Simple API Key Provider

For cloud providers that just need an API key.

```typescript
// packages/librecode/src/plugin/my-provider.ts
import type { PluginInput, Hooks } from "@librecode/plugin"

export async function MyProviderAuthPlugin(_input: PluginInput): Promise<Hooks> {
  return {
    auth: {
      provider: "my-provider",
      async loader(getAuth, _provider) {
        const auth = await getAuth()
        const apiKey = auth.type === "api" ? auth.key : undefined
        if (!apiKey) return {}
        return { apiKey }
      },
      methods: [
        {
          label: "API Key",
          type: "api" as const,
        },
      ],
    },
  }
}
```

The UI renders a single API key text field. On submit, the key is stored and `loader()`
is called to configure the provider.

### Template B: Local Server with Discovery

For local model servers that need URL configuration and model discovery.

```typescript
// packages/librecode/src/plugin/my-local-provider.ts
import type { PluginInput, Hooks } from "@librecode/plugin"
import { Log } from "../util/log"

const log = Log.create({ service: "plugin.my-local-provider" })
const DEFAULT_URL = "http://localhost:11434"
const TIMEOUT_MS = 5000

async function fetchModels(baseURL: string, apiKey?: string): Promise<{ id: string }[]> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const headers: Record<string, string> = {}
    if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`
    const res = await fetch(`${baseURL}/v1/models`, { headers, signal: controller.signal })
    clearTimeout(timeout)
    if (!res.ok) return []
    const data = (await res.json()) as { data?: Array<{ id: string }> }
    return data.data ?? []
  } catch {
    return []
  }
}

export async function MyLocalProviderPlugin(_input: PluginInput): Promise<Hooks> {
  return {
    auth: {
      provider: "my-local-provider",

      // loader runs AFTER auth is saved — configure provider + discover models
      async loader(getAuth, provider) {
        const auth = await getAuth()
        let baseURL = DEFAULT_URL
        let apiKey: string | undefined

        // Parse stored credentials (url|apiKey format from authorize)
        if (auth.type === "api" && auth.key?.includes("|")) {
          const idx = auth.key.indexOf("|")
          baseURL = auth.key.substring(0, idx) || DEFAULT_URL
          apiKey = auth.key.substring(idx + 1) || undefined
        }

        if (!apiKey && !baseURL) return {}

        // Discover models
        const models = await fetchModels(baseURL, apiKey)
        for (const m of models) {
          if (!provider.models[m.id]) {
            provider.models[m.id] = {
              id: m.id as any,
              providerID: "my-local-provider" as any,
              name: m.id,
              api: { id: m.id, url: `${baseURL}/v1`, npm: "@ai-sdk/openai-compatible" },
              // ... full model definition (see litellm.ts for complete example)
            } as any
          }
        }

        return { apiKey, baseURL: `${baseURL}/v1` }
      },

      methods: [
        {
          label: "Connect to Server",
          type: "api" as const,
          // Prompts define the UI fields shown in DialogConnectProvider
          prompts: [
            {
              type: "text" as const,
              key: "url",
              message: "Server URL",
              placeholder: DEFAULT_URL,
            },
            {
              type: "text" as const,
              key: "apiKey",
              message: "API Key (optional)",
              placeholder: "sk-...",
            },
          ],
          // authorize validates the connection BEFORE saving credentials
          async authorize(inputs?: Record<string, string>) {
            const url = inputs?.url?.trim() || DEFAULT_URL
            const apiKey = inputs?.apiKey?.trim()

            const models = await fetchModels(url, apiKey)
            if (models.length === 0) {
              return { type: "failed" as const }
            }

            log.info("connected", { url, modelCount: models.length })
            return {
              type: "success" as const,
              key: `${url}|${apiKey ?? ""}`,
            }
          },
        },
      ],
    },
  }
}
```

The UI renders URL and API Key fields. On submit:

1. `authorize()` validates the connection by fetching models
2. If successful, credentials are saved
3. `loader()` runs and discovers all available models

### Template C: OAuth Provider

For cloud platforms requiring browser-based authorization.

```typescript
// packages/librecode/src/plugin/my-oauth-provider.ts
import type { PluginInput, Hooks } from "@librecode/plugin"

export async function MyOAuthPlugin(_input: PluginInput): Promise<Hooks> {
  return {
    auth: {
      provider: "my-oauth-provider",
      async loader(getAuth, _provider) {
        const auth = await getAuth()
        if (auth.type === "oauth") {
          return { apiKey: auth.access }
        }
        return {}
      },
      methods: [
        {
          label: "Sign in with Browser",
          type: "oauth" as const,
          async authorize() {
            // Start OAuth flow — return URL and callback
            const state = crypto.randomUUID()
            return {
              url: `https://provider.com/oauth?state=${state}`,
              instructions: "",
              method: "auto" as const,
              async callback() {
                // Poll or wait for callback, then return tokens
                return {
                  type: "success" as const,
                  refresh: "refresh_token",
                  access: "access_token",
                  expires: Date.now() + 3600000,
                }
              },
            }
          },
        },
        {
          label: "API Key",
          type: "api" as const,
        },
      ],
    },
  }
}
```

---

## Step-by-Step: Adding a Local Model Server

Using LiteLLM as the reference implementation.

### 1. Create the plugin file

```
packages/librecode/src/plugin/<provider-name>.ts
```

Follow Template B above. Key decisions:

- Default URL and port
- Whether API key is required or optional
- How to discover models (most use `/v1/models` OpenAI-compatible endpoint)
- Connection timeout (5000ms is a good default)

### 2. Register the plugin

In `packages/librecode/src/plugin/index.ts`, add to `INTERNAL_PLUGINS`:

```typescript
import { MyProviderPlugin } from "./my-provider"

const INTERNAL_PLUGINS: PluginInstance[] = [
  CodexAuthPlugin,
  CopilotAuthPlugin,
  LiteLLMAuthPlugin,
  MyProviderPlugin, // add here
]
```

### 3. Ensure provider appears in the list

In `packages/librecode/src/server/routes/provider.ts`, the provider list route
injects providers that aren't in the models.dev database. Add your provider:

```typescript
if (!allProviders["my-provider"]) {
  allProviders["my-provider"] = {
    id: "my-provider",
    name: "My Provider",
    api: "http://localhost:PORT/v1",
    npm: "@ai-sdk/openai-compatible",
    env: [],
    models: {},
  }
}
```

### 4. Write tests

Create `packages/librecode/test/plugin/<provider-name>.test.ts`:

```typescript
import { expect, test } from "bun:test"

test("provider plugin returns valid hooks", async () => {
  const { MyProviderPlugin } = await import("../../src/plugin/my-provider")
  const hooks = await MyProviderPlugin(mockInput)
  expect(hooks.auth).toBeDefined()
  expect(hooks.auth!.provider).toBe("my-provider")
  expect(hooks.auth!.methods).toHaveLength(1)
  expect(hooks.auth!.methods[0].type).toBe("api")
  expect(hooks.auth!.methods[0].prompts).toBeDefined()
})
```

### 5. Verify

```bash
bun test --timeout 30000          # All tests pass
bun run typecheck                 # No type errors
```

---

## Auth Method Reference

### Method Type: `"api"`

Simple API key authentication. Renders a text field in the UI.

| Field       | Type                           | Required | Description                      |
| ----------- | ------------------------------ | -------- | -------------------------------- |
| `type`      | `"api"`                        | Yes      | Method type                      |
| `label`     | `string`                       | Yes      | Display name in method selection |
| `prompts`   | `MethodPrompt[]`               | No       | Custom input fields (see below)  |
| `authorize` | `(inputs?) => Promise<Result>` | No       | Custom validation before saving  |

### Method Type: `"oauth"`

Browser-based OAuth flow. Opens a URL and waits for callback.

| Field       | Type                                    | Required | Description               |
| ----------- | --------------------------------------- | -------- | ------------------------- |
| `type`      | `"oauth"`                               | Yes      | Method type               |
| `label`     | `string`                                | Yes      | Display name              |
| `prompts`   | `MethodPrompt[]`                        | No       | Pre-auth input collection |
| `authorize` | `(inputs?) => Promise<AuthOuathResult>` | Yes      | Returns URL + callback    |

### Prompt Types

Prompts define custom input fields rendered in the connect dialog.

**Text prompt:**

```typescript
{ type: "text", key: "url", message: "Server URL", placeholder: "http://..." }
```

**Select prompt:**

```typescript
{
  type: "select",
  key: "region",
  message: "Region",
  options: [
    { label: "US East", value: "us-east-1" },
    { label: "EU West", value: "eu-west-1" },
  ]
}
```

### Authorize Function

Called when the user submits the form. Receives collected prompt values as `inputs`.

```typescript
async authorize(inputs?: Record<string, string>): Promise<
  | { type: "success"; key: string; provider?: string }
  | { type: "failed" }
>
```

- Return `{ type: "success", key }` to save credentials and complete
- Return `{ type: "failed" }` to show an error and let the user retry
- The `key` is stored in the auth system and passed to `loader()` via `getAuth()`

### Loader Function

Called after authentication succeeds. Configures the provider and discovers models.

```typescript
async loader(
  getAuth: () => Promise<Auth>,
  provider: Provider
): Promise<Record<string, any>>
```

- `getAuth()` returns the stored credentials
- `provider.models` can be mutated to add discovered models
- Return value becomes the provider's SDK options (`apiKey`, `baseURL`, etc.)

---

## Reference Implementations

| Provider    | File                    | Auth                                 | Key Features                                             |
| ----------- | ----------------------- | ------------------------------------ | -------------------------------------------------------- |
| **Codex**   | `src/plugin/codex.ts`   | OAuth (PKCE + device code) + API key | Token refresh, model filtering, custom fetch wrapper     |
| **Copilot** | `src/plugin/copilot.ts` | OAuth (device code)                  | GitHub Enterprise domain support, vision headers         |
| **LiteLLM** | `src/plugin/litellm.ts` | API + prompts                        | URL config, connection validation, model discovery       |
| **Ollama**  | `src/plugin/ollama.ts`  | API + prompts                        | URL config, `/v1/models` + `/api/tags` dual-format probe |

### Full pipeline for LiteLLM (local server):

```
1. User clicks "LiteLLM" in provider list
2. DialogConnectProvider renders prompts: [Server URL, API Key]
3. User fills fields, clicks Submit
4. POST /provider/litellm/api/authorize { key: "", inputs: { url, apiKey } }
5. Plugin authorize() fetches /v1/models from the URL
6. If models found → success, credentials saved as "url|apiKey"
7. loader() runs → parses url|apiKey → fetches models → registers them
8. Models appear in model selector
```

> **Note:** `LocalServerWizard` (formerly `LiteLLMWizard`) provides an alternate path with
> network auto-discovery, port scanning, and selective model import. It saves providers as
> `local-<sanitized-url>` entries directly in config. Both paths work — the wizard is for
> convenience, the auth plugin is for the standard connect flow.
