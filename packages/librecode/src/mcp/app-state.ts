/**
 * v0.9.63 — per-MCP-app persistent state store.
 *
 * MCP apps run in null-origin sandboxed iframes, so their own
 * `localStorage` / `IndexedDB` is scoped per-iframe-instance and
 * wiped on every reload. This module gives them a host-provided
 * key-value store that survives LibreCode restarts, backed by a JSON
 * file per (server, uri) pair at the path the user requested:
 *
 *   ~/.local/librecode-mcp-apps/<server-slug>/<uri-hash>.json
 *
 * Built-in apps use this to persist user preferences (e.g. the
 * "Tokens" card's selected view in session-stats). Third-party MCP
 * apps can opt in via the `mcp-app-state:load` / `mcp-app-state:save`
 * postMessage RPC wired in `packages/app/src/components/mcp-app-panel.tsx`.
 *
 * The store is intentionally file-system backed rather than sqlite
 * so users can poke at or reset individual apps' state manually
 * (the user's stated reason for choosing the `~/.local/...` path).
 */
import { createHash } from "node:crypto"
import { promises as fs } from "node:fs"
import os from "node:os"
import path from "node:path"
import { Log } from "../util/log"

const log = Log.create({ service: "mcp.app-state" })

/**
 * Maximum JSON size a single app may persist. 256 KiB is ample for
 * config blobs while still bounding disk growth from misbehaving
 * apps. A larger payload gets rejected with a structured error; the
 * caller keeps its previous state intact.
 */
export const MAX_STATE_BYTES = 256 * 1024

/** Root dir for all per-app state files. Override via env for tests. */
export function stateRoot(): string {
  if (process.env.LIBRECODE_MCP_APPS_STATE_DIR) return process.env.LIBRECODE_MCP_APPS_STATE_DIR
  return path.join(os.homedir(), ".local", "librecode-mcp-apps")
}

/**
 * Build a filesystem-safe key from (server, uri). Servers become a
 * slugged directory; the uri becomes a sha256-prefixed filename so
 * the raw uri (which may include `/`, `:`, URL-encoded chars, etc.)
 * can't escape the server's subtree.
 */
export function stateKey(server: string, uri: string): { dir: string; file: string } {
  const serverSlug = server.replace(/[^a-zA-Z0-9._-]/g, "-").slice(0, 64) || "unknown"
  const uriHash = createHash("sha256").update(uri).digest("hex").slice(0, 16)
  return { dir: serverSlug, file: `${uriHash}.json` }
}

function resolveStatePath(server: string, uri: string): string {
  const { dir, file } = stateKey(server, uri)
  return path.join(stateRoot(), dir, file)
}

/**
 * Load the state blob for (server, uri). Returns `undefined` when no
 * file exists or the content can't be parsed — never throws. Callers
 * treat missing state as "first run" and supply their own default.
 */
export async function loadState(server: string, uri: string): Promise<unknown> {
  const filePath = resolveStatePath(server, uri)
  try {
    const raw = await fs.readFile(filePath, "utf8")
    return JSON.parse(raw)
  } catch (err) {
    if (err && typeof err === "object" && "code" in err && (err as { code: string }).code === "ENOENT") {
      return undefined
    }
    log.warn("failed to load mcp-app state", { server, uri, error: String(err) })
    return undefined
  }
}

export type SaveResult = { ok: true } | { ok: false; reason: "too_large" | "io_error"; message: string }

/**
 * Persist the state blob. Enforces the size cap and serialises with
 * a 2-space indent so a developer snooping around the store files
 * can read them. `undefined` explicitly deletes the stored record.
 */
export async function saveState(server: string, uri: string, state: unknown): Promise<SaveResult> {
  if (state === undefined) {
    await clearState(server, uri)
    return { ok: true }
  }
  let serialised: string
  try {
    serialised = JSON.stringify(state, null, 2)
  } catch (err) {
    return { ok: false, reason: "io_error", message: `State is not JSON-serialisable: ${String(err)}` }
  }
  if (Buffer.byteLength(serialised, "utf8") > MAX_STATE_BYTES) {
    return {
      ok: false,
      reason: "too_large",
      message: `State exceeds ${MAX_STATE_BYTES}-byte cap (got ${Buffer.byteLength(serialised, "utf8")}). Trim the payload and try again.`,
    }
  }
  const filePath = resolveStatePath(server, uri)
  try {
    await fs.mkdir(path.dirname(filePath), { recursive: true })
    // Write atomically: write a sibling .tmp then rename. Protects
    // against partial writes when the host is killed mid-save.
    const tmp = `${filePath}.tmp`
    await fs.writeFile(tmp, serialised, "utf8")
    await fs.rename(tmp, filePath)
    return { ok: true }
  } catch (err) {
    log.error("failed to save mcp-app state", { server, uri, error: String(err) })
    return { ok: false, reason: "io_error", message: String(err) }
  }
}

/** Remove the state file, if any. Returns true if a file was deleted. */
export async function clearState(server: string, uri: string): Promise<boolean> {
  const filePath = resolveStatePath(server, uri)
  try {
    await fs.unlink(filePath)
    return true
  } catch (err) {
    if (err && typeof err === "object" && "code" in err && (err as { code: string }).code === "ENOENT") {
      return false
    }
    log.warn("failed to clear mcp-app state", { server, uri, error: String(err) })
    return false
  }
}

export const McpAppState = {
  load: loadState,
  save: saveState,
  clear: clearState,
  stateKey,
  stateRoot,
  MAX_STATE_BYTES,
} as const
