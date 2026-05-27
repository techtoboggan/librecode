# Phase 54 — Tauri-mode E2E (unblock the upstream feature-build panic)

> Self-contained spec for a future focused effort. Phase 53 completed
> the cargo PRODUCTION build fix and the browser-mode E2E hard gate,
> but tauri-mode E2E is BLOCKED by an upstream issue documented here.
> This spec captures the full investigation so the next attempt
> starts from facts, not a cold diagnosis.

---

## 0. RESOLVED — root cause was the missing sidecar, not the plugin

> **Update (v0.10.8):** the §1 blocker is SOLVED. A `-vv` diagnostic on a
> throwaway branch surfaced the swallowed panic:
> `tauri_build::build()` aborts with
> `resource path 'sidecars/librecode-cli-x86_64-unknown-linux-gnu' doesn't exist`.
> `tauri.conf.json`'s `externalBin` requires the CLI sidecar at build time;
> the e2e job never staged it. Local builds passed only because a real
> sidecar lingered in `sidecars/` from prior dev work — the warm-vs-cold
> difference, fully explained. The playwright plugin was a RED HERRING
> through v0.10.0–.6. Reproduced locally (move the sidecar aside → exact
> CI error) and fixed by staging a stub sidecar before the compile-check
> (a stub suffices: `cargo build` only validates the externalBin path
> exists, never executes it). The compile-check is now a HARD gate.

| Piece                                          | State                                                             |
| ---------------------------------------------- | ----------------------------------------------------------------- |
| Browser-mode E2E (Layer 3)                     | ✅ HARD GATE, green, CI-portable (v0.10.5)                        |
| Cargo PRODUCTION build (no feature)            | ✅ Fixed — runtime capability, no static file                     |
| Cargo FEATURE build (`--features e2e-testing`) | ✅ Fixed — stub sidecar staged before compile-check (v0.10.8)     |
| Compile-check CI step                          | ✅ HARD gate (v0.10.8)                                            |
| Tauri-mode E2E (real webview)                  | ⏳ Remaining work — now UNBLOCKED (needs real sidecar + xvfb, §4) |

The rest of this doc (§1–3) is retained as the forensic record of how
the panic was diagnosed. **The only remaining work is §4** (tauri-mode
E2E with a REAL sidecar + xvfb), which is no longer blocked — it just
needs the heavier setup.

---

## 1. The exact blocker

`cargo build --features e2e-testing` (which compiles `tauri-plugin-playwright`
into the app) panics inside `librecode-desktop`'s build script — i.e.
`tauri_build::build()` — on a **fresh** CI runner:

```
error: failed to run custom build command for `librecode-desktop`
Caused by:
  process didn't exit successfully: .../build-script-build (exit status: 101)
  cargo:PERMISSION_FILES_PATH=.../out/app-manifest/__app__-permission-files
  cargo:rerun-if-changed=capabilities
```

Exit 101 = Rust panic. **The panic message is swallowed** — cargo only
shows the directives emitted before the panic, not the panic text.

### Critical facts established in Phase 53

1. It is **NOT** about our capability. Phase 53 removed the static
   `capabilities/e2e-testing.json` entirely (capability is now added at
   runtime via `handle.add_capability(include_str!(...))` in `lib.rs`
   setup). The panic persists with zero static e2e capability.
2. It only happens **with the plugin compiled in** (the feature). The
   production build (no feature) is clean.
3. It only happens on a **cold cargo cache** (fresh CI runner). It does
   NOT reproduce locally — even after
   `cargo clean -p tauri-plugin-playwright -p librecode-desktop`
   - rebuild (passes in ~13s). A warm `~/.cargo/registry` masks it.
4. Therefore it is a `tauri-plugin-playwright@0.2.2` ↔ `tauri_build`
   (Tauri 2.10.x) incompatibility surfaced only by tauri_build's
   permission-manifest aggregation on a truly cold build.

---

## 2. First task: surface the swallowed panic

You can't fix what you can't see. The panic message is the key.

### Option A — make CI print it (cheapest)

In `.github/workflows/e2e.yml`, temporarily change the advisory
compile-check step to capture the panic:

```yaml
- name: Build desktop with e2e-testing feature (DIAGNOSTIC)
  continue-on-error: true
  env:
    LIBRECODE_REGEN_BINDINGS: "0"
    RUST_BACKTRACE: "full"
  run: |
    cd packages/desktop/src-tauri
    # -vv surfaces build-script stdout+stderr; the panic text lives there.
    LIBRECODE_REGEN_BINDINGS=0 cargo build --features e2e-testing -vv 2>&1 | tee /tmp/e2e-build.log || true
    echo "=== build-script stderr ==="
    find target/debug/build -name "stderr" -path "*librecode-desktop*" -exec cat {} \;
```

