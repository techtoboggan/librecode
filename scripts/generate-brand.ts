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
svgToPng(`${brand}/logo-full-light.svg`, `${brand}/logo-full-light.png`, 1200)
svgToPng(`${brand}/logo-full-light.svg`, `${brand}/logo-full-light@2x.png`, 2400)
svgToPng(`${brand}/logo-full-dark.svg`, `${brand}/logo-full-dark.png`, 1200)
svgToPng(`${brand}/logo-full-dark.svg`, `${brand}/logo-full-dark@2x.png`, 2400)

// ── Mark (icon only) ──────────────────────────────────────────────────────────
console.log("\n🔷 Mark variants")
for (const size of [512, 256, 128, 64, 32, 16]) {
  svgToPng(`${brand}/mark-dark.svg`, `${brand}/mark-dark-${size}.png`, size)
  svgToPng(`${brand}/mark-light.svg`, `${brand}/mark-light-${size}.png`, size)
  svgToPng(`${brand}/mark-transparent.svg`, `${brand}/mark-${size}.png`, size)
}

// ── Favicon set ───────────────────────────────────────────────────────────────
console.log("\n🌐 Favicon set")
svgToPng(`${brand}/mark-dark.svg`, `${favicon}/favicon-16.png`, 16)
svgToPng(`${brand}/mark-dark.svg`, `${favicon}/favicon-32.png`, 32)
svgToPng(`${brand}/mark-dark.svg`, `${favicon}/favicon-48.png`, 48)
svgToPng(`${brand}/mark-dark.svg`, `${favicon}/favicon-192.png`, 192)
svgToPng(`${brand}/mark-dark.svg`, `${favicon}/favicon-512.png`, 512)
svgToPng(`${brand}/mark-dark.svg`, `${favicon}/apple-touch-icon.png`, 180)

// Composite multi-size .ico from individual PNGs using ImageMagick
const icoPngs = [16, 32, 48].map((s) => `${favicon}/favicon-${s}.png`).join(" ")
try {
  execSync(`convert ${icoPngs} ${favicon}/favicon.ico`)
  console.log(`✓ assets/favicon/favicon.ico`)
} catch {
  console.warn("⚠  ImageMagick not available — skipping favicon.ico")
}

// ── Tater mascot ─────────────────────────────────────────────────────────────
const tater = dir("assets/tater")
console.log("\n🐵 Tater mascot")
for (const size of [1024, 512, 256]) {
  svgToPng(`${brand}/tater-dark.svg`, `${tater}/tater-dark-${size}.png`, size)
  svgToPng(`${brand}/tater-light.svg`, `${tater}/tater-light-${size}.png`, size)
  svgToPng(`${brand}/tater-transparent.svg`, `${tater}/tater-${size}.png`, size)
}
// Head-only crop at smaller sizes (centered top 50% of the image — the head lives roughly y:110-278)
const headPy = (input: string, output: string, size: number) => {
  const py = `
import cairosvg, io
from PIL import Image
png = cairosvg.svg2png(url="${input}", output_width=${size * 2}, output_height=${size * 2})
img = Image.open(io.BytesIO(png))
# Head is roughly top 55% of the 512-tall canvas: y 110-278 → scale by 2
head = img.crop((${Math.round(0.22 * 2)}, ${Math.round(0.22 * 2)}, ${Math.round(0.78 * 2)}, ${Math.round(0.57 * 2)})).resize((${size}, ${size}), Image.LANCZOS)
head.save("${output}")
`.trim()
  const r = spawnSync("python3", ["-c", py])
  if (r.status !== 0) {
    console.error(`✗ ${output}\n${r.stderr?.toString()}`)
    return false
  }
  console.log(`✓ ${output.replace(ROOT, "")}`)
  return true
}
headPy(`${brand}/tater-transparent.svg`, `${tater}/tater-head-256.png`, 256)
headPy(`${brand}/tater-transparent.svg`, `${tater}/tater-head-128.png`, 128)

// ── Open Graph / Social ───────────────────────────────────────────────────────
console.log("\n🖼  Social images")
svgToPng(`${brand}/logo-full-dark.svg`, `${social}/og-image.png`, 1200, 630)
svgToPng(`${brand}/logo-full-dark.svg`, `${social}/twitter-card.png`, 1200, 600)
// TODO: composite Tater + logo for a richer OG image (requires PIL compositing)

console.log("\n✅ Done. Check assets/ for output.")
