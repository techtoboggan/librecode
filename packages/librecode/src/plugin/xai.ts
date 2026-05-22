/**
 * Phase 40 / upstream PR #28557 — xAI Grok OAuth auth plugin.
 *
 * Adds two OAuth login methods so SuperGrok subscribers don't need a
 * paid API key, plus keeps API-key entry as a fallback:
 *
 *   1. PKCE — opens a browser, callback to http://127.0.0.1:56121/callback.
 *      Standard interactive flow. Best UX when the browser + CLI run on
 *      the same machine.
 *
 *   2. RFC 8628 device-code — for VPS / SSH / Docker / WSL / any host
 *      where the loopback redirect isn't reachable from the user's
 *      browser. CLI prints a short user_code; user types it on any
 *      device with a browser; CLI long-polls the token endpoint.
 *
 * Both methods reuse the public Grok-CLI OAuth client_id; xAI's auth
 * server rejects loopback OAuth from non-allowlisted clients. Source:
 * hermes-agent PR #26534 (upstream).
 *
 * Token refresh: single-flight per loaded provider — concurrent fetches
 * from a session collapse onto one HTTP call so we don't replay a
 * rotating refresh_token. The refresh_token rotates on every exchange,
 * so a double-refresh would leave half the calls authenticated and
 * half 401'd until the next manual login.
 */
import { createServer } from "node:http"
import type { Hooks, PluginInput } from "@librecode/plugin"
import { OAUTH_DUMMY_KEY } from "../auth"
import { Installation } from "../installation"
import { Log } from "../util/log"

const log = Log.create({ service: "plugin.xai" })

// Public Grok-CLI OAuth client. xAI's auth server rejects loopback OAuth from
// non-allowlisted clients, so we reuse the Grok-CLI client_id that xAI ships
// for desktop OAuth flows.
const CLIENT_ID = "b1a00492-073a-47ea-816f-4c329264a828"
const AUTHORIZE_URL = "https://auth.x.ai/oauth2/authorize"
const TOKEN_URL = "https://auth.x.ai/oauth2/token"
const DEVICE_AUTHORIZATION_URL = "https://auth.x.ai/oauth2/device/code"
const DEVICE_CODE_GRANT_TYPE = "urn:ietf:params:oauth:grant-type:device_code"
const SCOPE = "openid profile email offline_access grok-cli:access api:access"

// Bounds for the device-code poll loop. xAI returns `interval` (seconds)
// but we floor it to avoid hammering and we add the spec's slow_down
// increment when xAI explicitly asks us to back off.
const DEVICE_CODE_DEFAULT_INTERVAL_MS = 5_000
const DEVICE_CODE_MIN_INTERVAL_MS = 1_000
const DEVICE_CODE_SLOW_DOWN_INCREMENT_MS = 5_000
const DEVICE_CODE_DEFAULT_EXPIRES_MS = 5 * 60 * 1000
const OAUTH_POLLING_SAFETY_MARGIN_MS = 3_000

// xAI rejects redirect_uris that don't match what was registered for the
// Grok-CLI client. The host:port pair is part of the registration, so we have
// to bind the loopback server to this exact port.
const OAUTH_HOST = "127.0.0.1"
const OAUTH_PORT = 56121
const OAUTH_REDIRECT_PATH = "/callback"
const REDIRECT_URI = `http://${OAUTH_HOST}:${OAUTH_PORT}${OAUTH_REDIRECT_PATH}`

// Refresh the access token a little before it actually expires so a single
// long-running tool call doesn't have to recover from a mid-flight 401.
const ACCESS_TOKEN_REFRESH_SKEW_MS = 120_000

export interface XaiAuthPluginOptions {
  authorizeUrl?: string
  tokenUrl?: string
  deviceAuthorizationUrl?: string
}

interface PkceCodes {
  verifier: string
  challenge: string
}

async function generatePKCE(): Promise<PkceCodes> {
  const verifier = generateRandomString(64)
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))
  return { verifier, challenge: base64UrlEncode(hash) }
}