Push to a throwaway branch, run the e2e workflow once, read the panic.
Do NOT cut a release for this — trigger the workflow on the branch.

### Option B — reproduce locally with a truly cold cache

Destructive + slow (~30 min), but gives the panic on your machine:

```bash
# Back up first if you have other Rust projects sharing the registry.
cargo clean --manifest-path packages/desktop/src-tauri/Cargo.toml
rm -rf ~/.cargo/registry/src/*/tauri-plugin-playwright-0.2.2
rm -rf ~/.cargo/registry/cache/*/tauri-plugin-playwright-0.2.2.crate
RUST_BACKTRACE=full cargo build \
  --manifest-path packages/desktop/src-tauri/Cargo.toml \
  --features e2e-testing -vv
```

If even this doesn't reproduce, the trigger is GH-runner-specific
(glibc, parallel jobsharing, /tmp permissions) and Option A is the
only path.

---

## 3. Likely fixes (try in order once the panic is known)

The panic text will point at one of these. Pre-researched candidates:

1. **Plugin version pin.** `tauri-plugin-playwright` is 0.2.x and
   moving. Try `0.2.0` / `0.2.1` — an earlier permission-manifest
   format may parse cleanly. Pin exact (`= "0.2.1"`).
2. **Permission TOML malformation.** The plugin ships
   `permissions/default.toml` + `permissions/autogenerated/commands/pw_result.toml`.
   If tauri_build rejects one on a fresh parse, vendor a corrected copy
   or file an upstream issue. Inspect:
   `~/.cargo/registry/src/*/tauri-plugin-playwright-0.2.2/permissions/`.
3. **tauri-build version skew.** Ensure `tauri-build` in Cargo.lock
   matches the `tauri` runtime version (2.10.3). A mismatch between the
   build-time ACL schema and the plugin's manifest schema is a classic
   cause.
4. **Switch tooling.** If the plugin can't be made to build on CI,
   pivot tauri-mode to the official `tauri-driver` + WebdriverIO path
   (Tauri's documented E2E). Heavier setup, no embedded plugin, no
   feature-gated capability — sidesteps this class entirely. See the
   research in the chat that produced phase-52-spec.md.

---

## 4. Then: wire tauri-mode E2E (once the build works)

The library plumbing is already understood:

- `createTauriTest({ devUrl, tauriCommand, tauriCwd, tauriFeatures: ["e2e-testing"], ipcMocks })`
  — but note the browser-mode `createTauriTest` hangs on
  `waitForLoadState("networkidle")` (LibreCode holds a live SSE
  connection). The current `fixtures/tauri.ts` deliberately avoids it.
  For tauri mode, either use `TauriProcessManager` directly or confirm
  tauri mode doesn't hit the same networkidle wait.
- Mode selection: the library reads the socket via
  `TAURI_PLAYWRIGHT_SOCKET`; `ProcessConfig.socketPath` defaults to
  `/tmp/tauri-playwright.sock`. The `tauri` Playwright project in
  `playwright.tauri.config.ts` already exists.
- `detach-flow.spec.ts` is the prime beneficiary — it `test.skip`s in
  browser mode (detach requires `platform === "desktop"`). In tauri
  mode it exercises the real second-window open.

### CI (xvfb) shape

```yaml
- name: Build desktop (e2e feature)
  run: cd packages/desktop/src-tauri && cargo build --features e2e-testing
- name: Run E2E — tauri mode
  working-directory: packages/app
  run: |
    sudo Xvfb :99 -ac -screen 0 1280x800x24 &
    export DISPLAY=:99
    sleep 1
    bun run test:e2e:tauri:tauri
  env:
    DISPLAY: ":99"
```

(Use `working-directory:` + bare `bun run` — `bun --cwd … run` is
malformed in bun 1.3.11, the v0.10.0-.1 lesson.)

Budget: the `cargo build --features e2e-testing` adds ~15 min cold.
Cache aggressively (the e2e.yml already caches cargo). Consider gating
tauri-mode to a separate non-release-blocking job until it's proven
stable.

---

## 5. Done-state

- Panic root cause known + fixed (or tooling swapped).
- `cargo build --features e2e-testing` green on fresh CI.
- Compile-check step: `continue-on-error` removed → hard.
- `detach-flow.spec.ts` (and the other 4) pass in tauri mode under
  xvfb in CI.
- ADR-010 updated: Layer 3 runs both browser (every push) and tauri
  (release) modes.

---

## 6. What NOT to do

- Don't make the compile-check a hard gate again until the feature
  build is confirmed green on a fresh runner (the v0.10.6 mistake).
- Don't chase the panic via release-tag push-and-watch — use a
  throwaway branch + the diagnostic step (§2 Option A). Each release
  cycle is ~18 min and the panic is swallowed without `-vv`.
- Don't block the high-value browser-mode gate on tauri-mode progress.
  They're independent.
