/**
 * v0.9.74 — Agentic Control Panel importer.
 *
 * Imports skills + agents from a curated set of public git repositories
 * (see `sources.ts`) into LibreCode's global config dir
 * (`~/.config/librecode/skills/<name>/SKILL.md` and
 * `~/.config/librecode/agents/<name>.md`).
 *
 * Strategy:
 *   1. Resolve a source by id from the catalog.
 *   2. `git clone --depth 1` into a per-source cache dir under
 *      `~/.cache/librecode/imports/<id>/`. If cache exists, `git pull`
 *      to update.
 *   3. Walk the source's declared `contents.skills` / `contents.agents`
 *      paths, copy matching files into the global config dir under a
 *      `<source-id>/` prefix so multiple sources can't collide.
 *   4. Return a structured manifest of what was imported (counts +
 *      file paths) so the UI can show a "imported N skills, M agents
 *      from <source>" toast.
 *
 * The cache lives under `~/.cache/librecode/` (XDG-compliant) and is
 * safe to delete — re-importing will re-clone.
 */
import { spawn } from "node:child_process"
import { promises as fs } from "node:fs"
import path from "node:path"
import { Global } from "../global"
import { Filesystem } from "../util/filesystem"
import { Glob } from "../util/glob"
import { Log } from "../util/log"
import { findSource, type ImportSource, IMPORT_SOURCES } from "./sources"

const log = Log.create({ service: "importer" })

const IMPORT_CACHE_SUBDIR = "imports"
const IMPORT_CONFIG_PREFIX = "imported"

export interface ImportResult {
  ok: true
  source: { id: string; name: string; repo: string }
  imported: { skills: ImportedFile[]; agents: ImportedFile[] }
}

export interface ImportError {
  ok: false
  source: { id: string }
  error: string
  step: "lookup" | "clone" | "copy"
}

export interface ImportedFile {
  /** Skill / agent name as recorded in the frontmatter. */
  name: string
  /** Absolute path on disk where it landed. */
  path: string
}

/** Cache dir for a given source — clones live here. */
function cacheDirFor(sourceId: string): string {
  return path.join(Global.Path.cache, IMPORT_CACHE_SUBDIR, sourceId)
}

/**
 * Where imported files land in the user's config dir. Each source gets
 * its own subdirectory under `skills/` / `agents/` so re-importing an
 * older source doesn't overwrite a newer one's files. The skill loader
 * walks `~/.config/librecode/skills/**` recursively, so nesting is fine.
 */
export function destDirFor(sourceId: string, kind: "skills" | "agents"): string {
  return path.join(Global.Path.config, kind, IMPORT_CONFIG_PREFIX, sourceId)
}

/**
 * Run a command and resolve with stdout when the exit code is 0.
 * Stdout is captured even on success so callers can debug; on
 * failure we surface the trimmed stderr in the rejection.
 */
function exec(command: string, args: string[], opts: { cwd?: string } = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: opts.cwd,
      stdio: ["ignore", "pipe", "pipe"],
    })
    let stdout = ""
    let stderr = ""
    child.stdout?.on("data", (chunk) => {
      stdout += chunk.toString()
    })
    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString()
    })
    child.on("close", (code) => {
      if (code === 0) resolve(stdout)
      else reject(new Error(stderr.trim() || `${command} exited with code ${code}`))
    })
    child.on("error", reject)
  })
}

/**
 * Clone the source if not yet cached, otherwise `git pull` to refresh.
 * Uses `--depth 1` to keep the cache lean — we never need history.
 */
async function ensureCached(source: ImportSource): Promise<string> {
  const dir = cacheDirFor(source.id)
  const url = `https://github.com/${source.repo}.git`
  const branch = source.branch ?? "main"
  if (await Filesystem.isDir(dir)) {
    log.info("refreshing cached import source", { id: source.id })
    try {
      // Reset any local divergence first — this dir is ours.
      await exec("git", ["fetch", "origin", branch, "--depth", "1"], { cwd: dir })
      await exec("git", ["reset", "--hard", `origin/${branch}`], { cwd: dir })
      return dir
    } catch (err) {
      // If pull fails (e.g. branch renamed, repo moved), wipe and re-clone.
      log.warn("cache refresh failed, re-cloning", { id: source.id, error: String(err) })
      await fs.rm(dir, { recursive: true, force: true })
    }
  }
  log.info("cloning import source", { id: source.id, repo: source.repo })
  await fs.mkdir(path.dirname(dir), { recursive: true })
  await exec("git", ["clone", "--depth", "1", "--branch", branch, url, dir])
  return dir
}

/**
 * Pure: extract `name` from a markdown frontmatter header. Used to
 * record imported files with their actual frontmatter name (which
 * may differ from the directory name). Returns undefined if there's
 * no frontmatter or no `name` key.
 */