function generateRandomString(length: number): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~"
  return Array.from(crypto.getRandomValues(new Uint8Array(length)))
    .map((b) => chars[b % chars.length])
    .join("")
}

function base64UrlEncode(buffer: ArrayBuffer): string {
  const binary = String.fromCharCode(...new Uint8Array(buffer))
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

function generateState(): string {
  return base64UrlEncode(crypto.getRandomValues(new Uint8Array(32)).buffer)
}

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    switch (char) {
      case "&":
        return "&amp;"
      case "<":
        return "&lt;"
      case ">":
        return "&gt;"
      case '"':
        return "&quot;"
      case "'":
        return "&#39;"
      default:
        return char
    }
  })
}

interface TokenResponse {
  access_token: string
  refresh_token: string
  id_token?: string
  token_type?: string
  expires_in?: number
  scope?: string
}

function authHeaders() {
  return {
    "Content-Type": "application/x-www-form-urlencoded",
    Accept: "application/json",
    "User-Agent": `librecode/${Installation.VERSION}`,
  }
}

/**
 * Parse the `exp` claim out of a JWT access_token without verifying the
 * signature. Only used to decide whether to proactively refresh — never
 * to make trust decisions, so unsigned decode is safe. Returns false for
 * opaque tokens (no JWT shape), which conservatively skips the proactive
 * refresh and lets the 401-on-call path drive the refresh instead.
 *
 * Exported for test coverage.
 */
export function accessTokenIsExpiring(
  token: string | undefined,
  skewMs: number = ACCESS_TOKEN_REFRESH_SKEW_MS,
): boolean {
  if (!token || typeof token !== "string") return false
  const parts = token.split(".")
  if (parts.length < 2) return false
  try {
    let payload = parts[1].replace(/-/g, "+").replace(/_/g, "/")
    while (payload.length % 4 !== 0) payload += "="
    const claims = JSON.parse(Buffer.from(payload, "base64").toString("utf8"))
    if (typeof claims?.exp !== "number") return false
    return claims.exp * 1000 <= Date.now() + Math.max(0, skewMs)
  } catch {
    return false
  }
}

export function buildAuthorizeUrl(
  pkce: PkceCodes,
  state: string,
  nonce: string,
  options: XaiAuthPluginOptions = {},
): string {
  // `plan=generic` opts the consent screen into xAI's generic OAuth plan
  // tier; without it, accounts.x.ai rejects loopback OAuth from
  // non-allowlisted clients.
  const params = new URLSearchParams({
    response_type: "code",
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    scope: SCOPE,
    code_challenge: pkce.challenge,
    code_challenge_method: "S256",
    state,
    nonce,
    plan: "generic",
    referrer: "librecode",
  })
  return `${options.authorizeUrl ?? AUTHORIZE_URL}?${params.toString()}`
}

async function exchangeCodeForTokens(
  code: string,
  pkce: PkceCodes,
  options: XaiAuthPluginOptions = {},
): Promise<TokenResponse> {
  const response = await fetch(options.tokenUrl ?? TOKEN_URL, {
    method: "POST",
    headers: authHeaders(),
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: REDIRECT_URI,
      client_id: CLIENT_ID,
      code_verifier: pkce.verifier,
    }).toString(),
  })
  if (!response.ok) {
    const detail = await response.text().catch(() => "")
    throw new Error(`xAI token exchange failed (${response.status})${detail ? `: ${detail}` : ""}`)
  }
  return response.json() as Promise<TokenResponse>
}

async function refreshAccessToken(refreshToken: string, options: XaiAuthPluginOptions = {}): Promise<TokenResponse> {
  const response = await fetch(options.tokenUrl ?? TOKEN_URL, {
    method: "POST",
    headers: authHeaders(),
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: CLIENT_ID,
    }).toString(),
  })
  if (!response.ok) {
    const detail = await response.text().catch(() => "")
    throw new Error(`xAI token refresh failed (${response.status})${detail ? `: ${detail}` : ""}`)
  }
  return response.json() as Promise<TokenResponse>
}

