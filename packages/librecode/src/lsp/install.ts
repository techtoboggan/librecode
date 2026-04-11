import path from "path"
import fs from "fs/promises"
import { text } from "node:stream/consumers"
import { Global } from "../global"
import { Log } from "../util/log"
import { BunProc } from "../bun"
import { Filesystem } from "../util/filesystem"
import { Instance } from "../project/instance"
import { Flag } from "../flag/flag"
import { Archive } from "../util/archive"
import { Process } from "../util/process"
import { which } from "../util/which"

const log = Log.create({ service: "lsp.server" })

export const pathExists = async (p: string): Promise<boolean> =>
  fs
    .stat(p)
    .then(() => true)
    .catch(() => false)

export const run = (cmd: string[], opts: Process.RunOptions = {}) => Process.run(cmd, { ...opts, nothrow: true })

export async function downloadEslintServer(): Promise<boolean> {
  const serverPath = path.join(Global.Path.bin, "vscode-eslint", "server", "out", "eslintServer.js")
  if (await Filesystem.exists(serverPath)) return true
  if (Flag.LIBRECODE_DISABLE_LSP_DOWNLOAD) return false
  log.info("downloading and building VS Code ESLint server")
  const response = await fetch("https://github.com/microsoft/vscode-eslint/archive/refs/heads/main.zip")
  if (!response.ok) return false

  const zipPath = path.join(Global.Path.bin, "vscode-eslint.zip")
  if (response.body) await Filesystem.writeStream(zipPath, response.body)

  const ok = await Archive.extractZip(zipPath, Global.Path.bin)
    .then(() => true)
    .catch((error) => {
      log.error("Failed to extract vscode-eslint archive", { error })
      return false
    })
  if (!ok) return false
  await fs.rm(zipPath, { force: true })

  const extractedPath = path.join(Global.Path.bin, "vscode-eslint-main")
  const finalPath = path.join(Global.Path.bin, "vscode-eslint")
  const stats = await fs.stat(finalPath).catch(() => undefined)
  if (stats) {
    log.info("removing old eslint installation", { path: finalPath })
    await fs.rm(finalPath, { force: true, recursive: true })
  }
  await fs.rename(extractedPath, finalPath)

  const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm"
  await Process.run([npmCmd, "install"], { cwd: finalPath })
  await Process.run([npmCmd, "run", "compile"], { cwd: finalPath })
  log.info("installed VS Code ESLint server", { serverPath })
  return true
}

export async function resolveLocalOrPathBin(
  root: string,
  nodeTarget: string,
  globalName: string,
): Promise<string | undefined> {
  const localBin = path.join(root, nodeTarget)
  if (await Filesystem.exists(localBin)) return localBin
  const candidates = Filesystem.up({ targets: [nodeTarget], start: root, stop: Instance.worktree })
  const first = await candidates.next()
  await candidates.return()
  if (first.value) return first.value
  return which(globalName) ?? undefined
}

export async function resolveOxlintLspBin(
  root: string,
): Promise<{ bin: string; useLsp: boolean } | undefined> {
  const ext = process.platform === "win32" ? ".cmd" : ""
  const lintTarget = path.join("node_modules", ".bin", "oxlint" + ext)
  const serverTarget = path.join("node_modules", ".bin", "oxc_language_server" + ext)

  const lintBin = await resolveLocalOrPathBin(root, lintTarget, "oxlint")
  if (lintBin) {
    const proc = Process.spawn([lintBin, "--help"], { stdout: "pipe" })
    await proc.exited
    if (proc.stdout) {
      const help = await text(proc.stdout)
      if (help.includes("--lsp")) return { bin: lintBin, useLsp: true }
    }
  }

  const serverBin = await resolveLocalOrPathBin(root, serverTarget, "oxc_language_server")
  if (serverBin) return { bin: serverBin, useLsp: false }
  return undefined
}

export async function resolveTyVenvPython(venvPaths: string[]): Promise<string | undefined> {
  for (const venvPath of venvPaths) {
    const isWindows = process.platform === "win32"
    const pythonPath = isWindows
      ? path.join(venvPath, "Scripts", "python.exe")
      : path.join(venvPath, "bin", "python")
    if (await Filesystem.exists(pythonPath)) return pythonPath
  }
  return undefined
}

