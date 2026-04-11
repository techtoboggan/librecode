import { Auth } from "../../../auth"
import * as prompts from "@clack/prompts"
import { Process } from "../../../util/process"
import { text } from "node:stream/consumers"

export async function loginWithUrl(url: string): Promise<void> {
  const normalized = url.replace(/\/+$/, "")
  const wellknown = await fetch(`${normalized}/.well-known/librecode`).then((x) => x.json() as any)
  prompts.log.info(`Running \`${wellknown.auth.command.join(" ")}\``)
  const proc = Process.spawn(wellknown.auth.command, { stdout: "pipe" })
  if (!proc.stdout) {
    prompts.log.error("Failed")
    prompts.outro("Done")
    return
  }
  const [exit, token] = await Promise.all([proc.exited, text(proc.stdout)])
  if (exit !== 0) {
    prompts.log.error("Failed")
    prompts.outro("Done")
    return
  }
  await Auth.set(normalized, {
    type: "wellknown",
    key: wellknown.auth.env,
    token: token.trim(),
  })
  prompts.log.success("Logged into " + normalized)
  prompts.outro("Done")
}
