#!/usr/bin/env bun
/**
 * generate-brand.ts — Generate all PNG brand assets from SVG sources
 *
 * Requirements (one-time setup):
 *   pip install cairosvg
 *
 * Usage:
 *   bun scripts/generate-brand.ts
 */

import { execSync, spawnSync } from "child_process"
import { existsSync, mkdirSync } from "fs"
import { join } from "path"

const ROOT = new URL("..", import.meta.url).pathname

function dir(p: string) {
  const full = join(ROOT, p)
  mkdirSync(full, { recursive: true })
  return full
}

// Check cairosvg is available
function ensureCairoSvg() {
  const r = spawnSync("python3", ["-c", "import cairosvg"])
  if (r.status !== 0) {
    console.error("cairosvg not found. Install it:\n  pip install cairosvg\n")
    process.exit(1)
  }
}

function svgToPng(input: string, output: string, width: number, height = width) {
  const py = `import cairosvg; cairosvg.svg2png(url="${input}", write_to="${output}", output_width=${width}, output_height=${height})`
  const r = spawnSync("python3", ["-c", py])
  if (r.status !== 0) {
    console.error(`✗ ${output}\n${r.stderr?.toString()}`)
    return false
  }
  console.log(`✓ ${output.replace(ROOT, "")}`)
  return true
}

ensureCairoSvg()

const brand = dir("assets/brand")
const favicon = dir("assets/favicon")
const social = dir("assets/social")

// ── Full logo lockups ─────────────────────────────────────────────────────────
console.log("\n📐 Full logo lockups")
svgToPng(`${brand}/logo-full-light.svg`, `${brand}/logo-full-light.png`,     1200)
svgToPng(`${brand}/logo-full-light.svg`, `${brand}/logo-full-light@2x.png`,  2400)
svgToPng(`${brand}/logo-full-dark.svg`,  `${brand}/logo-full-dark.png`,      1200)
svgToPng(`${brand}/logo-full-dark.svg`,  `${brand}/logo-full-dark@2x.png`,   2400)

// ── Mark (icon only) ──────────────────────────────────────────────────────────
console.log("\n🔷 Mark variants")
for (const size of [512, 256, 128, 64, 32, 16]) {
  svgToPng(`${brand}/mark-dark.svg`,        `${brand}/mark-dark-${size}.png`,  size)
  svgToPng(`${brand}/mark-light.svg`,       `${brand}/mark-light-${size}.png`, size)
  svgToPng(`${brand}/mark-transparent.svg`, `${brand}/mark-${size}.png`,       size)
}

// ── Favicon set ───────────────────────────────────────────────────────────────
console.log("\n🌐 Favicon set")
svgToPng(`${brand}/mark-dark.svg`, `${favicon}/favicon-16.png`,   16)
svgToPng(`${brand}/mark-dark.svg`, `${favicon}/favicon-32.png`,   32)
svgToPng(`${brand}/mark-dark.svg`, `${favicon}/favicon-48.png`,   48)
svgToPng(`${brand}/mark-dark.svg`, `${favicon}/favicon-192.png`,  192)
svgToPng(`${brand}/mark-dark.svg`, `${favicon}/favicon-512.png`,  512)
svgToPng(`${brand}/mark-dark.svg`, `${favicon}/apple-touch-icon.png`, 180)

// Composite multi-size .ico from individual PNGs using ImageMagick
const icoPngs = [16, 32, 48].map((s) => `${favicon}/favicon-${s}.png`).join(" ")
try {
  execSync(`convert ${icoPngs} ${favicon}/favicon.ico`)
  console.log(`✓ assets/favicon/favicon.ico`)
} catch {
  console.warn("⚠  ImageMagick not available — skipping favicon.ico")
}

// ── Open Graph / Social ───────────────────────────────────────────────────────
// TODO: composite Tater mascot + logo once mascot.svg exists
console.log("\n🖼  Social images (placeholder — add mascot to complete)")
svgToPng(`${brand}/logo-full-dark.svg`, `${social}/og-image.png`,     1200, 630)
svgToPng(`${brand}/logo-full-dark.svg`, `${social}/twitter-card.png`, 1200, 600)

console.log("\n✅ Done. Check assets/ for output.")
console.log("   Next: open assets/brand/logo-full-light.svg in a browser to review,")
console.log("   then adjust bezier curves in the file and re-run this script.")
