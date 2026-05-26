# Preview-smoke template

> Reusable smoke-test recipe for any phase that ships UI changes.
> Adopted v0.9.91 after Phase 49 shipped a broken bindings.ts because
> Sonnet only ran `bun run typecheck` from `packages/app/` (clean) and
> never validated the running app. CI caught it but only after the
> tag was pushed, requiring a v0.9.90→v0.9.91 fix-forward and a
> separate v0.9.91 dock-visibility hotfix when the Phase 48 visibility
> default was found broken in real use.
>
> Every phase spec that touches UI **must** include a §Preview smoke
> section listing concrete `mcp__Claude_Preview__preview_eval`
> assertions tied to the phase's changes. The executor runs this
> AFTER local typecheck + tests pass but BEFORE pushing to main.

---

## 1. Why this exists

Three failure modes the smoke catches that unit tests don't:

1. **Type-bindings regressions** (Phase 49 case): generated code is
   correct from one package's perspective but breaks consumers.
   Root-level typecheck catches it; smoke catches the next category.
2. **Default-state oversights** (Phase 48→91 case): unit tests assert
   logic but not "what does the user see on first launch?" The
   smoke renders the app and verifies the visible default.
3. **Runtime wiring gaps**: contexts, providers, route mounts, and
   IPC subscriptions can all be correctly written in isolation but
   wired incorrectly together. The smoke exercises real mounting.

Out of scope for the smoke:

- Real LLM interactions (no auth, no API quota burn).
- Actual Tauri multi-window (web preview can't do this — needs the
  `bun run dev:desktop` path with eyes-on).
- macOS/Windows-specific rendering (Linux dev only; smoke is a
  per-developer signal, not a cross-platform replacement for CI).

---

## 2. Launch config

