import semver from "semver"
import { Log } from "../util/log"
import { Process } from "../util/process"

const log = Log.create({ service: "bun" })

function which() {
  return process.execPath
}

async function packageRegistryInfo(pkg: string, field: string, cwd?: string): Promise<string | null> {
  const { code, stdout, stderr } = await Process.run([which(), "info", pkg, field], {
    cwd,
    env: {
      ...process.env,
      BUN_BE_BUN: "1",
    },
    nothrow: true,
  })

  if (code !== 0) {
    log.warn("bun info failed", { pkg, field, code, stderr: stderr.toString() })
    return null
  }

  const value = stdout.toString().trim()
  if (!value) return null
  return value
}

async function packageRegistryIsOutdated(pkg: string, cachedVersion: string, cwd?: string): Promise<boolean> {
  const latestVersion = await packageRegistryInfo(pkg, "version", cwd)
  if (!latestVersion) {
    log.warn("Failed to resolve latest version, using cached", { pkg, cachedVersion })
    return false
  }

  const isRange = /[\s^~*xX<>|=]/.test(cachedVersion)
  if (isRange) return !semver.satisfies(latestVersion, cachedVersion)

  return semver.lt(cachedVersion, latestVersion)
}

export const PackageRegistry = {
  info: packageRegistryInfo,
  isOutdated: packageRegistryIsOutdated,
} as const
