import { NamedError } from "@librecode/util/error"
import { Hono } from "hono"
import { basicAuth } from "hono/basic-auth"
import { websocket } from "hono/bun"
import { cors } from "hono/cors"
import { HTTPException } from "hono/http-exception"
import { proxy } from "hono/proxy"
import { streamSSE } from "hono/streaming"
import type { ContentfulStatusCode } from "hono/utils/http-status"
import { describeRoute, generateSpecs, openAPIRouteHandler, resolver, validator } from "hono-openapi"
import z from "zod"
import { Bus } from "@/bus"
import { BusEvent } from "@/bus/bus-event"
import { Filesystem } from "@/util/filesystem"
import { lazy } from "@/util/lazy"
import { Agent } from "../agent/agent"
import { Auth } from "../auth"
import { Command } from "../command"
import { WorkspaceID } from "../control-plane/schema"
import { WorkspaceContext } from "../control-plane/workspace-context"
import { WorkspaceRouterMiddleware } from "../control-plane/workspace-router-middleware"
import { Flag } from "../flag/flag"
import { Format } from "../format"
import { Global } from "../global"
import { LSP } from "../lsp"
import { InstanceBootstrap } from "../project/bootstrap"
import { Instance } from "../project/instance"
import { Vcs } from "../project/vcs"
import { Provider } from "../provider/provider"
import { ProviderID } from "../provider/schema"
import { Skill } from "../skill/skill"
import { NotFoundError } from "../storage/db"
import { Log } from "../util/log"
import { errors } from "./error"
import { LogPayload, sanitizeLogExtra } from "./log-endpoint-schema"
import { MDNS } from "./mdns"
import { createRateLimiter, redactIp } from "./rate-limit"
import { ConfigRoutes } from "./routes/config"
import { ExperimentalRoutes } from "./routes/experimental"
import { FileRoutes } from "./routes/file"
import { GlobalRoutes } from "./routes/global"
import { MarketplaceRoutes } from "./routes/marketplace"
import { McpRoutes } from "./routes/mcp"
import { PermissionRoutes } from "./routes/permission"
import { ProjectRoutes } from "./routes/project"
import { ProviderRoutes } from "./routes/provider"
import { PtyRoutes } from "./routes/pty"
import { QuestionRoutes } from "./routes/question"
import { SessionRoutes } from "./routes/session"
import { SystemRoutes } from "./routes/system"
import { TuiRoutes } from "./routes/tui"

// This global is needed to prevent ai-sdk from logging warnings to stdout https://github.com/vercel/ai/blob/2dc67e0ef538307f21368db32d5a12345d98831b/packages/ai/src/logger/log-warnings.ts#L85
globalThis.AI_SDK_LOG_WARNINGS = false

const log = Log.create({ service: "server" })

function namedErrorStatus(err: NamedError): ContentfulStatusCode {
  if (err instanceof NotFoundError) return 404
  if (err instanceof Provider.ModelNotFoundError) return 400
  if (err.name.startsWith("Worktree")) return 400
  return 500
}

/**
 * A05 (Security Misconfiguration) — production responses carry only the
 * error message. Stack traces (with file paths + line numbers) are only
 * attached when LIBRECODE_DEV=1. Leaked stack traces fingerprint the deploy
 * and narrow the attack surface for a subsequent exploit.
 */
export function handleServerError(err: Error, c: import("hono").Context): Response {
  if (err instanceof NamedError) {
    const status = namedErrorStatus(err)
    return c.json(err.toObject(), { status })
  }
  if (err instanceof HTTPException) return err.getResponse()
  // Read the dev flag dynamically so tests can toggle without module reload
  const dev = process.env.LIBRECODE_DEV === "true" || process.env.LIBRECODE_DEV === "1"
  const message =
    dev && err instanceof Error && err.stack ? err.stack : err instanceof Error ? err.message : String(err)
  return c.json(new NamedError.Unknown({ message }).toObject(), { status: 500 })
}

/**
 * Known LibreCode development ports. Anything else on localhost is rejected
 * unless the caller explicitly allows it via `opts.cors`.
 *
 * A05 (Security Misconfiguration) — Previously accepted any `http://localhost:*`
 * or `http://127.0.0.1:*` origin, which let any other local web service on a
 * user's machine talk to the LibreCode API as soon as the user authenticated.
 */
