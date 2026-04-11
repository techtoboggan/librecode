import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core"

/**
 * Stores structured credentials for providers that need both a URL and an API key
 * (e.g. LiteLLM, Ollama, vLLM). Replaces the `url|key` pipe-encoding hack in auth.json.
 *
 * auth.json is still used for OAuth tokens (Codex, Copilot) and simple API keys
 * (Anthropic, OpenAI, etc.) — those don't need URL configuration.
 */
export const ProviderCredentialsTable = sqliteTable("provider_credentials", {
  provider_id: text().primaryKey(),
  url: text(),
  api_key: text(),
  metadata: text().default("{}").notNull(),
  time_created: integer()
    .notNull()
    .$default(() => Date.now()),
  time_updated: integer()
    .notNull()
    .$default(() => Date.now()),
})
