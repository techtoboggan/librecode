import os from "node:os"
import path from "node:path"

// A04 (Insecure Design) / A02 (Cryptographic Failures) — Hard-coded
// read-block on credential file paths. Enforced at the tool boundary
// (read / bash / webfetch etc.) so a prompt-injected agent cannot be
// tricked into exfiltrating OAuth tokens, SSH keys, or .env secrets.
//
// This is a "thick wall" by design. Users who legitimately need to read
// a .env file can disable the guard per-project via a future config
// option; the default stance is deny.
//
// The guard is NOT a replacement for the OS-level credential store
// (keychain, libsecret, DPAPI). It is a second line of defense: if the
// user has a file-based credential store, the agent cannot read it
// regardless of OS permissions.

const home = os.homedir()

/** Absolute paths (normalized) that are always blocked. */
function literalBlocked(): string[] {
  return [
    // LibreCode's own auth stores — explicit entries per platform
    path.join(home, ".local/share/librecode/auth.json"),
    path.join(home, ".local/share/librecode/mcp-auth.json"),
    path.join(home, "Library/Application Support/librecode/auth.json"),
    path.join(home, "Library/Application Support/librecode/mcp-auth.json"),
    path.join(home, "AppData/Local/librecode/auth.json"),
    path.join(home, "AppData/Local/librecode/mcp-auth.json"),
    path.join(home, "AppData/Roaming/librecode/auth.json"),

    // Cloud provider credentials
    path.join(home, ".aws/credentials"),
    path.join(home, ".aws/config"),
    path.join(home, ".azure/accessTokens.json"),
    path.join(home, ".azure/azureProfile.json"),
    path.join(home, ".docker/config.json"),
    path.join(home, ".kube/config"),

    // Package manager / git token stores
    path.join(home, ".npmrc"),
    path.join(home, ".netrc"),
    path.join(home, "_netrc"), // Windows form
    path.join(home, ".yarnrc"),
    path.join(home, ".yarnrc.yml"),
  ]
}

/** Directory prefixes whose contents are all blocked (recursive). */
function blockedPrefixes(): string[] {
  return [
    // SSH private keys (public .pub filtered separately)
    path.join(home, ".ssh"),
    // GPG secret keyring material
    path.join(home, ".gnupg"),
    // Gcloud credential database
    path.join(home, ".config/gcloud"),
    // GitHub CLI token store
    path.join(home, ".config/gh"),
    // Password stores
    path.join(home, ".password-store"),
    path.join(home, ".config/chromium/Default/Login Data"),
  ]
}

/** File-basename regexes that block regardless of directory. */
const DOTENV_RE = /^\.env(\.[^.]+)*$/ // .env, .env.local, .env.production.local
const DOTENV_SAFE_SUFFIX = /\.(example|sample|template|dist)$/i // NOT secret
const ENVRC_RE = /^\.envrc$/

/**
 * SSH filter: .ssh/id_* is a private key; .ssh/*.pub, known_hosts, and
 * authorized_keys contain only public material and are safe to read.
 */
function isSshPublicOrPublicList(basename: string): boolean {
  if (basename.endsWith(".pub")) return true
  if (basename === "known_hosts" || basename === "known_hosts.old") return true
  if (basename === "authorized_keys") return true
  if (basename === "config") return true // ssh client config — not secret itself
  return false
}

export class CredentialAccessBlocked extends Error {
  constructor(public readonly pathAttempted: string) {
    super(
      `Refusing to access credential path: ${pathAttempted}\n` +
        `\n` +
        `LibreCode blocks agent tools from reading files that commonly contain\n` +
        `secrets (OAuth tokens, SSH keys, cloud creds, .env). This protects you\n` +
        `from prompt-injection-driven exfiltration. If you need this file open,\n` +
        `do it in your regular editor — the agent should not read it.\n`,
    )
    this.name = "CredentialAccessBlocked"
  }
}

/**
 * True if `p` points at a file the agent must not read. The path is first
 * normalized (resolving `.`, `..` segments) so `~/.ssh/../ssh/id_rsa` still
 * matches the .ssh prefix.
 */