export async function resolveTyBinary(venvPaths: string[]): Promise<string | undefined> {
  for (const venvPath of venvPaths) {
    const isWindows = process.platform === "win32"
    const tyPath = isWindows ? path.join(venvPath, "Scripts", "ty.exe") : path.join(venvPath, "bin", "ty")
    if (await Filesystem.exists(tyPath)) return tyPath
  }
  return undefined
}

export async function installElixirLS(): Promise<string | undefined> {
  const binary = path.join(
    Global.Path.bin,
    "elixir-ls-master",
    "release",
    process.platform === "win32" ? "language_server.bat" : "language_server.sh",
  )
  if (await Filesystem.exists(binary)) return binary
  const elixir = which("elixir")
  if (!elixir) {
    log.error("elixir is required to run elixir-ls")
    return undefined
  }
  if (Flag.LIBRECODE_DISABLE_LSP_DOWNLOAD) return undefined
  log.info("downloading elixir-ls from GitHub releases")

  const response = await fetch("https://github.com/elixir-lsp/elixir-ls/archive/refs/heads/master.zip")
  if (!response.ok) return undefined
  const zipPath = path.join(Global.Path.bin, "elixir-ls.zip")
  if (response.body) await Filesystem.writeStream(zipPath, response.body)

  const ok = await Archive.extractZip(zipPath, Global.Path.bin)
    .then(() => true)
    .catch((error) => {
      log.error("Failed to extract elixir-ls archive", { error })
      return false
    })
  if (!ok) return undefined

  await fs.rm(zipPath, { force: true, recursive: true })

  const cwd = path.join(Global.Path.bin, "elixir-ls-master")
  const env = { MIX_ENV: "prod", ...process.env }
  await Process.run(["mix", "deps.get"], { cwd, env })
  await Process.run(["mix", "compile"], { cwd, env })
  await Process.run(["mix", "elixir_ls.release2", "-o", "release"], { cwd, env })
  log.info("installed elixir-ls", { path: path.join(Global.Path.bin, "elixir-ls") })
  return binary
}

function resolveZlsAssetName(): { assetName: string; ext: string } | undefined {
  const platform = process.platform
  const arch = process.arch

  let zlsArch: string = arch
  if (arch === "arm64") zlsArch = "aarch64"
  else if (arch === "x64") zlsArch = "x86_64"
  else if (arch === "ia32") zlsArch = "x86"

  let zlsPlatform: string = platform
  if (platform === "darwin") zlsPlatform = "macos"
  else if (platform === "win32") zlsPlatform = "windows"

  const ext = platform === "win32" ? "zip" : "tar.xz"
  const assetName = `zls-${zlsArch}-${zlsPlatform}.${ext}`

  const supportedCombos = [
    "zls-x86_64-linux.tar.xz",
    "zls-x86_64-macos.tar.xz",
    "zls-x86_64-windows.zip",
    "zls-aarch64-linux.tar.xz",
    "zls-aarch64-macos.tar.xz",
    "zls-aarch64-windows.zip",
    "zls-x86-linux.tar.xz",
    "zls-x86-windows.zip",
  ]
  if (!supportedCombos.includes(assetName)) {
    log.error(`Platform ${platform} and architecture ${arch} is not supported by zls`)
    return undefined
  }
  return { assetName, ext }
}

async function extractZlsArchive(tempPath: string, ext: string): Promise<boolean> {
  if (ext === "zip") {
    return Archive.extractZip(tempPath, Global.Path.bin)
      .then(() => true)
      .catch((error) => {
        log.error("Failed to extract zls archive", { error })
        return false
      })
  }
  await run(["tar", "-xf", tempPath], { cwd: Global.Path.bin })
  return true
}

