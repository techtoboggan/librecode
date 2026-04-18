import { Flag } from "../../flag/flag"
import { Server } from "../../server/server"
import { requirePasswordForNonLoopback, resolveNetworkOptions, withNetworkOptions } from "../network"
import { cmd } from "./cmd"

export const ServeCommand = cmd({
  command: "serve",
  builder: (yargs) => withNetworkOptions(yargs),
  describe: "starts a headless librecode server",
  handler: async (args) => {
    const opts = await resolveNetworkOptions(args)
    // A05 fail-closed — refuse to bind to a non-loopback address without
    // LIBRECODE_SERVER_PASSWORD.
    requirePasswordForNonLoopback({
      hostname: opts.hostname,
      password: Flag.LIBRECODE_SERVER_PASSWORD,
      bypass: opts.insecureBindBypass,
    })
    if (!Flag.LIBRECODE_SERVER_PASSWORD) {
      console.log("Note: LIBRECODE_SERVER_PASSWORD is not set; server is bound to loopback only.")
    }
    const server = Server.listen(opts)
    console.log(`librecode server listening on http://${server.hostname}:${server.port}`)

    await new Promise(() => {})
    await server.stop()
  },
})
