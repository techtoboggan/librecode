import path from "node:path"
import { buffer } from "node:stream/consumers"
import { NamedError } from "@librecode/util/error"
import z from "zod"
import { BusEvent } from "@/bus/bus-event"
import { iife } from "@/util/iife"
import { Process } from "@/util/process"
import { Flag } from "../flag/flag"
import { Log } from "../util/log"

declare global {
  const LIBRECODE_VERSION: string
  const LIBRECODE_CHANNEL: string
}

const log = Log.create({ service: "installation" })

async function text(cmd: string[], opts: { cwd?: string; env?: NodeJS.ProcessEnv } = {}) {
  return Process.text(cmd, {
    cwd: opts.cwd,
    env: opts.env,
    nothrow: true,
  }).then((x) => x.text)
}

async function upgradeCurl(target: string) {
  const body = await fetch("https://github.com/techtoboggan/librecode/install").then((res) => {
    if (!res.ok) throw new Error(res.statusText)
    return res.text()
  })
  const proc = Process.spawn(["bash"], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      VERSION: target,
    },
  })
  if (!proc.stdin || !proc.stdout || !proc.stderr) throw new Error("Process output not available")
  proc.stdin.end(body)
  const [code, stdout, stderr] = await Promise.all([proc.exited, buffer(proc.stdout), buffer(proc.stderr)])
  return {
    code,
    stdout,
    stderr,
  }
}

export type InstallationMethod = Awaited<ReturnType<typeof installationMethod>>

export const InstallationEvent = {
  Updated: BusEvent.define(
    "installation.updated",
    z.object({
      version: z.string(),
    }),
  ),
  UpdateAvailable: BusEvent.define(
    "installation.update-available",
    z.object({
      version: z.string(),
    }),
  ),
}

export const InstallationInfo = z
  .object({
    version: z.string(),
    latest: z.string(),
  })
  .meta({
    ref: "InstallationInfo",
  })
export type InstallationInfo = z.infer<typeof InstallationInfo>

export async function installationInfo(): Promise<InstallationInfo> {
  return {
    version: INSTALLATION_VERSION,
    latest: await installationLatest(),
  }
}

export function installationIsPreview(): boolean {
  return INSTALLATION_CHANNEL !== "latest"
}

export function installationIsLocal(): boolean {
  return INSTALLATION_CHANNEL === "local"
}

export async function installationMethod() {
  if (process.execPath.includes(path.join(".librecode", "bin"))) return "curl"
  if (process.execPath.includes(path.join(".local", "bin"))) return "curl"
  const exec = process.execPath.toLowerCase()

  const checks = [
    {
      name: "npm" as const,
      command: () => text(["npm", "list", "-g", "--depth=0"]),
    },
    {
      name: "yarn" as const,
      command: () => text(["yarn", "global", "list"]),
    },
    {
      name: "pnpm" as const,
      command: () => text(["pnpm", "list", "-g", "--depth=0"]),
    },
    {
      name: "bun" as const,
      command: () => text(["bun", "pm", "ls", "-g"]),
    },
    {
      name: "brew" as const,
      command: () => text(["brew", "list", "--formula", "librecode"]),
    },
    {
      name: "scoop" as const,
      command: () => text(["scoop", "list", "librecode"]),
    },
    {
      name: "choco" as const,
      command: () => text(["choco", "list", "--limit-output", "librecode"]),
    },
  ]

  checks.sort((a, b) => {
    const aMatches = exec.includes(a.name)
    const bMatches = exec.includes(b.name)
    if (aMatches && !bMatches) return -1
    if (!aMatches && bMatches) return 1
    return 0
  })

  for (const check of checks) {
    const output = await check.command()
    const installedName =
      check.name === "brew" || check.name === "choco" || check.name === "scoop" ? "librecode" : "librecode"
    if (output.includes(installedName)) {
      return check.name
    }
  }

  return "unknown"
}

export const InstallationUpgradeFailedError = NamedError.create(
  "UpgradeFailedError",
  z.object({
    stderr: z.string(),
  }),
)

async function getBrewFormula() {
  const tapFormula = await text(["brew", "list", "--formula", "techtoboggan/tap/librecode"])
  if (tapFormula.includes("librecode")) return "techtoboggan/tap/librecode"
  const coreFormula = await text(["brew", "list", "--formula", "librecode"])
  if (coreFormula.includes("librecode")) return "librecode"
  return "librecode"
}

type RunResult = Awaited<ReturnType<typeof upgradeCurl>>

async function upgradeBrew(env: NodeJS.ProcessEnv): Promise<RunResult> {
  const formula = await getBrewFormula()
  if (formula.includes("/")) {
    const tap = await Process.run(["brew", "tap", "techtoboggan/tap"], { env, nothrow: true })
    if (tap.code !== 0) return tap
    const repo = await Process.text(["brew", "--repo", "techtoboggan/tap"], { env, nothrow: true })
    if (repo.code !== 0) return repo
    const dir = repo.text.trim()
    if (dir) {
      const pull = await Process.run(["git", "pull", "--ff-only"], { cwd: dir, env, nothrow: true })
      if (pull.code !== 0) return pull
    }
  }
  return Process.run(["brew", "upgrade", formula], { env, nothrow: true })
}