export async function downloadZls(): Promise<string | undefined> {
  const zig = which("zig")
  if (!zig) {
    log.error("Zig is required to use zls. Please install Zig first.")
    return undefined
  }
  if (Flag.LIBRECODE_DISABLE_LSP_DOWNLOAD) return undefined
  log.info("downloading zls from GitHub releases")

  const resolved = resolveZlsAssetName()
  if (!resolved) return undefined
  const { assetName, ext } = resolved

  const releaseResponse = await fetch("https://api.github.com/repos/zigtools/zls/releases/latest")
  if (!releaseResponse.ok) {
    log.error("Failed to fetch zls release info")
    return undefined
  }

  const release = (await releaseResponse.json()) as { assets?: { name?: string; browser_download_url?: string }[] }
  const asset = (release.assets ?? []).find((a) => a.name === assetName)
  if (!asset) {
    log.error(`Could not find asset ${assetName} in latest zls release`)
    return undefined
  }

  const downloadResponse = await fetch(asset.browser_download_url!)
  if (!downloadResponse.ok) {
    log.error("Failed to download zls")
    return undefined
  }

  const tempPath = path.join(Global.Path.bin, assetName)
  if (downloadResponse.body) await Filesystem.writeStream(tempPath, downloadResponse.body)

  const ok = await extractZlsArchive(tempPath, ext)
  await fs.rm(tempPath, { force: true })
  if (!ok) return undefined

  const platform = process.platform
  const bin = path.join(Global.Path.bin, "zls" + (platform === "win32" ? ".exe" : ""))
  if (!(await Filesystem.exists(bin))) {
    log.error("Failed to extract zls binary")
    return undefined
  }
  if (platform !== "win32") await fs.chmod(bin, 0o755).catch(() => {})
  log.info("installed zls", { bin })
  return bin
}

export async function findClangdBin(): Promise<string | undefined> {
  const fromPath = which("clangd")
  if (fromPath) return fromPath

  const ext = process.platform === "win32" ? ".exe" : ""
  const direct = path.join(Global.Path.bin, "clangd" + ext)
  if (await Filesystem.exists(direct)) return direct

  const entries = await fs.readdir(Global.Path.bin, { withFileTypes: true }).catch(() => [])
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    if (!entry.name.startsWith("clangd_")) continue
    const candidate = path.join(Global.Path.bin, entry.name, "bin", "clangd" + ext)
    if (await Filesystem.exists(candidate)) return candidate
  }
  return undefined
}

function resolveClangdAsset(
  tag: string,
  assets: { name?: string; browser_download_url?: string }[],
): { name: string; browser_download_url: string } | undefined {
  const platform = process.platform
  const tokens: Record<string, string> = { darwin: "mac", linux: "linux", win32: "windows" }
  const token = tokens[platform]
  if (!token) {
    log.error(`Platform ${platform} is not supported by clangd auto-download`)
    return undefined
  }
  const valid = (item: { name?: string; browser_download_url?: string }) =>
    !!(item.name && item.browser_download_url && item.name.includes(token) && item.name.includes(tag))
  const asset =
    assets.find((item) => valid(item) && item.name?.endsWith(".zip")) ??
    assets.find((item) => valid(item) && item.name?.endsWith(".tar.xz")) ??
    assets.find((item) => valid(item))
  if (!asset?.name || !asset.browser_download_url) {
    log.error("clangd could not match release asset", { tag, platform })
    return undefined
  }
  return asset as { name: string; browser_download_url: string }
}

async function extractClangdArchive(archive: string, name: string): Promise<boolean> {
  const zip = name.endsWith(".zip")
  const tar = name.endsWith(".tar.xz")
  if (!zip && !tar) {
    log.error("clangd encountered unsupported asset", { asset: name })
    return false
  }
  if (zip) {
    const ok = await Archive.extractZip(archive, Global.Path.bin)
      .then(() => true)
      .catch((error) => {
        log.error("Failed to extract clangd archive", { error })
        return false
      })
    if (!ok) return false
  }
  if (tar) await run(["tar", "-xf", archive], { cwd: Global.Path.bin })
  return true
}

export async function downloadClangd(): Promise<string | undefined> {
  if (Flag.LIBRECODE_DISABLE_LSP_DOWNLOAD) return undefined
  log.info("downloading clangd from GitHub releases")

  const releaseResponse = await fetch("https://api.github.com/repos/clangd/clangd/releases/latest")
  if (!releaseResponse.ok) {
    log.error("Failed to fetch clangd release info")
    return undefined
  }

  const release: { tag_name?: string; assets?: { name?: string; browser_download_url?: string }[] } =
    await releaseResponse.json()
  const tag = release.tag_name
  if (!tag) {
    log.error("clangd release did not include a tag name")
    return undefined
  }

  const asset = resolveClangdAsset(tag, release.assets ?? [])
  if (!asset) return undefined

  const downloadResponse = await fetch(asset.browser_download_url)
  if (!downloadResponse.ok) {
    log.error("Failed to download clangd")
    return undefined
  }

  const archive = path.join(Global.Path.bin, asset.name)
  const buf = await downloadResponse.arrayBuffer()
  if (buf.byteLength === 0) {
    log.error("Failed to write clangd archive")
    return undefined
  }
  await Filesystem.write(archive, Buffer.from(buf))

  const ok = await extractClangdArchive(archive, asset.name)
  await fs.rm(archive, { force: true })
  if (!ok) return undefined

  const platform = process.platform
  const ext = platform === "win32" ? ".exe" : ""
  const bin = path.join(Global.Path.bin, "clangd_" + tag, "bin", "clangd" + ext)
  if (!(await Filesystem.exists(bin))) {
    log.error("Failed to extract clangd binary")
    return undefined
  }

  if (platform !== "win32") await fs.chmod(bin, 0o755).catch(() => {})
  await fs.unlink(path.join(Global.Path.bin, "clangd")).catch(() => {})
  await fs.symlink(bin, path.join(Global.Path.bin, "clangd")).catch(() => {})
  log.info("installed clangd", { bin })
  return bin
}