`.claude/launch.json` must have these two entries (add them if
absent — they're already in main as of v0.9.91):

```jsonc
{
  "name": "librecode-cli",
  "runtimeExecutable": "bun",
  "runtimeArgs": ["run", "--cwd", "packages/librecode", "--conditions=browser", "src/index.ts", "serve"],
  "port": 4096,
},
{
  "name": "librecode-web",
  "runtimeExecutable": "bun",
  "runtimeArgs": ["--cwd", "packages/app", "dev"],
  "port": 3000,
},
```

The CLI provides the backend (`/session`, `/mcp/*`, `/event` SSE).
The web preview is the SolidJS UI built for the browser. Together
they cover everything in the production desktop build EXCEPT
Tauri-specific IPC.

---

## 3. Standard setup pattern

Run this before each phase's smoke checks:

```ts
// Step 1: Start both servers
mcp__Claude_Preview__preview_start({ name: "librecode-cli" })
mcp__Claude_Preview__preview_start({ name: "librecode-web" })

// Step 2: Capture serverId of the web preview (call it WEB_ID)

// Step 3: Confirm CLI is up
mcp__Claude_Preview__preview_logs({ serverId: CLI_ID, lines: 5 })
// Expect: "librecode server listening on http://127.0.0.1:4096"

// Step 4: MANDATORY — resize to a realistic desktop viewport. The preview
// default is 710x710, which is BELOW the md:768px breakpoint and triggers
// the mobile layout. Tristan's v0.9.95 dock-off-screen bug shipped because
// smoke ran at 710px (where the layout collapses differently than desktop).
// Always test the actual layout users will hit.
mcp__Claude_Preview__preview_resize({ serverId: WEB_ID, preset: "desktop" })
// or: { width: 1280, height: 800 } for explicit control

// Step 5: Click into the dev project from the splash
mcp__Claude_Preview__preview_eval({
  serverId: WEB_ID,
  expression: `
    (() => {
      const btn = [...document.querySelectorAll('button')].find(b => b.textContent.includes('~/Projects/librecode'))
      btn?.click()
      return { clicked: !!btn, url: location.href }
    })()
  `,
})

// Step 6: MANDATORY — screenshot the baseline state.
mcp__Claude_Preview__preview_screenshot({ serverId: WEB_ID })
// Look at it. Does the layout look right? Is the dock visible? Is content
// where you expect? `preview_eval` checks DOM properties but won't catch
// layout overflow, z-index stacking, or content clipped past viewport.
// Tristan's v0.9.95 bug had dockDisplay:"flex" + dockRect:{x:1279,w:320}
// — passes a DOM assertion ("dock is visible") but the actual content
// lives 1px from the right edge then extends 319px off-screen. Only a
// screenshot reveals this.
// Expect URL to change to /[base64-encoded-path]/session
```

After this, the page is in the session view with the dock visible
(post-v0.9.91). All subsequent phase-specific smoke assertions
proceed from this state.

---

## 4. Phase-specific assertions

Each phase spec includes a §Preview smoke section listing the exact
`preview_eval` expressions to run, paired with expected outputs.
Keep them small and self-contained — one assertion per check,
named after what it proves.

### Pattern: "this DOM element exists and has these properties"

```ts
mcp__Claude_Preview__preview_eval({
  serverId: WEB_ID,
  expression: `
    (() => {
      const el = document.querySelector('[data-testid="phase-X-element"]')
      return {
        found: !!el,
        attrs: el && {
          role: el.getAttribute('role'),
          ariaLabel: el.getAttribute('aria-label'),
          classList: el.className,
        },
      }
    })()
  `,
})
```

### Pattern: "this user action triggers expected behavior"

```ts
// Trigger the action
mcp__Claude_Preview__preview_eval({
  serverId: WEB_ID,
  expression: `document.querySelector('[data-testid="trigger"]')?.click(); 'clicked'`,
})

// Then assert the resulting DOM state
mcp__Claude_Preview__preview_eval({
  serverId: WEB_ID,
  expression: `
    (() => {
      const result = document.querySelector('[data-testid="result"]')
      return { rendered: !!result, text: result?.textContent }
    })()
  `,
})
```

### Pattern: "force this persisted state, then verify rendering"

```ts
mcp__Claude_Preview__preview_eval({
  serverId: WEB_ID,
  expression: `
    (() => {
      const key = Object.keys(localStorage).find(k => k.includes('app-dock-state'))
      const state = JSON.parse(localStorage.getItem(key))
      state.entries.forEach(e => { e.detached = true })  // example
      localStorage.setItem(key, JSON.stringify(state))
      return { patched: state.entries.length }
    })()
  `,
})
mcp__Claude_Preview__preview_eval({
  serverId: WEB_ID,
  expression: `location.reload(); 'reloaded'`,
})
// Then assert
```

### Pattern: "this layout fits in the viewport"

Always check this after any change that adds/removes/resizes a
right-anchored sibling (dock, side panel, terminal). The bug in
v0.9.95 (dock 319px off-screen) ONLY shows up via screenshot or
bounding-rect math against viewport width.

```ts
mcp__Claude_Preview__preview_eval({
  serverId: WEB_ID,
  expression: `
    (() => {
      const dock = document.querySelector('[data-testid="app-dock"]')
      const sidePanel = document.querySelector('aside[aria-label="Review and files"]')
      const dockRect = dock?.getBoundingClientRect()
      const panelRect = sidePanel?.getBoundingClientRect()
      const overflow = dockRect ? Math.max(0, dockRect.right - window.innerWidth) : 0
      return {
        viewport: window.innerWidth,
        dock: dockRect && { x: dockRect.left, w: dockRect.width, right: dockRect.right },
        sidePanel: panelRect && { x: panelRect.left, w: panelRect.width, right: panelRect.right },
        overflow,
      }
    })()
  `,
})
// Expected: overflow === 0. Anything > 0 is a layout bug.
// ALWAYS pair this with a preview_screenshot to confirm visually.
```

### Pattern: "console is clean of NEW errors"

```ts
mcp__Claude_Preview__preview_console_logs({
  serverId: WEB_ID,
  level: "error",
  lines: 30,
})
// Expected: only known pre-existing errors (currently:
// "[global-sdk] event stream error" — predates the overhaul,
// dev-mode SSE artifact). No new errors attributable to the phase.
```

---

## 5. Verdict rules

For the smoke to pass:

1. **Resize to desktop viewport BEFORE running any check.** The
   preview default (710×710) is below md:768px and triggers the
   mobile layout codepath. Tristan's v0.9.95 bug was invisible
   under-768 because the dock got hidden by `<Show
when={isDesktop()}>` gating. Use `preview_resize({ preset:
"desktop" })` or explicit `{ width: 1280, height: 800 }`.
2. **Every phase-specific check returns its expected result.** If a
   check returns differently, STOP the phase — investigate before
   shipping. Don't dismiss as "probably a dev-mode quirk."
3. **MANDATORY screenshot at baseline + after every state change.**
   `preview_eval` checks DOM attributes; only `preview_screenshot`
   reveals layout overflow, off-viewport content, z-index issues,
   and "I clicked it but nothing changed" UX bugs. The v0.9.95
   dock-off-screen bug had `dockDisplay: "flex"` (eval would
   pass) but the dock rendered 319px past the viewport edge
   (screenshot would catch immediately). **No screenshot at a
   key visual state = the smoke didn't actually verify anything
   visual.**
4. **For any layout change**: run the "this layout fits in the
   viewport" check from §4 — assert `overflow === 0` AND
   screenshot to confirm no clipped content.
5. **No new console.error categories.** Pre-existing noise
   (global-sdk SSE) is acceptable. Anything new is a blocker.
6. **No screenshot timeout** is not a blocker — Solid's reactive
   root sometimes pauses the rendering loop. Use
   `preview_snapshot` (a11y tree) as a fallback for state, but
   you STILL need at least one successful screenshot at a key
   visual checkpoint to call the smoke done.
7. **Cleanup**: at the end of the smoke, restore any localStorage
   you mutated and stop both preview servers via `preview_stop`.

---

## 6. Reporting the smoke result

In the phase trip report, include a Smoke section:

```
| Smoke check | Result |
|---|---|
| Setup (servers up, project entered) | ✅ |
| <Phase-specific check 1>             | ✅ |
| <Phase-specific check 2>             | ✅ |
| Console new-error scan               | ✅ / details |
```

If a check failed and you fixed-and-retried, document both:

```
| Phase-specific check N | ❌ first run — <symptom>; ✅ after fix in commit <SHA> |
```

---

## 7. When to skip the smoke

There are two legitimate cases:

1. **Pure refactor / non-UI changes**: if the diff touches no
   `packages/app/src/` files and no Rust UI code, the smoke adds
   no signal. Note "smoke skipped — no UI surface" in the report.
2. **Genuinely no UI affordance**: a backend-only feature with no
   user-visible component. Still rare — most features eventually
   surface somewhere.

Never skip because "the unit tests cover it" or "I tested locally."
The smoke covers a different layer.

---

## 8. Adding a new launch config entry

If a future phase requires another running service (e.g. a marketplace
mock server), add a new entry to `.claude/launch.json`:

```jsonc
{
  "name": "librecode-marketplace-mock",
  "runtimeExecutable": "bun",
  "runtimeArgs": ["run", "scripts/mock-marketplace.ts"],
  "port": 4200,
}
```

Document the addition in that phase's spec under § "Launch config
additions."

---

## 10. Regression coverage

> Added Phase 52 Sub-A. Every production bug that shipped on or before
> v0.9.97 has a regression test in one of the three layers. Layer 2 smoke
> is documented here for the bugs it specifically catches.

The bugs from v0.9.88–v0.9.97 and which layer now prevents them:

| Bug                                                         | Version     | Layer that catches it                  | Test file                                              |
| ----------------------------------------------------------- | ----------- | -------------------------------------- | ------------------------------------------------------ |
| Dock invisible after Phase 48 (`hidden` default shipped)    | v0.9.88     | Layer 1 (unit)                         | `app-dock/dock-visibility-upgrade.test.ts`             |
| Stale `hidden` persisted after v0.9.91 upgrade              | v0.9.91→.94 | Layer 1 (unit)                         | `app-dock/dock-visibility-upgrade.test.ts`             |
| Timeline "TypeError: Load failed" (raw fetch bypasses auth) | v0.9.94     | Layer 1 (static audit)                 | `fetch-auth-audit.test.ts`                             |
| Dock off-screen at desktop viewport (smoke ran at 710px)    | v0.9.95     | Layer 2 (smoke §3 resize + screenshot) | (visual — use `preview_resize` + `preview_screenshot`) |
| 4 other raw-fetch auth bypass sites                         | v0.9.95     | Layer 1 (static audit)                 | `fetch-auth-audit.test.ts`                             |
| Phase 49 Tauri detach unverifiable                          | v0.9.96     | Layer 3 (tauri-playwright, Phase 52C)  | `e2e/tauri/detach-flow.spec.ts`                        |

### Layer 2 smoke-specific regressions

The smoke's desktop viewport requirement (§3 step 4) and mandatory
screenshot rule (§5 rule 3) together catch the "dock off-screen at
1280×800" class. Every smoke run that resizes to desktop and screenshots
the session view is validating this regression.

Explicit Layer 2 smoke checks to run after any dock/side-panel layout
change:

```ts
// Verify no horizontal overflow of dock or side panel
mcp__Claude_Preview__preview_eval({
  serverId: WEB_ID,
  expression: `
    (() => {
      const dock = document.querySelector('[data-testid="app-dock"]')
      const dockRect = dock?.getBoundingClientRect()
      return {
        viewport: window.innerWidth,
        dock: dockRect && { x: dockRect.left, w: dockRect.width, right: dockRect.right },
        overflow: dockRect ? Math.max(0, dockRect.right - window.innerWidth) : 0,
      }
    })()
  `,
})
// Expected: overflow === 0
mcp__Claude_Preview__preview_screenshot({ serverId: WEB_ID })
// Look at it: dock must be fully inside the viewport at 1280px width.
```

---

## 9. Known limitations

- **EventSource reconnects fail loudly in dev**: the
  `[global-sdk] event stream error` log appears repeatedly in web
  mode because the dev server proxy doesn't keep SSE connections
  open cleanly. Not a regression; predates the overhaul.
- **No real authentication**: the CLI dev server runs unauthenticated
  on loopback. Don't test auth flows here.
- **No persistent project state**: the dev CLI discovers the current
  project from cwd. If you need a clean slate, the smoke setup
  always starts from `~/Projects/librecode`.
- **No Tauri APIs**: `window.__TAURI__` is undefined. `usePlatform()`
  returns `platform: "web"`. Anything gated on `platform === "desktop"`
  won't be exercised — use a separate Tauri smoke (eyes-on) for those.