async function runUpgrade(method: InstallationMethod, target: string): Promise<RunResult> {
  switch (method) {
    case "curl":
      return upgradeCurl(target)
    case "npm":
      return Process.run(["npm", "install", "-g", `librecode@${target}`], { nothrow: true })
    case "pnpm":
      return Process.run(["pnpm", "install", "-g", `librecode@${target}`], { nothrow: true })
    case "bun":
      return Process.run(["bun", "install", "-g", `librecode@${target}`], { nothrow: true })
    case "brew":
      return upgradeBrew({ HOMEBREW_NO_AUTO_UPDATE: "1", ...process.env })
    case "choco":
      return Process.run(["choco", "upgrade", "librecode", `--version=${target}`, "-y"], { nothrow: true })
    case "scoop":
      return Process.run(["scoop", "install", `librecode@${target}`], { nothrow: true })
    default:
      throw new Error(`Unknown method: ${method}`)
  }
}

export async function installationUpgrade(method: InstallationMethod, target: string): Promise<void> {
  const result = await runUpgrade(method, target)
  if (!result || result.code !== 0) {
    const stderr =
      method === "choco" ? "not running from an elevated command shell" : result?.stderr.toString("utf8") || ""
    throw new InstallationUpgradeFailedError({ stderr })
  }
  log.info("upgraded", {
    method,
    target,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
  })
  await Process.text([process.execPath, "--version"], { nothrow: true })
}

export const INSTALLATION_VERSION = typeof LIBRECODE_VERSION === "string" ? LIBRECODE_VERSION : "local"
export const INSTALLATION_CHANNEL = typeof LIBRECODE_CHANNEL === "string" ? LIBRECODE_CHANNEL : "local"
export const INSTALLATION_USER_AGENT = `librecode/${INSTALLATION_CHANNEL}/${INSTALLATION_VERSION}/${Flag.LIBRECODE_CLIENT}`

export async function installationLatest(installMethod?: InstallationMethod): Promise<string> {
  const detectedMethod = installMethod || (await installationMethod())

  if (detectedMethod === "brew") {
    const formula = await getBrewFormula()
    if (formula.includes("/")) {
      const infoJson = await text(["brew", "info", "--json=v2", formula])
      const info = JSON.parse(infoJson)
      const version = info.formulae?.[0]?.versions?.stable
      if (!version) throw new Error(`Could not detect version for tap formula: ${formula}`)
      return version
    }
    return fetch("https://formulae.brew.sh/api/formula/librecode.json")
      .then((res) => {
        if (!res.ok) throw new Error(res.statusText)
        return res.json()
      })
      .then((data: { versions: { stable: string } }) => data.versions.stable)
  }

  if (detectedMethod === "npm" || detectedMethod === "bun" || detectedMethod === "pnpm") {
    const registry = await iife(async () => {
      const r = (await text(["npm", "config", "get", "registry"])).trim()
      const reg = r || "https://registry.npmjs.org"
      return reg.endsWith("/") ? reg.slice(0, -1) : reg
    })
    const channel = INSTALLATION_CHANNEL
    return fetch(`${registry}/librecode/${channel}`)
      .then((res) => {
        if (!res.ok) throw new Error(res.statusText)
        return res.json()
      })
      .then((data: { version: string }) => data.version)
  }

  if (detectedMethod === "choco") {
    return fetch(
      "https://community.chocolatey.org/api/v2/Packages?$filter=Id%20eq%20%27librecode%27%20and%20IsLatestVersion&$select=Version",
      { headers: { Accept: "application/json;odata=verbose" } },
    )
      .then((res) => {
        if (!res.ok) throw new Error(res.statusText)
        return res.json()
      })
      .then((data: { d: { results: { Version: string }[] } }) => data.d.results[0].Version)
  }

  if (detectedMethod === "scoop") {
    return fetch("https://raw.githubusercontent.com/ScoopInstaller/Main/master/bucket/librecode.json", {
      headers: { Accept: "application/json" },
    })
      .then((res) => {
        if (!res.ok) throw new Error(res.statusText)
        return res.json()
      })
      .then((data: { version: string }) => data.version)
  }

  return fetch("https://api.github.com/repos/techtoboggan/librecode/releases/latest")
    .then((res) => {
      if (!res.ok) throw new Error(res.statusText)
      return res.json()
    })
    .then((data: { tag_name: string }) => data.tag_name.replace(/^v/, ""))
}

export const Installation = {
  Event: InstallationEvent,
  Info: InstallationInfo,
  UpgradeFailedError: InstallationUpgradeFailedError,
  VERSION: INSTALLATION_VERSION,
  CHANNEL: INSTALLATION_CHANNEL,
  USER_AGENT: INSTALLATION_USER_AGENT,
  info: installationInfo,
  isPreview: installationIsPreview,
  isLocal: installationIsLocal,
  method: installationMethod,
  upgrade: installationUpgrade,
  latest: installationLatest,
} as const
