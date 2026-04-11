import { Database, eq } from "../storage/db"
import { ProviderCredentialsTable } from "./credentials.sql"
import { Log } from "../util/log"

const log = Log.create({ service: "provider.credentials" })

export interface CredentialData {
  url: string | undefined
  apiKey: string | undefined
}

/**
 * Structured credential storage for local-server providers that need both a
 * URL and an optional API key (LiteLLM, Ollama, vLLM, etc.).
 *
 * This replaces the `url|key` pipe-encoding hack where both fields were jammed
 * into auth.json's single `key` string.
 */
export namespace ProviderCredentials {
  export function get(providerID: string): CredentialData | undefined {
    const row = Database.use((db) =>
      db.select().from(ProviderCredentialsTable).where(eq(ProviderCredentialsTable.provider_id, providerID)).get(),
    )
    if (!row) return undefined
    return {
      url: row.url ?? undefined,
      apiKey: row.api_key ?? undefined,
    }
  }

  export function set(providerID: string, data: CredentialData): void {
    log.info("storing structured credentials", { providerID, hasUrl: !!data.url, hasKey: !!data.apiKey })
    const now = Date.now()
    Database.use((db) =>
      db
        .insert(ProviderCredentialsTable)
        .values({
          provider_id: providerID,
          url: data.url ?? null,
          api_key: data.apiKey ?? null,
          time_created: now,
          time_updated: now,
        })
        .onConflictDoUpdate({
          target: ProviderCredentialsTable.provider_id,
          set: {
            url: data.url ?? null,
            api_key: data.apiKey ?? null,
            time_updated: now,
          },
        })
        .run(),
    )
  }

  export function remove(providerID: string): void {
    Database.use((db) =>
      db.delete(ProviderCredentialsTable).where(eq(ProviderCredentialsTable.provider_id, providerID)).run(),
    )
  }
}
