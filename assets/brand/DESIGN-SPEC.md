# LibreCode Design Spec — Asset Generation Guide

> Reference image: The LC monogram logo with flowing calligraphic letterforms,
> teal-to-navy gradient, code symbols ({}, </>), binary streams (010101),
> birds in flight, on warm cream background. Tagline: "FREE SOFTWARE. MODERN CODE."

---

## Master Color Palette (exact-match from reference)

| Swatch | Hex | Usage |
|--------|-----|-------|
| Bright teal | `#2DD4A8` | Gradient start, highlights, LC top strokes |
| Mid teal | `#0D9488` | Primary brand, LC body, code symbols |
| Deep teal | `#0A7E76` | LC shadow strokes, depth |
| Slate blue | `#1E6CA0` | Gradient end, C letterform lower half |
| Navy | `#15476C` | Darkest gradient stop, bird silhouettes |
| Dark navy | `#0F3451` | Deep accents, hover states |
| Cream bg | `#F5F0E8` | Light mode background (from reference) |
| Warm white | `#FAFAF7` | Card surfaces on light mode |
| Near black | `#0A0B0D` | Dark mode background |
| Card dark | `#12141A` | Dark mode card surfaces |
| Gold amber | `#D4A017` | Mascot fur, warm accents |
| Light gold | `#FBBF24` | Mascot highlights, badges |

### Gradient definitions

```
Brand gradient:     135deg, #2DD4A8 → #0D9488 → #1E6CA0
Hero gradient:      135deg, #2DD4A8 → #15476C
Warm accent:        135deg, #FBBF24 → #0D9488
Text gradient:      135deg, #5FE0C0 → #3B82B8 (lighter, for headings on dark bg)
```

---

## Asset 1: Logo — Full lockup

**What it is:** The LC monogram + wordmark + tagline (as shown in reference image).

### Variants needed

| Variant | Background | Format | Sizes |
|---------|-----------|--------|-------|
| `logo-full-light` | Cream `#F5F0E8` | SVG + PNG | 1200w, 600w, 300w |
| `logo-full-dark` | Near black `#0A0B0D` | SVG + PNG | 1200w, 600w, 300w |
| `logo-full-transparent` | Transparent | SVG + PNG | 1200w, 600w |

### Style spec

- **Letterforms:** Flowing calligraphic/script style, NOT geometric sans. The L and C intertwine. The L has a long descending tail that loops under the C. The C is open and sweeping.
- **Gradient direction:** Top-left bright teal (`#2DD4A8`) flowing to bottom-right navy (`#15476C`), following the stroke direction of each letter.
- **Code symbols:** `{}` sits in the lower-left between L and C strokes, `</>` sits in the right inside the C curve. Both rendered in a clean monospace weight, same gradient as letters but slightly more translucent (80% opacity).
- **Binary streams:** `010101` rendered in small monospace text, flowing along the ribbon/swoosh paths of the letters. Three streams — one curving up-right from the L, one along the C's upper arc, one along the bottom loop. Color: mid teal `#0D9488` at 60% opacity.
- **Birds:** 2-3 simple angular bird silhouettes (like check marks / seagull shapes) flying up and to the right from the top of the monogram. Filled with navy `#15476C` to dark teal `#0A7E76`. Decreasing size and opacity as they get further.
- **Wordmark:** "LIBRECODE" below the monogram. "LIBRE" in dark navy `#15476C`, "CODE" in mid teal `#0D9488`. Font: Inter Bold or similar geometric sans, heavy weight, tight letter-spacing.
- **Tagline:** "FREE SOFTWARE. MODERN CODE." below the wordmark. Font: Inter Semibold, smaller, generous letter-spacing (0.15em), color: slate `#4A5568`.

### SDXL / Flux prompt (for raster concept)