export interface DeviceCodeResponse {
  device_code: string
  user_code: string
  verification_uri: string
  verification_uri_complete?: string
  expires_in?: number
  interval?: number
}

interface DeviceTokenErrorBody {
  error?: string
  error_description?: string
}

export async function requestDeviceCode(options: XaiAuthPluginOptions = {}): Promise<DeviceCodeResponse> {
  const response = await fetch(options.deviceAuthorizationUrl ?? DEVICE_AUTHORIZATION_URL, {
    method: "POST",
    headers: authHeaders(),
    body: new URLSearchParams({ client_id: CLIENT_ID, scope: SCOPE }).toString(),
  })
  if (!response.ok) {
    const detail = await response.text().catch(() => "")
    throw new Error(`xAI device code request failed (${response.status})${detail ? `: ${detail}` : ""}`)
  }
  const json = (await response.json()) as DeviceCodeResponse
  if (!json.device_code || !json.user_code || !json.verification_uri) {
    throw new Error("xAI device code response is missing device_code / user_code / verification_uri")
  }
  return json
}

async function defaultSleep(ms: number): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, ms))
}

/**
 * Normalize a server-supplied seconds value to milliseconds.
 *
 * Defends the polling loop against garbage like `NaN`, `null`, or `-5`
 * from a misbehaving device-code endpoint — without this, a NaN interval
 * would slip through `?? default` (NaN is typeof number), reach
 * `setTimeout(_, NaN)` which is treated as 0, and busy-loop until the
 * hard deadline.
 *
 * Exported for test coverage.
 */
export function positiveSecondsToMs(value: unknown, defaultMs: number): number {
  const seconds = Number(value)
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : defaultMs
}

export async function pollDeviceCodeToken(
  device: DeviceCodeResponse,
  options: XaiAuthPluginOptions & { sleep?: (ms: number) => Promise<void>; now?: () => number } = {},
): Promise<TokenResponse> {
  const sleep = options.sleep ?? defaultSleep
  const now = options.now ?? (() => Date.now())
  const expiresInMs = positiveSecondsToMs(device.expires_in, DEVICE_CODE_DEFAULT_EXPIRES_MS)
  const deadline = now() + expiresInMs
  let intervalMs = Math.max(
    positiveSecondsToMs(device.interval, DEVICE_CODE_DEFAULT_INTERVAL_MS),
    DEVICE_CODE_MIN_INTERVAL_MS,
  )

  while (now() < deadline) {
    const response = await fetch(options.tokenUrl ?? TOKEN_URL, {
      method: "POST",
      headers: authHeaders(),
      body: new URLSearchParams({
        grant_type: DEVICE_CODE_GRANT_TYPE,
        client_id: CLIENT_ID,
        device_code: device.device_code,
      }).toString(),
    })
    if (response.ok) return (await response.json()) as TokenResponse

    const body = (await response.json().catch(() => ({}))) as DeviceTokenErrorBody
    const remaining = Math.max(0, deadline - now())
    // RFC 8628 §3.5: authorization_pending = keep polling at the same
    // interval; slow_down = bump the interval by ≥5s and keep polling.
    // Anything else is terminal.
    if (body.error === "authorization_pending") {
      await sleep(Math.min(intervalMs + OAUTH_POLLING_SAFETY_MARGIN_MS, remaining))
      continue
    }
    if (body.error === "slow_down") {
      intervalMs += DEVICE_CODE_SLOW_DOWN_INCREMENT_MS
      await sleep(Math.min(intervalMs + OAUTH_POLLING_SAFETY_MARGIN_MS, remaining))
      continue
    }
    if (body.error === "access_denied" || body.error === "authorization_denied") {
      throw new Error("xAI device authorization was denied")
    }
    if (body.error === "expired_token") {
      throw new Error("xAI device code expired - please re-run login")
    }
    const detail = body.error_description ?? body.error ?? ""
    throw new Error(`xAI device token exchange failed (${response.status})${detail ? `: ${detail}` : ""}`)
  }
  throw new Error("xAI device authorization timed out")
}

