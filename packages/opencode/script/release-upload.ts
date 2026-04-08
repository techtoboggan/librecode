#!/usr/bin/env bun

/**
 * Uploads built binaries to a GitHub Release.
 *
 * Reads from dist/ directory (output of build.ts), creates archives,
 * and uploads them via `gh release upload`.
 *
 * Environment variables:
 *   GH_REPO   GitHub repository (e.g. "techtoboggan/librecode")
 *
 * Usage:
 *   bun run script/release-upload.ts
 */

import { $ } from "bun"
import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const dir = path.resolve(__dirname, "..")

process.chdir(dir)

import { Script } from "@librecode/script"

const ghRepo = process.env.GH_REPO
if (!ghRepo) {
  console.error("GH_REPO environment variable is required")
  process.exit(1)
}

const distDir = path.join(dir, "dist")
const entries = await fs.promises.readdir(distDir, { withFileTypes: true })
const binaryDirs = entries.filter((e) => e.isDirectory() && e.name.startsWith("librecode-"))

if (binaryDirs.length === 0) {
  console.error("No binaries found in dist/ — run build.ts first")
  process.exit(1)
}

console.log(`Archiving ${binaryDirs.length} binaries for release v${Script.version}`)

for (const entry of binaryDirs) {
  const name = entry.name
  const binDir = path.join(distDir, name, "bin")

  if (name.includes("linux")) {
    console.log(`  tar.gz: ${name}`)
    await $`tar -czf ../../${name}.tar.gz *`.cwd(binDir)
  } else {
    console.log(`  zip: ${name}`)
    await $`zip -r ../../${name}.zip *`.cwd(binDir)
  }
}

console.log(`\nUploading to GitHub Release v${Script.version}...`)
await $`gh release upload v${Script.version} ./dist/*.zip ./dist/*.tar.gz --clobber --repo ${ghRepo}`
console.log("Upload complete")