```
Prompt: elegant calligraphic logo design, intertwined flowing script letters "L" and "C",
teal #0D9488 to navy blue #15476C gradient following stroke direction, code symbols curly
braces and angle brackets integrated into the letterforms, small binary numbers 010101
flowing along curved ribbon paths, two small angular bird silhouettes flying upward from
the top, warm cream #F5F0E8 background, clean professional software brand logo, vector
illustration style, no other text, centered composition

Negative: photographic, 3d render, realistic, blurry, busy background, human, face,
multiple logos, watermark, signature, text below

Settings: 1024x512 (2:1), CFG 7-8, steps 35-40, sampler DPM++ 2M Karras
```

### For Illustrator / Figma / Inkscape manual creation

1. Start with the L — draw a flowing script L with a long descending tail that extends right
2. The C wraps around, its upper arm reaching up and right, its lower arm curving under
3. The tail of the L and bottom of the C should intertwine in a loop
4. Apply gradient along stroke paths (not a flat gradient overlay)
5. Place `{}` and `</>` at ~60-80% opacity within negative spaces
6. Draw binary text along bezier paths that follow the letter curves
7. Add 2-3 bird shapes (simple V/chevron forms) above top-right
8. Export with and without the wordmark/tagline below

---

## Asset 2: Logo Mark — Icon only

**What it is:** Just the LC monogram, no wordmark or tagline. For favicons, nav bars, app icons.

### Variants needed

| Variant | Background | Format | Sizes |
|---------|-----------|--------|-------|
| `mark-transparent` | Transparent | SVG + PNG | 512, 256, 128, 64, 32, 16 |
| `mark-dark` | `#0A0B0D` rounded rect | SVG + PNG | 512, 256, 128 |
| `mark-light` | `#F5F0E8` rounded rect | SVG + PNG | 512, 256, 128 |

### Style spec

- Same LC monogram as the full logo, but cropped tight
- At small sizes (32px, 16px), simplify: drop binary streams and code symbols, keep only the letter strokes and gradient
- For app icon variants, place on a rounded rectangle (28px radius at 128px) with appropriate background
- The gradient and intertwining must still read at 32x32

### SDXL prompt

```
Prompt: minimal monogram logo icon, intertwined calligraphic "L" and "C" letters in
flowing script style, teal #0D9488 to navy #15476C gradient, clean vector illustration,
square format, transparent background, software brand icon, simple and elegant

Negative: text, tagline, background, photographic, complex, busy, realistic, 3d

Settings: 1024x1024, CFG 7, steps 30
```

---

## Asset 3: Mascot — Tater

**What it is:** A winged monkey holding a potato (tater). The project mascot.

### Character spec