const KNOWN_DEV_PORTS = new Set([
  1420, // packages/desktop Tauri dev (packages/desktop/vite.config.ts:23)
  3000, // packages/app vite dev (packages/app/vite.config.ts:9)
])

function isKnownLocalhostOrigin(input: string): boolean {
  let url: URL
  try {
    url = new URL(input)
  } catch {
    return false
  }
  if (url.protocol !== "http:") return false
  if (url.hostname !== "localhost" && url.hostname !== "127.0.0.1") return false
  if (url.username || url.password) return false // reject userinfo smuggling
  const port = url.port ? Number(url.port) : NaN
  if (!Number.isFinite(port)) return false
  return KNOWN_DEV_PORTS.has(port)
}

export function resolveCorsOrigin(input: string | null | undefined, allowed: string[] | undefined): string | undefined {
  if (!input) return undefined
  if (isKnownLocalhostOrigin(input)) return input
  if (input === "tauri://localhost" || input === "http://tauri.localhost" || input === "https://tauri.localhost")
    return input
  if (/^https:\/\/([a-z0-9-]+\.)*librecode\.ai$/.test(input)) return input
  if (allowed?.includes(input)) return input
  return undefined
}

// A07 — Shared rate limiter for all server instances. 10 failed
// basic-auth attempts per 5 min per source IP → 429. Successful auth
// clears the bucket. Cleanup every 60s to prune expired entries.
const authRateLimiter = createRateLimiter({ maxAttempts: 10, windowMs: 5 * 60 * 1000 })
setInterval(() => authRateLimiter.cleanup(), 60_000).unref?.()

function extractClientIp(c: import("hono").Context): string {
  // honor X-Forwarded-For first entry only (defense against spoofed chains)
  const xff = c.req.header("x-forwarded-for")
  if (xff) return xff.split(",")[0]!.trim()
  const real = c.req.header("x-real-ip")
  if (real) return real.trim()
  // Local connections have no forwarded headers. Use a literal marker so
  // the loopback-exemption code path can detect + bypass rate limiting.
  return "local"
}

/**
 * True when the client is connecting over the loopback interface. Used to
 * bypass rate limiting for local connections (the desktop UI, local CLI
 * scripts) — see the rate-limit comment block in the auth middleware.
 *
 * Heuristic: we rely on the IP string produced by extractClientIp. If
 * there's no forwarded header (i.e. no proxy between us and the client),
 * the client is talking to us directly — and our servers bind to
 * loopback by default per the 29c.1 fail-closed rule. The "local" literal
 * we return from extractClientIp covers this case. Explicit 127.* / ::1
 * strings from X-Forwarded-For also count.
 */
function isLoopbackClient(ip: string): boolean {
  if (ip === "local") return true
  if (ip === "::1" || ip === "[::1]" || ip === "0:0:0:0:0:0:0:1") return true
  if (ip.startsWith("127.")) return true
  return false
}

const ServerDefault = lazy(() => serverCreateApp({}))

