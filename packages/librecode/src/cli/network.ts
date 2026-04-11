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

  return { hostname, port, mdns, mdnsDomain, cors }
}