export function jdtlsPlatformConfigDir(): string {
  switch (process.platform) {
    case "darwin":
      return "config_mac"
    case "win32":
      return "config_win"
    default:
      return "config_linux"
  }
}

export async function downloadJdtls(distPath: string): Promise<boolean> {
  const launcherDir = path.join(distPath, "plugins")
  if (await pathExists(launcherDir)) return true
  if (Flag.LIBRECODE_DISABLE_LSP_DOWNLOAD) return false
  log.info("Downloading JDTLS LSP server.")
  await fs.mkdir(distPath, { recursive: true })
  const releaseURL =
    "https://www.eclipse.org/downloads/download.php?file=/jdtls/snapshots/jdt-language-server-latest.tar.gz"
  const archiveName = "release.tar.gz"
  log.info("Downloading JDTLS archive", { url: releaseURL, dest: distPath })
  const download = await fetch(releaseURL)
  if (!download.ok || !download.body) {
    log.error("Failed to download JDTLS", { status: download.status, statusText: download.statusText })
    return false
  }
  await Filesystem.writeStream(path.join(distPath, archiveName), download.body)
  log.info("Extracting JDTLS archive")
  const tarResult = await run(["tar", "-xzf", archiveName], { cwd: distPath })
  if (tarResult.code !== 0) {
    log.error("Failed to extract JDTLS", { exitCode: tarResult.code, stderr: tarResult.stderr.toString() })
    return false
  }
  await fs.rm(path.join(distPath, archiveName), { force: true })
  log.info("JDTLS download and extraction completed")
  return true
}

function resolveKotlinLSCombo(): { kotlinPlatform: string; kotlinArch: string } | undefined {
  const platform = process.platform
  const arch = process.arch

  let kotlinArch: string = arch
  if (arch === "arm64") kotlinArch = "aarch64"
  else if (arch === "x64") kotlinArch = "x64"

  let kotlinPlatform: string = platform
  if (platform === "darwin") kotlinPlatform = "mac"
  else if (platform === "linux") kotlinPlatform = "linux"
  else if (platform === "win32") kotlinPlatform = "win"

  const supportedCombos = ["mac-x64", "mac-aarch64", "linux-x64", "linux-aarch64", "win-x64", "win-aarch64"]
  if (!supportedCombos.includes(`${kotlinPlatform}-${kotlinArch}`)) {
    log.error(`Platform ${platform}/${arch} is not supported by Kotlin LSP`)
    return undefined
  }
  return { kotlinPlatform, kotlinArch }
}

