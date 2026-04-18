import type { Argv, InferredOptionTypes } from "yargs"
import { Config } from "../config/config"

const options = {
  port: {
    type: "number" as const,
    describe: "port to listen on",
    default: 0,
  },
  hostname: {
    type: "string" as const,
    describe: "hostname to listen on",
    default: "127.0.0.1",
  },
  mdns: {
    type: "boolean" as const,
    describe: "enable mDNS service discovery (defaults hostname to 0.0.0.0)",
    default: false,
  },
  "mdns-domain": {
    type: "string" as const,
    describe: "custom domain name for mDNS service (default: librecode.local)",
    default: "librecode.local",
  },
  cors: {
    type: "string" as const,
    array: true,
    describe: "additional domains to allow for CORS",
    default: [] as string[],
  },
  "i-know-what-im-doing-bind-insecurely": {
    type: "boolean" as const,
    describe: "(hidden) bypass A05 fail-closed check — CI/test only",
    default: false,
    hidden: true,
  },
}

// A05 — Binding to a non-loopback hostname without LIBRECODE_SERVER_PASSWORD
// leaves the full API (session control, shell execution, credential storage)
// open on the LAN. Fail-closed at the CLI layer; warn-only is not enough.

/**
 * Returns true iff `hostname` resolves to the loopback interface.
 * Accepts 127.0.0.0/8, ::1, [::1], and the literal string "localhost".
 */
export function isLoopbackHostname(hostname: string): boolean {
  if (!hostname) return false
  if (hostname === "localhost") return true
  if (hostname === "::1" || hostname === "[::1]") return true
  if (hostname.startsWith("127.")) return true
  return false
}

export class InsecureBindError extends Error {
  constructor(public hostname: string) {
    super(
      `Refusing to bind to ${hostname} without a server password.\n` +
        `\n` +
        `Binding to a non-loopback address exposes the LibreCode API (including\n` +
        `shell execution and credential storage) to your LAN. Set\n` +
        `LIBRECODE_SERVER_PASSWORD to enable this, or bind to 127.0.0.1.\n` +
        `\n` +
        `Example:\n` +
        `  LIBRECODE_SERVER_PASSWORD=$(openssl rand -hex 32) librecode serve --hostname 0.0.0.0\n`,
    )
    this.name = "InsecureBindError"
  }
}

/**
 * A05 fail-closed check. Call from every CLI command that starts a server.
 * Throws `InsecureBindError` if the combination is unsafe. The `bypass` flag
 * is the CLI's `--i-know-what-im-doing-bind-insecurely` escape hatch (hidden
 * from help; intended for CI smoke tests).
 */
export function requirePasswordForNonLoopback(params: {
  hostname: string
  password: string | undefined
  bypass: boolean
}): void {
  if (isLoopbackHostname(params.hostname)) return
  if (params.password && params.password.length > 0) return
  if (params.bypass) return
  throw new InsecureBindError(params.hostname)
}

export type NetworkOptions = InferredOptionTypes<typeof options>

export function withNetworkOptions<T>(yargs: Argv<T>) {
  return yargs.options(options)
}

function resolveHostname(
  args: NetworkOptions,
  serverConfig: { hostname?: string } | undefined,
  mdns: boolean,
  hostnameExplicitlySet: boolean,
): string {
  if (hostnameExplicitlySet) return args.hostname
  if (mdns && !serverConfig?.hostname) return "0.0.0.0"
  return serverConfig?.hostname ?? args.hostname
}

function resolveCors(args: NetworkOptions, serverConfig: { cors?: string[] } | undefined): string[] {
  const configCors = serverConfig?.cors ?? []
  const argsCors = Array.isArray(args.cors) ? args.cors : args.cors ? [args.cors] : []
  return [...configCors, ...argsCors]
}

export async function resolveNetworkOptions(args: NetworkOptions) {
  const config = await Config.global()
  const portExplicitlySet = process.argv.includes("--port")
  const hostnameExplicitlySet = process.argv.includes("--hostname")
  const mdnsExplicitlySet = process.argv.includes("--mdns")
  const mdnsDomainExplicitlySet = process.argv.includes("--mdns-domain")

  const mdns = mdnsExplicitlySet ? args.mdns : (config?.server?.mdns ?? args.mdns)
  const mdnsDomain = mdnsDomainExplicitlySet ? args["mdns-domain"] : (config?.server?.mdnsDomain ?? args["mdns-domain"])
  const port = portExplicitlySet ? args.port : (config?.server?.port ?? args.port)
  const hostname = resolveHostname(args, config?.server, mdns, hostnameExplicitlySet)
  const cors = resolveCors(args, config?.server)
  const insecureBindBypass = args["i-know-what-im-doing-bind-insecurely"] === true

  return { hostname, port, mdns, mdnsDomain, cors, insecureBindBypass }
}