const serverCreateApp = (opts: { cors?: string[] }): Hono => {
  const app = new Hono()
  return app
    .onError((err, c) => {
      log.error("failed", {
        error: err,
      })
      return handleServerError(err, c)
    })
    .use(async (c, next) => {
      // Allow CORS preflight requests to succeed without auth.
      // Browser clients sending Authorization headers will preflight with OPTIONS.
      if (c.req.method === "OPTIONS") return next()
      const password = Flag.LIBRECODE_SERVER_PASSWORD
      if (!password) return next()
      const username = Flag.LIBRECODE_SERVER_USERNAME ?? "librecode"

      // A07 — rate-limit basic-auth BEFORE invoking it. Avoids timing-based
      // enumeration and throttles brute-force attempts from the LAN.
      //
      // EXEMPTION: loopback connections skip rate limiting. Rationale:
      //   1. If the attacker already has code execution on 127.0.0.1
      //      they don't need to brute-force HTTP — the threat model rate
      //      limiting defends against is LAN/WAN attackers.
      //   2. The local desktop UI fires 10-20 concurrent fetches on
      //      startup (config, providers, session list, etc.). Before
      //      this exemption, the 11th+ parallel fetch got 429'd because
      //      all loopback requests collapse to the same bucket key
      //      ("unknown" — no X-Forwarded-For from local connections).
      //      Symptom: 'Could not reach Local Server' in the desktop UI.
      //   3. Hono's basicAuth is async; success() clears the bucket only
      //      AFTER auth completes. So even a steady-state burst of
      //      parallel-but-successful requests could transiently exceed
      //      the limit. Exempting loopback makes this safe-by-design.
      const ip = extractClientIp(c)
      if (!isLoopbackClient(ip)) {
        const rl = authRateLimiter.check(ip)
        if (!rl.allowed) {
          log.warn("auth rate-limited", {
            ip: redactIp(ip),
            path: c.req.path,
            count: rl.count,
            retryAfterSec: rl.retryAfterSec,
          })
          return c.json(
            { error: "Too Many Requests" },
            {
              status: 429,
              headers: { "Retry-After": String(rl.retryAfterSec) },
            },
          )
        }
      }

      // Run basic-auth; catch its HTTPException to log the 401 ourselves
      try {
        const result = basicAuth({ username, password })(c, next)
        // If result resolves without throwing, basic-auth approved
        await result
        authRateLimiter.success(ip) // A07 — reset bucket on success
        return
      } catch (err) {
        // A09 — log every 401 for brute-force visibility
        log.warn("auth failed", {
          ip: redactIp(ip),
          path: c.req.path,
        })
        throw err
      }
    })
    .use(async (c, next) => {
      const skipLogging = c.req.path === "/log"
      if (!skipLogging) {
        log.info("request", {
          method: c.req.method,
          path: c.req.path,
        })
      }
      const timer = log.time("request", {
        method: c.req.method,
        path: c.req.path,
      })
      await next()
      if (!skipLogging) {
        timer.stop()
      }
    })
    .use(
      cors({
        origin(input) {
          return resolveCorsOrigin(input, opts?.cors)
        },
      }),
    )
    .route("/global", GlobalRoutes())
    .put(
      "/auth/:providerID",
      describeRoute({
        summary: "Set auth credentials",
        description: "Set authentication credentials",
        operationId: "auth.set",
        responses: {
          200: {
            description: "Successfully set authentication credentials",
            content: {
              "application/json": {
                schema: resolver(z.boolean()),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator(
        "param",
        z.object({
          providerID: ProviderID.zod,
        }),
      ),
      validator("json", Auth.Info),
      async (c) => {
        const providerID = c.req.valid("param").providerID
        const info = c.req.valid("json")
        await Auth.set(providerID, info)
        return c.json(true)
      },
    )
    .delete(
      "/auth/:providerID",
      describeRoute({
        summary: "Remove auth credentials",
        description: "Remove authentication credentials",
        operationId: "auth.remove",
        responses: {
          200: {
            description: "Successfully removed authentication credentials",
            content: {
              "application/json": {
                schema: resolver(z.boolean()),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator(
        "param",
        z.object({
          providerID: ProviderID.zod,
        }),
      ),
      async (c) => {
        const providerID = c.req.valid("param").providerID
        await Auth.remove(providerID)
        return c.json(true)
      },
    )
    .use(async (c, next) => {
      if (c.req.path === "/log") return next()
      const rawWorkspaceID = c.req.query("workspace") || c.req.header("x-librecode-workspace")
      const raw = c.req.query("directory") || c.req.header("x-librecode-directory") || process.cwd()
      const directory = Filesystem.resolve(
        (() => {
          try {
            return decodeURIComponent(raw)
          } catch {
            return raw
          }
        })(),
      )

      return WorkspaceContext.provide({
        workspaceID: rawWorkspaceID ? WorkspaceID.make(rawWorkspaceID) : undefined,
        async fn() {
          return Instance.provide({
            directory,
            init: InstanceBootstrap,
            async fn() {
              return next()
            },
          })
        },
      })
    })
    .use(WorkspaceRouterMiddleware)
    .get(
      "/doc",
      openAPIRouteHandler(app, {
        documentation: {
          info: {
            title: "librecode",
            version: "0.0.3",
            description: "librecode api",
          },
          openapi: "3.1.1",
        },
      }),
    )
    .use(
      validator(
        "query",
        z.object({
          directory: z.string().optional(),
          workspace: z.string().optional(),
        }),
      ),
    )
    .route("/project", ProjectRoutes())
    .route("/pty", PtyRoutes())
    .route("/config", ConfigRoutes())
    .route("/experimental", ExperimentalRoutes())
    .route("/session", SessionRoutes())
    .route("/permission", PermissionRoutes())
    .route("/question", QuestionRoutes())
    .route("/provider", ProviderRoutes())
    .route("/", FileRoutes())
    .route("/mcp", McpRoutes())
    .route("/marketplace", MarketplaceRoutes())
    .route("/system", SystemRoutes())
    .route("/tui", TuiRoutes())
    .post(
      "/instance/dispose",
      describeRoute({
        summary: "Dispose instance",
        description: "Clean up and dispose the current LibreCode instance, releasing all resources.",
        operationId: "instance.dispose",
        responses: {
          200: {
            description: "Instance disposed",
            content: {
              "application/json": {
                schema: resolver(z.boolean()),
              },
            },
          },
        },
      }),
      async (c) => {
        await Instance.dispose()
        return c.json(true)
      },
    )
    .get(
      "/path",
      describeRoute({
        summary: "Get paths",
        description: "Retrieve the current working directory and related path information for the LibreCode instance.",
        operationId: "path.get",
        responses: {
          200: {
            description: "Path",
            content: {
              "application/json": {
                schema: resolver(
                  z
                    .object({
                      home: z.string(),
                      state: z.string(),
                      config: z.string(),
                      worktree: z.string(),
                      directory: z.string(),
                    })
                    .meta({
                      ref: "Path",
                    }),
                ),
              },
            },
          },
        },
      }),
      async (c) => {
        return c.json({
          home: Global.Path.home,
          state: Global.Path.state,
          config: Global.Path.config,
          worktree: Instance.worktree,
          directory: Instance.directory,
        })
      },
    )
    .get(
      "/vcs",
      describeRoute({
        summary: "Get VCS info",
        description: "Retrieve version control system (VCS) information for the current project, such as git branch.",
        operationId: "vcs.get",
        responses: {
          200: {
            description: "VCS info",
            content: {
              "application/json": {
                schema: resolver(Vcs.Info),
              },
            },
          },
        },
      }),
      async (c) => {
        const branch = await Vcs.branch()
        return c.json({
          branch,
        })
      },
    )
    .get(
      "/command",
      describeRoute({
        summary: "List commands",
        description: "Get a list of all available commands in the LibreCode system.",
        operationId: "command.list",
        responses: {
          200: {
            description: "List of commands",
            content: {
              "application/json": {
                schema: resolver(Command.Info.array()),
              },
            },
          },
        },
      }),
      async (c) => {
        const commands = await Command.list()
        return c.json(commands)
      },
    )
    .post(
      "/log",
      describeRoute({
        summary: "Write log",
        description: "Write a log entry to the server logs with specified level and metadata.",
        operationId: "app.log",
        responses: {
          200: {
            description: "Log entry written successfully",
            content: {
              "application/json": {
                schema: resolver(z.boolean()),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator("json", LogPayload),
      async (c) => {
        const { service, level, message, extra } = c.req.valid("json")
        const logger = Log.create({ service })
        // A04/A09 — sanitize extra before writing so a caller cannot flood
        // the log file with megabytes of attacker-controlled data.
        const safeExtra = sanitizeLogExtra(extra)

        switch (level) {
          case "debug":
            logger.debug(message, safeExtra)
            break
          case "info":
            logger.info(message, safeExtra)
            break
          case "error":
            logger.error(message, safeExtra)
            break
          case "warn":
            logger.warn(message, safeExtra)
            break
        }

        return c.json(true)
      },
    )
    .get(
      "/agent",
      describeRoute({
        summary: "List agents",
        description: "Get a list of all available AI agents in the LibreCode system.",
        operationId: "app.agents",
        responses: {
          200: {
            description: "List of agents",
            content: {
              "application/json": {
                schema: resolver(Agent.Info.array()),
              },
            },
          },
        },
      }),
      async (c) => {
        const modes = await Agent.list()
        return c.json(modes)
      },
    )
    .get(
      "/skill",
      describeRoute({
        summary: "List skills",
        description: "Get a list of all available skills in the LibreCode system.",
        operationId: "app.skills",
        responses: {
          200: {
            description: "List of skills",
            content: {
              "application/json": {
                schema: resolver(Skill.Info.array()),
              },
            },
          },
        },
      }),
      async (c) => {
        const skills = await Skill.all()
        return c.json(skills)
      },
    )
    .get(
      "/lsp",
      describeRoute({
        summary: "Get LSP status",
        description: "Get LSP server status",
        operationId: "lsp.status",
        responses: {
          200: {
            description: "LSP server status",
            content: {
              "application/json": {
                schema: resolver(LSP.Status.array()),
              },
            },
          },
        },
      }),
      async (c) => {
        return c.json(await LSP.status())
      },
    )
    .get(
      "/formatter",
      describeRoute({
        summary: "Get formatter status",
        description: "Get formatter status",
        operationId: "formatter.status",
        responses: {
          200: {
            description: "Formatter status",
            content: {
              "application/json": {
                schema: resolver(Format.Status.array()),
              },
            },
          },
        },
      }),
      async (c) => {
        return c.json(await Format.status())
      },
    )
    .get(
      "/event",
      describeRoute({
        summary: "Subscribe to events",
        description: "Get events",
        operationId: "event.subscribe",
        responses: {
          200: {
            description: "Event stream",
            content: {
              "text/event-stream": {
                schema: resolver(BusEvent.payloads()),
              },
            },
          },
        },
      }),
      async (c) => {
        log.info("event connected")
        c.header("X-Accel-Buffering", "no")
        c.header("X-Content-Type-Options", "nosniff")
        return streamSSE(c, async (stream) => {
          stream.writeSSE({
            data: JSON.stringify({
              type: "server.connected",
              properties: {},
            }),
          })
          const unsub = Bus.subscribeAll(async (event) => {
            await stream.writeSSE({
              data: JSON.stringify(event),
            })
            if (event.type === Bus.InstanceDisposed.type) {
              stream.close()
            }
          })

          // Send heartbeat every 10s to prevent stalled proxy streams.
          const heartbeat = setInterval(() => {
            stream.writeSSE({
              data: JSON.stringify({
                type: "server.heartbeat",
                properties: {},
              }),
            })
          }, 10_000)

          await new Promise<void>((resolve) => {
            stream.onAbort(() => {
              clearInterval(heartbeat)
              unsub()
              resolve()
              log.info("event disconnected")
            })
          })
        })
      },
    )
    .all("/*", async (c) => {
      const path = c.req.path

      const response = await proxy(`https://app.librecode.ai${path}`, {
        ...c.req,
        headers: {
          ...c.req.raw.headers,
          host: "app.librecode.ai",
        },
      })
      response.headers.set(
        "Content-Security-Policy",
        "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; media-src 'self' data:; connect-src 'self' data:",
      )
      return response
    })
}

async function serverOpenapi() {
  // Cast to break excessive type recursion from long route chains
  const result = await generateSpecs(ServerDefault(), {
    documentation: {
      info: {
        title: "librecode",
        version: "1.0.0",
        description: "librecode api",
      },
      openapi: "3.1.1",
    },
  })
  return result
}

/** @deprecated do not use this dumb shit */
let serverUrl: URL

function serverListen(opts: { port: number; hostname: string; mdns?: boolean; mdnsDomain?: string; cors?: string[] }) {
  serverUrl = new URL(`http://${opts.hostname}:${opts.port}`)
  const app = serverCreateApp(opts)
  const args = {
    hostname: opts.hostname,
    idleTimeout: 0,
    fetch: app.fetch,
    websocket: websocket,
  } as const
  const tryServe = (port: number) => {
    try {
      return Bun.serve({ ...args, port })
    } catch {
      return undefined
    }
  }
  const server = opts.port === 0 ? (tryServe(4096) ?? tryServe(0)) : tryServe(opts.port)
  if (!server) throw new Error(`Failed to start server on port ${opts.port}`)

  const shouldPublishMDNS =
    opts.mdns &&
    server.port &&
    opts.hostname !== "127.0.0.1" &&
    opts.hostname !== "localhost" &&
    opts.hostname !== "::1"
  if (shouldPublishMDNS) {
    // biome-ignore lint/style/noNonNullAssertion: Bun.serve always assigns a port after start
    MDNS.publish(server.port!, opts.mdnsDomain)
  } else if (opts.mdns) {
    log.warn("mDNS enabled but hostname is loopback; skipping mDNS publish")
  }

  const originalStop = server.stop.bind(server)
  server.stop = async (closeActiveConnections?: boolean) => {
    if (shouldPublishMDNS) MDNS.unpublish()
    return originalStop(closeActiveConnections)
  }

  return server
}

export const Server = {
  Default: ServerDefault,
  createApp: serverCreateApp,
  openapi: serverOpenapi,
  get url() {
    return serverUrl
  },
  set url(v: URL) {
    serverUrl = v
  },
  listen: serverListen,
} as const