export function extractFrontmatterName(text: string): string | undefined {
  if (!text.startsWith("---")) return undefined
  const end = text.indexOf("\n---", 3)
  if (end === -1) return undefined
  const block = text.slice(3, end)
  // Cheap line-by-line YAML parser — we only need `name`. Avoids a
  // yaml dependency for this one field.
  for (const raw of block.split("\n")) {
    const line = raw.trim()
    if (!line || line.startsWith("#")) continue
    const colon = line.indexOf(":")
    if (colon === -1) continue
    const key = line.slice(0, colon).trim()
    if (key !== "name") continue
    let value = line.slice(colon + 1).trim()
    // Strip optional surrounding quotes.
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    if (value.length === 0) return undefined
    return value
  }
  return undefined
}

/** Recursively copy a directory tree, creating dest dirs as needed. */
async function copyTree(src: string, dest: string): Promise<void> {
  await fs.mkdir(dest, { recursive: true })
  const entries = await fs.readdir(src, { withFileTypes: true })
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name)
    const destPath = path.join(dest, entry.name)
    if (entry.isDirectory()) {
      await copyTree(srcPath, destPath)
    } else if (entry.isFile()) {
      await fs.copyFile(srcPath, destPath)
    }
  }
}

/**
 * Copy all `<name>/SKILL.md` directories from `srcDir` into the
 * user's skills config. Returns the list of successfully imported
 * names.
 */
async function importSkills(source: ImportSource, srcDir: string): Promise<ImportedFile[]> {
  if (!source.contents.skills) return []
  const root = path.join(srcDir, source.contents.skills)
  if (!(await Filesystem.isDir(root))) return []
  const dest = destDirFor(source.id, "skills")
  await fs.mkdir(dest, { recursive: true })

  const matches = await Glob.scan("**/SKILL.md", { cwd: root, absolute: true, include: "file" })
  const out: ImportedFile[] = []
  for (const match of matches) {
    const skillRoot = path.dirname(match)
    const skillDirName = path.basename(skillRoot)
    const text = await Filesystem.readText(match).catch(() => undefined)
    const name = (text && extractFrontmatterName(text)) || skillDirName
    const destSkillRoot = path.join(dest, skillDirName)
    await fs.rm(destSkillRoot, { recursive: true, force: true })
    await copyTree(skillRoot, destSkillRoot)
    out.push({ name, path: path.join(destSkillRoot, "SKILL.md") })
  }
  return out
}

/**
 * Copy `*.md` agent files from `srcDir` into the user's agents
 * config. Each file becomes one agent — frontmatter `name` wins; the
 * filename is the fallback.
 */
async function importAgents(source: ImportSource, srcDir: string): Promise<ImportedFile[]> {
  if (!source.contents.agents) return []
  const root = path.join(srcDir, source.contents.agents)
  if (!(await Filesystem.isDir(root))) return []
  const dest = destDirFor(source.id, "agents")
  await fs.mkdir(dest, { recursive: true })

  const matches = await Glob.scan("**/*.md", { cwd: root, absolute: true, include: "file" })
  const out: ImportedFile[] = []
  for (const match of matches) {
    const filename = path.basename(match)
    const text = await Filesystem.readText(match).catch(() => undefined)
    const name = (text && extractFrontmatterName(text)) || path.basename(filename, ".md")
    const destPath = path.join(dest, filename)
    await fs.copyFile(match, destPath)
    out.push({ name, path: destPath })
  }
  return out
}

/**
 * Run a full import for a source: clone (or refresh) + copy skills +
 * copy agents. Errors are reported as a structured `ImportError` so
 * the UI can show the failing step instead of a stack trace.
 */
export async function runImport(sourceId: string): Promise<ImportResult | ImportError> {
  const source = findSource(sourceId)
  if (!source) {
    return { ok: false, source: { id: sourceId }, error: `Unknown source: ${sourceId}`, step: "lookup" }
  }
  let srcDir: string
  try {
    srcDir = await ensureCached(source)
  } catch (err) {
    return {
      ok: false,
      source: { id: sourceId },
      error: err instanceof Error ? err.message : String(err),
      step: "clone",
    }
  }
  try {
    const [skills, agents] = await Promise.all([importSkills(source, srcDir), importAgents(source, srcDir)])
    return {
      ok: true,
      source: { id: source.id, name: source.name, repo: source.repo },
      imported: { skills, agents },
    }
  } catch (err) {
    return {
      ok: false,
      source: { id: sourceId },
      error: err instanceof Error ? err.message : String(err),
      step: "copy",
    }
  }
}

/**
 * Remove all imports from a source — wipes its cache + config dirs.
 * Returns `true` if anything was removed.
 */
export async function removeImport(sourceId: string): Promise<boolean> {
  const cache = cacheDirFor(sourceId)
  const skillDest = destDirFor(sourceId, "skills")
  const agentDest = destDirFor(sourceId, "agents")
  let removed = false
  for (const dir of [cache, skillDest, agentDest]) {
    if (await Filesystem.isDir(dir)) {
      await fs.rm(dir, { recursive: true, force: true })
      removed = true
    }
  }
  return removed
}

export const Importer = {
  sources: () => IMPORT_SOURCES,
  run: runImport,
  remove: removeImport,
  destDirFor,
  extractFrontmatterName,
} as const
