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

// Step 4: Click into the dev project from the splash
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

1. **Every phase-specific check returns its expected result.** If a
   check returns differently, STOP the phase — investigate before
   shipping. Don't dismiss as "probably a dev-mode quirk."
2. **No new console.error categories.** Pre-existing noise
   (global-sdk SSE) is acceptable. Anything new is a blocker.
3. **No screenshot timeout** in itself is not a blocker — Solid's
   reactive root sometimes pauses the rendering loop in ways that
   confuse the screenshot tool. Use `preview_snapshot` (a11y tree)
   or `preview_eval` for state checks. Screenshots are
   nice-to-have, not required.
4. **Cleanup**: at the end of the smoke, restore any localStorage
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
