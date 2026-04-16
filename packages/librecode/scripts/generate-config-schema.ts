#!/usr/bin/env bun
/**
 * generate-config-schema.ts
 *
 * Generates `schema/config.json` at the repo root from the Zod schema at
 * `packages/librecode/src/config/schema.ts#Info`.
 *
 * Usage (from repo root):
 *   bun packages/librecode/scripts/generate-config-schema.ts
 *
 * Output:
 *   schema/config.json — JSON Schema Draft 2020-12
 *
 * Users reference this in their `.librecode/config.json`:
 *   {
 *     "$schema": "https://raw.githubusercontent.com/techtoboggan/librecode/main/schema/config.json",
 *     ...
 *   }
 *
 * Uses Zod v4's native `z.toJSONSchema()`. (The `zod-to-json-schema` npm package
 * is v3-only and incompatible with Zod v4.)
 */

import { mkdir, writeFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { z } from "zod"
import { Info } from "../src/config/schema"

const __dirname = dirname(fileURLToPath(import.meta.url))
// scripts/ → librecode/ → packages/ → repo root
const REPO_ROOT = resolve(__dirname, "..", "..", "..")
const OUTPUT_DIR = resolve(REPO_ROOT, "schema")
const OUTPUT_PATH = resolve(OUTPUT_DIR, "config.json")

await mkdir(OUTPUT_DIR, { recursive: true })

const schema = z.toJSONSchema(Info, {
  target: "draft-2020-12",
  unrepresentable: "any",
})

// Merge in top-level metadata for better editor integration.
// z.toJSONSchema already sets `$schema`; we extend with $id + title + description.
const final = {
  ...schema,
  $id: "https://raw.githubusercontent.com/techtoboggan/librecode/main/schema/config.json",
  title: "LibreCode Config",
  description: "Schema for .librecode/config.json — LibreCode's project/user configuration file.",
}

await writeFile(OUTPUT_PATH, `${JSON.stringify(final, null, 2)}\n`, "utf-8")

console.log(`Wrote ${OUTPUT_PATH}`)
console.log(`Size: ${(JSON.stringify(final).length / 1024).toFixed(1)} KB`)