- **Species:** Small monkey (capuchin proportions — big head, small body, long curly tail)
- **Fur color:** Golden amber `#D4A017` body, lighter `#FBBF24` belly/face, darker `#B8860B` extremities
- **Wings:** Layered feathered wings, colored with the brand gradient — bright teal `#2DD4A8` outer feathers graduating to navy `#15476C` inner/lower feathers. Wings should spread upward and slightly back.
- **Pose:** Standing upright, holding a small potato to their chest with both hands/paws. Friendly, slightly mischievous expression. Big round eyes.
- **Potato (Tater):** Small, oval, brown `#92400E` to `#D4A017`, with optional cute kawaii face (two dot eyes, small smile)
- **Tail:** Long, curled, extending to the left
- **Style:** Clean cartoon illustration — flat shading with subtle gradients, visible outlines optional. Think mascot-grade quality (like the Go gopher, Rust crab, or Zig's ziggy). NOT chibi/anime.
- **Sparkle:** Small 4-point star accent in bottom-right or near a wing tip, color `#A0A0A8`

### Variants needed

| Variant | Background | Format | Sizes |
|---------|-----------|--------|-------|
| `tater-dark` | Near black `#0A0B0D` | PNG | 1024, 512, 256 |
| `tater-light` | Cream `#F5F0E8` | PNG | 1024, 512, 256 |
| `tater-transparent` | Transparent | PNG | 1024, 512, 256 |
| `tater-head` | Transparent | PNG | 256, 128 (head only, for small contexts) |

### SDXL / Flux prompt

```
Prompt: cute cartoon winged monkey mascot, full body standing upright, golden amber fur,
teal #0D9488 to navy blue #15476C gradient feathered wings spread upward, holding a small
potato with a cute face, long curly tail extending left, big round friendly eyes, clean
flat illustration style with subtle shading, centered composition, dark background #0A0B0D,
professional software mascot design similar to golang gopher style, small sparkle accent
near wing, no text

Negative: realistic, photographic, anime, chibi, blurry, text, watermark, multiple
characters, complex background, gradient background, human

Settings: 1024x1024, CFG 7-8, steps 35-40, sampler DPM++ 2M Karras
```

### For light background variant, change:

```
Replace: dark background #0A0B0D
With: warm cream background #F5F0E8, soft shadow beneath character
```

### For transparent variant:

Generate on solid green (#00FF00) background, then remove background in post.

---

## Asset 4: Favicon

**What it is:** The LC mark optimized for tiny sizes.

| File | Size | Format |
|------|------|--------|
| `favicon.ico` | 16x16, 32x32, 48x48 | ICO (multi-size) |
| `favicon.svg` | Scalable | SVG |
| `apple-touch-icon.png` | 180x180 | PNG |
| `favicon-192.png` | 192x192 | PNG |
| `favicon-512.png` | 512x512 | PNG |

Use `mark-dark` (LC on `#0A0B0D` rounded rect) as the source.

---

## Asset 5: Open Graph / Social

| File | Size | Usage |
|------|------|-------|
| `og-image.png` | 1200x630 | Link previews |
| `twitter-card.png` | 1200x600 | Twitter/X cards |

### Layout spec

- Background: gradient from `#0A0B0D` to `#12141A`
- Left side: Tater mascot at ~40% height
- Center-right: LibreCode full logo (light version, no background)
- Bottom: tagline "Free Software. Modern Code." in `#6B7280`
- Subtle radial glow of teal `#0D9488` at 10% opacity behind the logo

---

## File placement

```
assets/
  brand/
    logo-full-light.svg        # Full lockup on cream
    logo-full-light.png
    logo-full-dark.svg          # Full lockup on dark
    logo-full-dark.png
    logo-full-transparent.svg   # Full lockup, no bg
    logo-full-transparent.png
    mark-transparent.svg        # LC icon only
    mark-dark.svg               # LC icon on dark rounded rect
    mark-light.svg              # LC icon on cream rounded rect
    mark-*.png                  # PNG sizes: 512, 256, 128, 64, 32, 16
    tokens.css                  # Design tokens (exists)
    BRAND.md                    # Brand guide (exists)
    DESIGN-SPEC.md              # This file
  mascot/
    tater-dark.png              # Mascot on dark bg
    tater-light.png             # Mascot on cream bg
    tater-transparent.png       # Mascot, no bg
    tater-head.png              # Head crop for small contexts
  social/
    og-image.png                # Open Graph image
    twitter-card.png            # Twitter card image
  favicon/
    favicon.ico
    favicon.svg
    apple-touch-icon.png
    favicon-192.png
    favicon-512.png
```

---

## Recommended generation workflow

1. **Logo in Recraft.ai** — upload your reference image, ask it to vectorize/recreate. Recraft outputs real SVG. Iterate on colors with the hex values above.
2. **Mascot in SDXL/Flux** — use the prompt above, generate several variants, pick the best. Run through remove.bg for transparent version.
3. **Favicon** — take the mark SVG from step 1, run through [realfavicongenerator.net](https://realfavicongenerator.net) to get the full favicon package.
4. **OG image** — composite in Figma or Canva using the generated assets.

Once you have the files, drop them into the paths above and I'll wire everything into the sites, README, and Tauri configs.