const HTML_SUCCESS = `<!doctype html>
<html><head><title>LibreCode - xAI Authorization Successful</title>
<style>body{font-family:system-ui,-apple-system,sans-serif;display:flex;justify-content:center;align-items:center;height:100vh;margin:0;background:#131010;color:#f1ecec}.c{text-align:center;padding:2rem}h1{margin-bottom:1rem}p{color:#b7b1b1}</style>
</head><body><div class="c"><h1>Authorization Successful</h1><p>You can close this window and return to LibreCode.</p></div>
<script>setTimeout(()=>window.close(),2000)</script></body></html>`

const HTML_ERROR = (error: string) => `<!doctype html>
<html><head><title>LibreCode - xAI Authorization Failed</title>
<style>body{font-family:system-ui,-apple-system,sans-serif;display:flex;justify-content:center;align-items:center;height:100vh;margin:0;background:#131010;color:#f1ecec}.c{text-align:center;padding:2rem}h1{color:#fc533a;margin-bottom:1rem}p{color:#b7b1b1}.e{color:#ff917b;font-family:monospace;margin-top:1rem;padding:1rem;background:#3c140d;border-radius:.5rem}</style>
</head><body><div class="c"><h1>Authorization Failed</h1><p>An error occurred during authorization.</p><div class="e">${escapeHtml(error)}</div></div></body></html>`

// CORS allowlist for the loopback callback. The redirect_uri itself is
// already bound to 127.0.0.1 and gated by PKCE+state; we only accept
// xAI's own auth origins for additional defense-in-depth.
const CORS_ALLOWED_ORIGINS = new Set(["https://accounts.x.ai", "https://auth.x.ai"])

interface PendingOAuth {
  pkce: PkceCodes
  state: string
  resolve: (tokens: TokenResponse) => void
  reject: (error: Error) => void
}

let oauthServer: ReturnType<typeof createServer> | undefined
let pendingOAuth: PendingOAuth | undefined

async function startOAuthServer(): Promise<{ port: number; redirectUri: string }> {
  if (oauthServer) return { port: OAUTH_PORT, redirectUri: REDIRECT_URI }

  const server = createServer((req, res) => {
    const reqUrl = req.url || "/"
    const url = new URL(reqUrl, `http://${OAUTH_HOST}:${OAUTH_PORT}`)

    const origin = req.headers["origin"]
    const allowOrigin = typeof origin === "string" && CORS_ALLOWED_ORIGINS.has(origin) ? origin : ""
    if (allowOrigin) {
      res.setHeader("Access-Control-Allow-Origin", allowOrigin)
      res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS")
      res.setHeader("Access-Control-Allow-Headers", "Content-Type")
      res.setHeader("Access-Control-Allow-Private-Network", "true")
      res.setHeader("Vary", "Origin")
    }

    if (req.method === "OPTIONS") {
      res.writeHead(204)
      res.end()
      return
    }

    if (url.pathname === OAUTH_REDIRECT_PATH) {
      const code = url.searchParams.get("code")
      const state = url.searchParams.get("state")
      const error = url.searchParams.get("error")
      const errorDescription = url.searchParams.get("error_description")

      if (error) {
        const errorMsg = errorDescription || error
        pendingOAuth?.reject(new Error(errorMsg))
        pendingOAuth = undefined
        res.writeHead(200, { "Content-Type": "text/html" })
        res.end(HTML_ERROR(errorMsg))
        return
      }

      if (!code) {
        const errorMsg = "Missing authorization code"
        pendingOAuth?.reject(new Error(errorMsg))
        pendingOAuth = undefined
        res.writeHead(400, { "Content-Type": "text/html" })
        res.end(HTML_ERROR(errorMsg))
        return
      }

      if (!pendingOAuth || state !== pendingOAuth.state) {
        const errorMsg = "Invalid state - potential CSRF attack"
        pendingOAuth?.reject(new Error(errorMsg))
        pendingOAuth = undefined
        res.writeHead(400, { "Content-Type": "text/html" })
        res.end(HTML_ERROR(errorMsg))
        return
      }

      const current = pendingOAuth
      pendingOAuth = undefined

      exchangeCodeForTokens(code, current.pkce)
        .then((tokens) => current.resolve(tokens))
        .catch((err) => current.reject(err))

      res.writeHead(200, { "Content-Type": "text/html" })
      res.end(HTML_SUCCESS)
      return
    }

    if (url.pathname === "/cancel") {
      pendingOAuth?.reject(new Error("Login cancelled"))
      pendingOAuth = undefined
      res.writeHead(200)
      res.end("Login cancelled")
      return
    }

    res.writeHead(404)
    res.end("Not found")
  })

  // listen() failures (e.g. EADDRINUSE because Grok-CLI is bound to the
  // same pinned port) must clear `oauthServer` so the next
  // startOAuthServer() doesn't short-circuit on a stale truthy ref.
  await new Promise<void>((resolve, reject) => {
    const onError = (err: Error) => {
      oauthServer = undefined
      reject(err)
    }
    server.once("error", onError)
    server.listen(OAUTH_PORT, OAUTH_HOST, () => {
      server.removeListener("error", onError)
      // Permanent log-only listener so subsequent server errors don't trip
      // Node's default unhandled-error-event = throw behavior and crash
      // the entire LibreCode process.
      server.on("error", (err) => log.warn("xai oauth server error", { error: err }))
      log.info("xai oauth server started", { host: OAUTH_HOST, port: OAUTH_PORT })
      resolve()
    })
    oauthServer = server
  })

  return { port: OAUTH_PORT, redirectUri: REDIRECT_URI }
}

