import { networkInterfaces } from "node:os"
import open from "open"
import { Flag } from "../../flag/flag"
import { Server } from "../../server/server"
import { requirePasswordForNonLoopback, resolveNetworkOptions, withNetworkOptions } from "../network"
import { UI } from "../ui"
import { cmd } from "./cmd"

function getNetworkIPs() {
  const nets = networkInterfaces()
  const results: string[] = []

  for (const name of Object.keys(nets)) {
    const net = nets[name]
    if (!net) continue

    for (const netInfo of net) {
      // Skip internal and non-IPv4 addresses
      if (netInfo.internal || netInfo.family !== "IPv4") continue

      // Skip Docker bridge networks (typically 172.x.x.x)
      if (netInfo.address.startsWith("172.")) continue

      results.push(netInfo.address)
    }
  }

  return results
}

export const WebCommand = cmd({
  command: "web",
  builder: (yargs) => withNetworkOptions(yargs),
  describe: "start librecode server and open web interface",
  handler: async (args) => {
    const opts = await resolveNetworkOptions(args)
    // A05 fail-closed — refuse to bind to a non-loopback address without
    // LIBRECODE_SERVER_PASSWORD. Throws InsecureBindError with a remediation
    // hint if the combination is unsafe.
    requirePasswordForNonLoopback({
      hostname: opts.hostname,
      password: Flag.LIBRECODE_SERVER_PASSWORD,
      bypass: opts.insecureBindBypass,
    })
    if (!Flag.LIBRECODE_SERVER_PASSWORD) {
      UI.println(`${UI.Style.TEXT_WARNING_BOLD}!  LIBRECODE_SERVER_PASSWORD is not set; server is bound to loopback only.`)
    }
    const server = Server.listen(opts)
    UI.empty()
    UI.println(UI.logo("  "))
    UI.empty()

    if (opts.hostname === "0.0.0.0") {
      // Show localhost for local access
      const localhostUrl = `http://localhost:${server.port}`
      UI.println(`${UI.Style.TEXT_INFO_BOLD}  Local access:      `, UI.Style.TEXT_NORMAL, localhostUrl)

      // Show network IPs for remote access
      const networkIPs = getNetworkIPs()
      if (networkIPs.length > 0) {
        for (const ip of networkIPs) {
          UI.println(
            `${UI.Style.TEXT_INFO_BOLD}  Network access:    `,
            UI.Style.TEXT_NORMAL,
            `http://${ip}:${server.port}`,
          )
        }
      }

      if (opts.mdns) {
        UI.println(
          `${UI.Style.TEXT_INFO_BOLD}  mDNS:              `,
          UI.Style.TEXT_NORMAL,
          `${opts.mdnsDomain}:${server.port}`,
        )
      }

      // Open localhost in browser
      open(localhostUrl.toString()).catch(() => {})
    } else {
      const displayUrl = server.url.toString()
      UI.println(`${UI.Style.TEXT_INFO_BOLD}  Web interface:    `, UI.Style.TEXT_NORMAL, displayUrl)
      open(displayUrl).catch(() => {})
    }

    await new Promise(() => {})
    await server.stop()
  },
})