export function isCredentialPath(p: string): boolean {
  if (!p) return false
  const normalized = path.normalize(p)
  const basename = path.basename(normalized)

  // Literal path list
  const literals = literalBlocked()
  for (const literal of literals) {
    if (normalized === literal) return true
  }

  // Prefix-based (directory) blocks
  for (const prefix of blockedPrefixes()) {
    if (normalized === prefix) return true
    if (normalized.startsWith(prefix + path.sep)) {
      // SSH exception: allow public keys / known_hosts / authorized_keys
      if (prefix === path.join(home, ".ssh") && isSshPublicOrPublicList(basename)) {
        return false
      }
      return true
    }
  }

  // .env and variants — anywhere in the tree
  if (DOTENV_RE.test(basename)) {
    // .env.example / .env.sample / .env.template are safe
    if (DOTENV_SAFE_SUFFIX.test(basename)) return false
    return true
  }
  if (ENVRC_RE.test(basename)) return true

  return false
}

export function assertNotCredentialPath(p: string): void {
  if (isCredentialPath(p)) {
    throw new CredentialAccessBlocked(p)
  }
}

// ──────────────────────────────────────────────────────────────────────
// Command-string scanning (A04 defense for the bash tool)
// ──────────────────────────────────────────────────────────────────────
//
// When the LLM wants to run `cat ~/.aws/credentials`, the permission
// prompt shows the user "Run: cat ~/.aws/credentials". A careful user
// would decline, but many click through. We want to reject at the tool
// layer regardless of user approval.
//
// Shell expansion is complex (env vars, globs, subshells, quoting, `readf`
// redirection) — we don't try to implement a full parser. Instead we do
// substring detection of high-signal patterns. False positives here are
// acceptable: a user who truly has a legitimate reason to reference one
// of these paths can bypass via the permission system in a future
// iteration (or through their own shell outside the agent).

const COMMAND_REDFLAG_PATTERNS: ReadonlyArray<RegExp> = [
  // LibreCode auth stores — the most important targets
  /\blibrecode\/auth\.json\b/i,
  /\blibrecode\/mcp-auth\.json\b/i,
  // SSH private keys — match id_<alg> but NOT id_<alg>.pub
  /\.ssh\/id_[a-z0-9_]+(?!\.pub)(?![a-z0-9_])/i,
  // Cloud provider
  /\.aws\/credentials\b/i,
  /\.aws\/config\b/i,
  /\.azure\/accessTokens/i,
  /\.docker\/config\.json\b/i,
  /\.kube\/config\b/i,
  /\.config\/gcloud\//i,
  /\.config\/gh\/hosts\.yml/i,
  // Package manager tokens
  /\.npmrc\b/,
  /\.netrc\b|_netrc\b/,
  // PGP
  /\.gnupg\/secring/i,
  /\.gnupg\/private-keys/i,
]

// .env handling is separate — the filename form can have many suffixes,
// several of which are safe (.env.example, .env.sample, …). Match the
// full token first, then filter by suffix.
const DOTENV_TOKEN_RE = /\B\.env(?:\.[a-z0-9_-]+)*\b/gi
const ENVRC_CMD_RE = /\B\.envrc\b/

/**
 * Scan a shell command string for references to credential paths. Returns
 * the matched pattern (for error messages) or undefined if clean.
 *
 * Heuristic — false positives are acceptable, false negatives are not.
 * ".env.example" passes; ".env" and ".env.production.local" do not.
 */
export function detectCredentialInCommand(command: string): string | undefined {
  if (!command) return undefined
  for (const pattern of COMMAND_REDFLAG_PATTERNS) {
    const m = command.match(pattern)
    if (m) return m[0]
  }
  // .env family — match full tokens, then filter safe suffixes. A bare
  // ".env" has tail "", which is credential. ".env.example" has tail
  // ".example" which matches the safe-suffix allowlist. Anything else
  // (.env.local, .env.production.local, …) is credential.
  const envMatches = command.match(DOTENV_TOKEN_RE)
  if (envMatches) {
    for (const token of envMatches) {
      const tail = token.slice(4) // strip ".env", keep the leading dot of any suffix
      if (tail === "" || !/^\.(example|sample|template|dist)$/i.test(tail)) {
        return token
      }
    }
  }
  if (ENVRC_CMD_RE.test(command)) return ".envrc"
  return undefined
}

export function assertCommandHasNoCredentialPath(command: string): void {
  const hit = detectCredentialInCommand(command)
  if (hit) throw new CredentialAccessBlocked(hit)
}