export async function downloadKotlinLS(distPath: string): Promise<boolean> {
  if (Flag.LIBRECODE_DISABLE_LSP_DOWNLOAD) return false
  log.info("Downloading Kotlin Language Server from GitHub.")

  const combo = resolveKotlinLSCombo()
  if (!combo) return false

  const releaseResponse = await fetch("https://api.github.com/repos/Kotlin/kotlin-lsp/releases/latest")
  if (!releaseResponse.ok) {
    log.error("Failed to fetch kotlin-lsp release info")
    return false
  }

  const release = (await releaseResponse.json()) as { name?: string }
  const version = release.name?.replace(/^v/, "")
  if (!version) {
    log.error("Could not determine Kotlin LSP version from release")
    return false
  }

  const { kotlinPlatform, kotlinArch } = combo
  const assetName = `kotlin-lsp-${version}-${kotlinPlatform}-${kotlinArch}.zip`
  const releaseURL = `https://download-cdn.jetbrains.com/kotlin-lsp/${version}/${assetName}`

  await fs.mkdir(distPath, { recursive: true })
  const archivePath = path.join(distPath, "kotlin-ls.zip")
  const download = await fetch(releaseURL)
  if (!download.ok || !download.body) {
    log.error("Failed to download Kotlin Language Server", { status: download.status, statusText: download.statusText })
    return false
  }
  await Filesystem.writeStream(archivePath, download.body)
  const ok = await Archive.extractZip(archivePath, distPath)
    .then(() => true)
    .catch((error) => {
      log.error("Failed to extract Kotlin LS archive", { error })
      return false
    })
  if (!ok) return false
  await fs.rm(archivePath, { force: true })
  const launcherScript =
    process.platform === "win32" ? path.join(distPath, "kotlin-lsp.cmd") : path.join(distPath, "kotlin-lsp.sh")
  if (process.platform !== "win32") await fs.chmod(launcherScript, 0o755).catch(() => {})
  log.info("Installed Kotlin Language Server", { path: launcherScript })
  return true
}

function resolveLuaLSAssetSuffix(): { lualsPlatform: string; lualsArch: string; ext: string } | undefined {
  const platform = process.platform
  const arch = process.arch

  let lualsArch: string = arch
  if (arch === "arm64") lualsArch = "arm64"
  else if (arch === "x64") lualsArch = "x64"
  else if (arch === "ia32") lualsArch = "ia32"

  let lualsPlatform: string = platform
  if (platform === "darwin") lualsPlatform = "darwin"
  else if (platform === "linux") lualsPlatform = "linux"
  else if (platform === "win32") lualsPlatform = "win32"

  const ext = platform === "win32" ? "zip" : "tar.gz"
  const supportedCombos = [
    "darwin-arm64.tar.gz",
    "darwin-x64.tar.gz",
    "linux-x64.tar.gz",
    "linux-arm64.tar.gz",
    "win32-x64.zip",
    "win32-ia32.zip",
  ]
  if (!supportedCombos.includes(`${lualsPlatform}-${lualsArch}.${ext}`)) {
    log.error(`Platform ${platform} and architecture ${arch} is not supported by lua-language-server`)
    return undefined
  }
  return { lualsPlatform, lualsArch, ext }
}

async function installLuaLSBin(bin: string, platform: string): Promise<string | undefined> {
  if (!(await Filesystem.exists(bin))) {
    log.error("Failed to extract lua-language-server binary")
    return undefined
  }
  if (platform !== "win32") {
    const ok = await fs
      .chmod(bin, 0o755)
      .then(() => true)
      .catch((error: unknown) => {
        log.error("Failed to set executable permission for lua-language-server binary", { error })
        return false
      })
    if (!ok) return undefined
  }
  log.info("installed lua-language-server", { bin })
  return bin
}

async function extractLuaLS(tempPath: string, installDir: string, ext: string): Promise<boolean> {
  if (ext === "zip") {
    return Archive.extractZip(tempPath, installDir)
      .then(() => true)
      .catch((error) => {
        log.error("Failed to extract lua-language-server archive", { error })
        return false
      })
  }
  return run(["tar", "-xzf", tempPath, "-C", installDir])
    .then((result) => result.code === 0)
    .catch((error: unknown) => {
      log.error("Failed to extract lua-language-server archive", { error })
      return false
    })
}

export async function downloadLuaLS(): Promise<string | undefined> {
  if (Flag.LIBRECODE_DISABLE_LSP_DOWNLOAD) return undefined
  log.info("downloading lua-language-server from GitHub releases")

  const resolved = resolveLuaLSAssetSuffix()
  if (!resolved) return undefined
  const { lualsPlatform, lualsArch, ext } = resolved

  const releaseResponse = await fetch("https://api.github.com/repos/LuaLS/lua-language-server/releases/latest")
  if (!releaseResponse.ok) {
    log.error("Failed to fetch lua-language-server release info")
    return undefined
  }

  const release = (await releaseResponse.json()) as {
    tag_name?: string
    assets?: { name?: string; browser_download_url?: string }[]
  }
  const assetName = `lua-language-server-${release.tag_name}-${lualsPlatform}-${lualsArch}.${ext}`

  const asset = (release.assets ?? []).find((a) => a.name === assetName)
  if (!asset) {
    log.error(`Could not find asset ${assetName} in latest lua-language-server release`)
    return undefined
  }

  const downloadResponse = await fetch(asset.browser_download_url!)
  if (!downloadResponse.ok) {
    log.error("Failed to download lua-language-server")
    return undefined
  }

  const tempPath = path.join(Global.Path.bin, assetName)
  if (downloadResponse.body) await Filesystem.writeStream(tempPath, downloadResponse.body)

  const installDir = path.join(Global.Path.bin, `lua-language-server-${lualsArch}-${lualsPlatform}`)
  const stats = await fs.stat(installDir).catch(() => undefined)
  if (stats) await fs.rm(installDir, { force: true, recursive: true })
  await fs.mkdir(installDir, { recursive: true })

  const extracted = await extractLuaLS(tempPath, installDir, ext)
  await fs.rm(tempPath, { force: true })
  if (!extracted) return undefined

  const platform = process.platform
  const bin = path.join(installDir, "bin", "lua-language-server" + (platform === "win32" ? ".exe" : ""))
  return installLuaLSBin(bin, platform)
}

