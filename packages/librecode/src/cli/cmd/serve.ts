import { Flag } from "../../flag/flag"
import { Server } from "../../server/server"
import { resolveNetworkOptions, withNetworkOptions } from "../network"
import { cmd } from "./cmd"

export const ServeCommand = cmd({
  command: "serve",
  builder: (yargs) => withNetworkOptions(yargs),
  describe: "starts a headless librecode server",
  handler: async (args) => {
    if (!Flag.LIBRECODE_SERVER_PASSWORD) {
      console.log("Warning: LIBRECODE_SERVER_PASSWORD is not set; server is unsecured.")
    }
    const opts = await resolveNetworkOptions(args)
    const server = Server.listen(opts)
    console.log(`librecode server listening on http://${server.hostname}:${server.port}`)

    await new Promise(() => {})
    await server.stop()
  },
})