function stopOAuthServer() {
  if (oauthServer) {
    oauthServer.close(() => log.info("xai oauth server stopped"))
    oauthServer = undefined
  }
}

function waitForOAuthCallback(pkce: PkceCodes, state: string): Promise<TokenResponse> {
  if (pendingOAuth) {
    // Supersede the abandoned in-flight authorize() so the new caller
    // doesn't wait on a state value that can never match the next callback.
    pendingOAuth.reject(new Error("Superseded by a newer xAI authorize request"))
    pendingOAuth = undefined
  }
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => {
        if (pendingOAuth) {
          pendingOAuth = undefined
          reject(new Error("OAuth callback timeout - authorization took too long"))
        }
      },
      5 * 60 * 1000,
    )

    pendingOAuth = {
      pkce,
      state,
      resolve: (tokens) => {
        clearTimeout(timeout)
        resolve(tokens)
      },
      reject: (error) => {
        clearTimeout(timeout)
        reject(error)
      },
    }
  })
}

interface RefreshResult {
  access: string
  refresh: string
  expires: number
}

export async function XaiAuthPlugin(input: PluginInput, options: XaiAuthPluginOptions = {}): Promise<Hooks> {
  return {
    auth: {
      provider: "xai",
      async loader(getAuth) {
        const auth = await getAuth()
        if (auth.type !== "oauth") return {}

        // Single-flight refresh: collapse concurrent fetches from this
        // loaded provider onto one HTTP call so we don't replay a
        // rotating refresh_token. Phase 40.3 — same pattern as Codex.
        let refreshPromise: Promise<RefreshResult> | undefined

        return {
          // Dummy bearer keeps the AI SDK from bailing on "missing apiKey";
          // the real OAuth token is injected by the fetch override below.
          apiKey: OAUTH_DUMMY_KEY,
          async fetch(requestInput: RequestInfo | URL, init?: RequestInit) {
            let currentAuth = await getAuth()
            // Auth can flip from oauth to api mid-session (user re-runs
            // /connect with a pasted key). When that happens, pass through.
            if (currentAuth.type !== "oauth") return fetch(requestInput, init)

            const expiresSoon =
              !currentAuth.expires ||
              currentAuth.expires - Date.now() <= ACCESS_TOKEN_REFRESH_SKEW_MS ||
              accessTokenIsExpiring(currentAuth.access)
            if (expiresSoon) {
              if (!refreshPromise) {
                const refreshToken = currentAuth.refresh
                log.info("refreshing xai access token")
                refreshPromise = refreshAccessToken(refreshToken, options)
                  .then(async (tokens) => {
                    const refreshedExpires = Date.now() + (tokens.expires_in ?? 3600) * 1000
                    const refreshedRefresh = tokens.refresh_token || refreshToken
                    // Persist the rotated pair. xAI has already consumed
                    // the old refresh_token by the time we get here; an
                    // auth.set failure leaves disk stale but the
                    // in-memory result is still valid for this turn.
                    await input.client.auth
                      .set({
                        path: { id: "xai" },
                        body: {
                          type: "oauth",
                          access: tokens.access_token,
                          refresh: refreshedRefresh,
                          expires: refreshedExpires,
                        },
                      })
                      .catch((err) => log.warn("failed to persist refreshed xai tokens", { error: err }))
                    return { access: tokens.access_token, refresh: refreshedRefresh, expires: refreshedExpires }
                  })
                  .finally(() => {
                    refreshPromise = undefined
                  })
              }
              const refreshed = await refreshPromise
              currentAuth = { ...currentAuth, ...refreshed }
            }

            // Copy headers into a fresh Headers so we never mutate the
            // RequestInit the AI SDK may reuse on retry.
            const headers = new Headers(requestInput instanceof Request ? requestInput.headers : undefined)
            if (init?.headers) {
              const entries =
                init.headers instanceof Headers
                  ? init.headers.entries()
                  : Array.isArray(init.headers)
                    ? init.headers
                    : Object.entries(init.headers as Record<string, string | undefined>)
              for (const [key, value] of entries) {
                if (value !== undefined) headers.set(key, String(value))
              }
            }
            headers.set("authorization", `Bearer ${currentAuth.access}`)
            headers.set("User-Agent", `librecode/${Installation.VERSION}`)

            return fetch(requestInput, { ...init, headers })
          },
        }
      },
      methods: [
        {
          label: "xAI Grok OAuth (SuperGrok Subscription)",
          type: "oauth",
          authorize: async () => {
            await startOAuthServer()
            const pkce = await generatePKCE()
            const state = generateState()
            const nonce = generateState()
            const authUrl = buildAuthorizeUrl(pkce, state, nonce, options)

            const callbackPromise = waitForOAuthCallback(pkce, state)

            return {
              url: authUrl,
              instructions: "Complete authorization in your browser. This window will close automatically.",
              method: "auto" as const,
              callback: async () => {
                try {
                  const tokens = await callbackPromise
                  return {
                    type: "success" as const,
                    refresh: tokens.refresh_token,
                    access: tokens.access_token,
                    expires: Date.now() + (tokens.expires_in ?? 3600) * 1000,
                  }
                } catch (err) {
                  log.error("xai oauth callback failed", { error: err })
                  return { type: "failed" as const }
                } finally {
                  stopOAuthServer()
                }
              },
            }
          },
        },
        {
          // RFC 8628 device-code flow — VPS / SSH / Docker / CI / WSL.
          label: "xAI Grok OAuth (Headless / Remote / VPS)",
          type: "oauth",
          authorize: async () => {
            const device = await requestDeviceCode(options)
            const browserUrl = device.verification_uri_complete ?? device.verification_uri
            return {
              url: browserUrl,
              instructions: `Open ${device.verification_uri} on any device and enter code: ${device.user_code}`,
              method: "auto" as const,
              callback: async () => {
                try {
                  const tokens = await pollDeviceCodeToken(device, options)
                  return {
                    type: "success" as const,
                    refresh: tokens.refresh_token,
                    access: tokens.access_token,
                    expires: Date.now() + (tokens.expires_in ?? 3600) * 1000,
                  }
                } catch (err) {
                  log.error("xai device code callback failed", { error: err })
                  return { type: "failed" as const }
                }
              },
            }
          },
        },
        {
          label: "Manually enter API Key",
          type: "api",
        },
      ],
    },
  }
}
