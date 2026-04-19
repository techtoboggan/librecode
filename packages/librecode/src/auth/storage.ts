import path from "node:path"
import { Global } from "../global"
import { Log } from "../util/log"

// A02 (Cryptographic Failures) — OAuth refresh tokens, API keys, and
// enterprise tokens were stored in plaintext at $DATA/auth.json (0600).
// Good enough for single-user POSIX, but offers zero protection against
// prompt-injected agents, malware-in-userland, or backup exfiltration.
//
// This module picks an OS-native credential store when available:
//   * macOS:   Keychain (via @napi-rs/keyring → Security.framework)
//   * Windows: Credential Manager (via Wincred API)
//   * Linux:   Secret Service (GNOME Keyring, KWallet, …)
//
// On Linux where no Secret Service is running (headless server, minimal
// desktop without a keyring daemon, WSL), the keyring init fails and we
// fall back to FileAuthStorage with a single WARN log. The finding is
// escalated not closed in that case.

const log = Log.create({ service: "auth.storage" })

const KEYCHAIN_SERVICE = "librecode"
const KEYCHAIN_ACCOUNT = "auth-store"

/** Interface — all storage backends serialise the full record as a blob. */
export interface AuthStorage {
  /** Human-readable backend name for logs/diagnostics. */
  readonly kind: "keychain" | "file"
  /** Read the full record. Returns {} if nothing is stored. */
  read(): Promise<Record<string, unknown>>
  /** Write the full record atomically. */
  write(data: Record<string, unknown>): Promise<void>
}

/** File-based storage — the pre-29e default, kept as a fallback. */
class FileAuthStorage implements AuthStorage {
  readonly kind = "file" as const
  private readonly path = path.join(Global.Path.data, "auth.json")

  async read(): Promise<Record<string, unknown>> {
    const { Filesystem } = await import("../util/filesystem")
    try {
      return await Filesystem.readJson<Record<string, unknown>>(this.path)
    } catch {
      return {}
    }
  }

  async write(data: Record<string, unknown>): Promise<void> {
    const { Filesystem } = await import("../util/filesystem")
    await Filesystem.writeJson(this.path, data, 0o600)
  }
}

/** OS keychain-backed storage. Single entry holds the serialised record. */
class KeychainAuthStorage implements AuthStorage {
  readonly kind = "keychain" as const
  constructor(private readonly entry: KeyringEntryHandle) {}

  async read(): Promise<Record<string, unknown>> {
    try {
      const json = this.entry.get()
      if (!json) return {}
      return JSON.parse(json) as Record<string, unknown>
    } catch (err) {
      log.warn("keychain read failed, returning empty", { error: String(err) })
      return {}
    }
  }

  async write(data: Record<string, unknown>): Promise<void> {
    this.entry.set(JSON.stringify(data))
  }
}

/** Thin type over what the @napi-rs/keyring Entry exposes. */
interface KeyringEntryHandle {
  get(): string | null
  set(value: string): void
  delete(): void
}

/**
 * Probe: is the OS keychain usable? Reads/writes a test entry so that
 * Linux systems without libsecret or a running Secret Service fail this
 * check rather than erroring on first auth write.
 */
async function probeKeychain(): Promise<KeyringEntryHandle | undefined> {
  try {
    const { Entry } = await import("@napi-rs/keyring")
    const probe = new Entry(KEYCHAIN_SERVICE, `probe-${Date.now()}`)
    probe.setPassword("probe")
    const got = probe.getPassword()
    if (got !== "probe") return undefined
    probe.deletePassword()
    // Real handle we'll use for the actual store
    const entry = new Entry(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT)
    return {
      get: () => {
        try {
          return entry.getPassword() ?? null
        } catch {
          return null
        }
      },
      set: (value: string) => entry.setPassword(value),
      delete: () => {
        try {
          entry.deletePassword()
        } catch {
          /* nothing to delete is fine */
        }
      },
    }
  } catch (err) {
    log.warn("keychain not available, falling back to file storage", { error: String(err) })
    return undefined
  }
}

/**
 * Factory: select the best available storage and migrate from file if
 * a legacy auth.json exists and the keychain is usable.
 */
export async function createAuthStorage(): Promise<AuthStorage> {
  // Test override — tests set LIBRECODE_AUTH_STORAGE=file|keychain to pin.
  const override = process.env.LIBRECODE_AUTH_STORAGE
  if (override === "file") return new FileAuthStorage()
  // Check for keychain
  const handle = override === "keychain" ? await forceKeychainHandle() : await probeKeychain()
  if (!handle) return new FileAuthStorage()
  const keychain = new KeychainAuthStorage(handle)
  // Migration: if an auth.json exists, move it into the keychain then
  // back up and remove the file. Only runs once per machine.
  await migrateFileToKeychain(keychain).catch((err) => {
    log.warn("auth migration to keychain failed; keeping file on disk", { error: String(err) })
  })
  return keychain
}

async function forceKeychainHandle(): Promise<KeyringEntryHandle | undefined> {
  const { Entry } = await import("@napi-rs/keyring")
  const entry = new Entry(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT)
  return {
    get: () => {
      try {
        return entry.getPassword() ?? null
      } catch {
        return null
      }
    },
    set: (value) => entry.setPassword(value),
    delete: () => {
      try {
        entry.deletePassword()
      } catch {
        /* ignore */
      }
    },
  }
}

async function migrateFileToKeychain(keychain: KeychainAuthStorage): Promise<void> {
  const fs = await import("node:fs/promises")
  const filePath = path.join(Global.Path.data, "auth.json")
  let content: string
  try {
    content = await fs.readFile(filePath, "utf8")
  } catch {
    return // no file to migrate
  }
  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(content)
  } catch {
    log.warn("auth.json is not valid JSON, skipping migration", {})
    return
  }
  // If keychain already has entries, do not clobber — user might have
  // migrated manually on another machine with the same keyring sync.
  const existing = await keychain.read()
  if (Object.keys(existing).length > 0) {
    log.info("keychain already populated, skipping auth.json migration", {})
    return
  }
  await keychain.write(parsed)
  // Back up the file (attacker may have read it but we stop future reads)
  const backup = `${filePath}.migrated.backup`
  try {
    await fs.rename(filePath, backup)
    log.info("migrated auth.json to OS keychain", { backup })
  } catch (err) {
    log.warn("keychain write succeeded but couldn't rename legacy file", { error: String(err) })
  }
}
