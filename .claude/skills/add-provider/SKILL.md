---
name: add-provider
description: Add a new LLM provider to LibreCode. Guides through creating the auth plugin, loader, model discovery, and UI integration following the standard provider template pattern. Use when adding support for a new LLM backend (cloud API, local server like Ollama/vLLM/llama.cpp, or OAuth service).
argument-hint: [provider-name]
allowed-tools: Bash(bun test *) Read Grep Edit Write
---

# Add Provider: $ARGUMENTS

You are adding a new LLM provider called **$ARGUMENTS** to LibreCode.

## Step 1: Determine Provider Type

Read the provider guide for context:
- `docs/providers.md` — Full guide with templates
- `docs/adr/004-provider-auth-prompts.md` — Design decision for auth prompts

Ask yourself: what kind of provider is this?

| Type | When to use | Template |
|------|------------|---------|
| **Local Server** | Runs on localhost, has /v1/models endpoint | Template B (prompts + discovery) |
| **Cloud API Key** | Remote API, just needs an API key | Template A (simple API key) |
| **Cloud OAuth** | Requires browser-based login | Template C (OAuth flow) |

## Step 2: Read Reference Implementations

Before writing any code, read these files to understand the patterns:

**For local servers (most common case):**
```
packages/librecode/src/plugin/litellm.ts
```

**For OAuth providers:**
```
packages/librecode/src/plugin/codex.ts
```

**For the type definitions:**
```
packages/plugin/src/index.ts  (AuthHook, PluginInput, Hooks)
```

## Step 3: Create the Plugin File

Create `packages/librecode/src/plugin/$ARGUMENTS.ts`

### For Local Servers (LiteLLM-style)

The plugin MUST include:
1. **`prompts`** — At minimum: Server URL field. API Key if the server supports it.
2. **`authorize`** — Validates the connection by fetching models BEFORE saving credentials.
3. **`loader`** — Discovers models and registers them with the provider.

Key implementation details:
- Use `AbortController` with a 5-second timeout for all fetch calls
- Parse stored credentials from the key (format: `url|apiKey`)
- Fall back to environment variables (e.g., `OLLAMA_BASE_URL`)
- Log discovery results using `Log.create({ service: "plugin.$ARGUMENTS" })`
- Each discovered model needs a full model definition (see litellm.ts for the shape)

### For Cloud API Providers

Simple case — just needs a loader that returns `{ apiKey }`.

### For OAuth Providers

Follow the codex.ts pattern — implement the full OAuth flow with `authorize()` returning a URL and callback.

## Step 4: Register the Plugin

Edit `packages/librecode/src/plugin/index.ts`:

1. Add the import at the top
2. Add to the `INTERNAL_PLUGINS` array

## Step 5: Ensure Provider Appears in List

Edit `packages/librecode/src/server/routes/provider.ts`:

In the provider list route handler, add an injection block (like the existing LiteLLM block) so the provider appears even before authentication:

```typescript
if (!allProviders["$ARGUMENTS"]) {
  allProviders["$ARGUMENTS"] = {
    id: "$ARGUMENTS",
    name: "Provider Display Name",
    api: "http://localhost:PORT/v1",
    npm: "@ai-sdk/openai-compatible",
    env: [],
    models: {},
  }
}
```

## Step 6: Write Tests

Create `packages/librecode/test/plugin/$ARGUMENTS.test.ts`:

Test that:
- Plugin returns valid Hooks with auth defined
- Provider ID is correct
- Methods array has the right type and prompts
- Authorize function returns success for valid connections
- Authorize function returns failed for invalid connections
- Loader parses stored credentials correctly

## Step 7: Verify

Run these commands and ensure they all pass:

```bash
bun test --timeout 30000          # All tests pass
bun run typecheck                 # No type errors
```

## Coding Standards (from CLAUDE.md)

- No semicolons
- 120 char line width
- Named exports only (no `export default`)
- Explicit return types on exported functions
- No `any` in new code (use `unknown` + narrowing)
- Max cyclomatic complexity: 12 per function
- Max function length: 60 lines
- Max file length: 1000 lines
