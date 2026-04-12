import { NamedError } from "@librecode/util/error"
import { spawn } from "bun"
import z from "zod"
import { BusEvent } from "@/bus/bus-event"
import { Log } from "../util/log"

const SUPPORTED_IDES = [
  { name: "Windsurf" as const, cmd: "windsurf" },
  { name: "Visual Studio Code - Insiders" as const, cmd: "code-insiders" },
  { name: "Visual Studio Code" as const, cmd: "code" },
  { name: "Cursor" as const, cmd: "cursor" },
  { name: "VSCodium" as const, cmd: "codium" },
]

const log = Log.create({ service: "ide" })

const IdeEvent = {
  Installed: BusEvent.define(
    "ide.installed",
    z.object({
      ide: z.string(),
    }),
  ),
}

const IdeAlreadyInstalledError = NamedError.create("AlreadyInstalledError", z.object({}))

const IdeInstallFailedError = NamedError.create(
  "InstallFailedError",
  z.object({
    stderr: z.string(),
  }),
)

function ideDetect() {
  if (process.env.TERM_PROGRAM === "vscode") {
    const v = process.env.GIT_ASKPASS
    for (const ide of SUPPORTED_IDES) {
      if (v?.includes(ide.name)) return ide.name
    }
  }
  return "unknown"
}

function ideAlreadyInstalled() {
  return process.env.LIBRECODE_CALLER === "vscode" || process.env.LIBRECODE_CALLER === "vscode-insiders"
}

async function ideInstall(ide: (typeof SUPPORTED_IDES)[number]["name"]) {
  const cmd = SUPPORTED_IDES.find((i) => i.name === ide)?.cmd
  if (!cmd) throw new Error(`Unknown IDE: ${ide}`)

  const p = spawn([cmd, "--install-extension", "sst-dev.librecode"], {
    stdout: "pipe",
    stderr: "pipe",
  })
  await p.exited
  const stdout = await new Response(p.stdout).text()
  const stderr = await new Response(p.stderr).text()

  log.info("installed", {
    ide,
    stdout,
    stderr,
  })

  if (p.exitCode !== 0) {
    throw new IdeInstallFailedError({ stderr })
  }
  if (stdout.includes("already installed")) {
    throw new IdeAlreadyInstalledError({})
  }
}

export const Ide = {
  Event: IdeEvent,
  AlreadyInstalledError: IdeAlreadyInstalledError,
  InstallFailedError: IdeInstallFailedError,
  ide: ideDetect,
  alreadyInstalled: ideAlreadyInstalled,
  install: ideInstall,
} as const