export async function downloadTerraformLS(): Promise<string | undefined> {
  if (Flag.LIBRECODE_DISABLE_LSP_DOWNLOAD) return undefined
  log.info("downloading terraform-ls from HashiCorp releases")

  const releaseResponse = await fetch("https://api.releases.hashicorp.com/v1/releases/terraform-ls/latest")
  if (!releaseResponse.ok) {
    log.error("Failed to fetch terraform-ls release info")
    return undefined
  }

  const release = (await releaseResponse.json()) as {
    version?: string
    builds?: { arch?: string; os?: string; url?: string }[]
  }

  const platform = process.platform
  const arch = process.arch
  const tfArch = arch === "arm64" ? "arm64" : "amd64"
  const tfPlatform = platform === "win32" ? "windows" : platform

  const builds = release.builds ?? []
  const build = builds.find((b) => b.arch === tfArch && b.os === tfPlatform)
  if (!build?.url) {
    log.error(`Could not find build for ${tfPlatform}/${tfArch} terraform-ls release version ${release.version}`)
    return undefined
  }

  const downloadResponse = await fetch(build.url)
  if (!downloadResponse.ok) {
    log.error("Failed to download terraform-ls")
    return undefined
  }

  const tempPath = path.join(Global.Path.bin, "terraform-ls.zip")
  if (downloadResponse.body) await Filesystem.writeStream(tempPath, downloadResponse.body)

  const ok = await Archive.extractZip(tempPath, Global.Path.bin)
    .then(() => true)
    .catch((error) => {
      log.error("Failed to extract terraform-ls archive", { error })
      return false
    })
  if (!ok) return undefined
  await fs.rm(tempPath, { force: true })

  const bin = path.join(Global.Path.bin, "terraform-ls" + (platform === "win32" ? ".exe" : ""))
  if (!(await Filesystem.exists(bin))) {
    log.error("Failed to extract terraform-ls binary")
    return undefined
  }
  if (platform !== "win32") await fs.chmod(bin, 0o755).catch(() => {})
  log.info("installed terraform-ls", { bin })
  return bin
}

async function extractTexLabArchive(tempPath: string, ext: string): Promise<boolean> {
  if (ext === "zip") {
    return Archive.extractZip(tempPath, Global.Path.bin)
      .then(() => true)
      .catch((error) => {
        log.error("Failed to extract texlab archive", { error })
        return false
      })
  }
  await run(["tar", "-xzf", tempPath], { cwd: Global.Path.bin })
  return true
}

function resolveTexLabAssetName(): { assetName: string; ext: string } {
  const platform = process.platform
  const arch = process.arch
  const texArch = arch === "arm64" ? "aarch64" : "x86_64"
  const texPlatform = platform === "darwin" ? "macos" : platform === "win32" ? "windows" : "linux"
  const ext = platform === "win32" ? "zip" : "tar.gz"
  return { assetName: `texlab-${texArch}-${texPlatform}.${ext}`, ext }
}

async function fetchAndExtractTexLab(assetName: string, ext: string): Promise<boolean> {
  const asset = await (async () => {
    const response = await fetch("https://api.github.com/repos/latex-lsp/texlab/releases/latest")
    if (!response.ok) {
      log.error("Failed to fetch texlab release info")
      return undefined
    }
    const release = (await response.json()) as {
      tag_name?: string
      assets?: { name?: string; browser_download_url?: string }[]
    }
    const version = release.tag_name?.replace("v", "")
    if (!version) {
      log.error("texlab release did not include a version tag")
      return undefined
    }
    const found = (release.assets ?? []).find((a) => a.name === assetName)
    if (!found?.browser_download_url) {
      log.error(`Could not find asset ${assetName} in texlab release`)
      return undefined
    }
    return found
  })()
  if (!asset) return false

  const downloadResponse = await fetch(asset.browser_download_url!)
  if (!downloadResponse.ok) {
    log.error("Failed to download texlab")
    return false
  }

  const tempPath = path.join(Global.Path.bin, assetName)
  if (downloadResponse.body) await Filesystem.writeStream(tempPath, downloadResponse.body)

  const ok = await extractTexLabArchive(tempPath, ext)
  await fs.rm(tempPath, { force: true })
  return ok
}

export async function downloadTexLab(): Promise<string | undefined> {
  if (Flag.LIBRECODE_DISABLE_LSP_DOWNLOAD) return undefined
  log.info("downloading texlab from GitHub releases")

  const { assetName, ext } = resolveTexLabAssetName()
  const ok = await fetchAndExtractTexLab(assetName, ext)
  if (!ok) return undefined

  const platform = process.platform
  const bin = path.join(Global.Path.bin, "texlab" + (platform === "win32" ? ".exe" : ""))
  if (!(await Filesystem.exists(bin))) {
    log.error("Failed to extract texlab binary")
    return undefined
  }
  if (platform !== "win32") await fs.chmod(bin, 0o755).catch(() => {})
  log.info("installed texlab", { bin })
  return bin
}

function resolveTinymistPlatform(): { tinymistPlatform: string; ext: string } {
  const platform = process.platform
  if (platform === "darwin") return { tinymistPlatform: "apple-darwin", ext: "tar.gz" }
  if (platform === "win32") return { tinymistPlatform: "pc-windows-msvc", ext: "zip" }
  return { tinymistPlatform: "unknown-linux-gnu", ext: "tar.gz" }
}

async function extractTinymistArchive(tempPath: string, ext: string): Promise<boolean> {
  if (ext === "zip") {
    return Archive.extractZip(tempPath, Global.Path.bin)
      .then(() => true)
      .catch((error) => {
        log.error("Failed to extract tinymist archive", { error })
        return false
      })
  }
  await run(["tar", "-xzf", tempPath, "--strip-components=1"], { cwd: Global.Path.bin })
  return true
}

export async function downloadTinymist(): Promise<string | undefined> {
  if (Flag.LIBRECODE_DISABLE_LSP_DOWNLOAD) return undefined
  log.info("downloading tinymist from GitHub releases")

  const response = await fetch("https://api.github.com/repos/Myriad-Dreamin/tinymist/releases/latest")
  if (!response.ok) {
    log.error("Failed to fetch tinymist release info")
    return undefined
  }

  const release = (await response.json()) as {
    tag_name?: string
    assets?: { name?: string; browser_download_url?: string }[]
  }
  const arch = process.arch
  const tinymistArch = arch === "arm64" ? "aarch64" : "x86_64"
  const { tinymistPlatform, ext } = resolveTinymistPlatform()
  const assetName = `tinymist-${tinymistArch}-${tinymistPlatform}.${ext}`

  const asset = (release.assets ?? []).find((a) => a.name === assetName)
  if (!asset?.browser_download_url) {
    log.error(`Could not find asset ${assetName} in tinymist release`)
    return undefined
  }

  const downloadResponse = await fetch(asset.browser_download_url)
  if (!downloadResponse.ok) {
    log.error("Failed to download tinymist")
    return undefined
  }

  const tempPath = path.join(Global.Path.bin, assetName)
  if (downloadResponse.body) await Filesystem.writeStream(tempPath, downloadResponse.body)

  const ok = await extractTinymistArchive(tempPath, ext)
  await fs.rm(tempPath, { force: true })
  if (!ok) return undefined

  const platform = process.platform
  const bin = path.join(Global.Path.bin, "tinymist" + (platform === "win32" ? ".exe" : ""))
  if (!(await Filesystem.exists(bin))) {
    log.error("Failed to extract tinymist binary")
    return undefined
  }
  if (platform !== "win32") await fs.chmod(bin, 0o755).catch(() => {})
  log.info("installed tinymist", { bin })
  return bin
}

export { BunProc, Global, Filesystem, Instance, Flag, Process, which, log }
