# Phase 48 — Tab strip cleanup + drop legacy MCP code

> Self-contained execution spec for the next Sonnet worker.
> Phase 48 of the MCP-Apps overhaul (`docs/plans/mcp-apps-overhaul-roadmap.md`).
> Lands on top of Phase 47 (v0.9.87, shipped). Targets **v0.9.88**.

---

## 0. Why this phase exists

Phases 42–47 built the App Dock and validated it side-by-side with the
legacy "pinned MCP apps in the session tab strip" path. By Phase 47 the
dock is feature-complete enough that the legacy path is dead weight:

- The Apps tab is only shown when `dockEnabled() === false` (Phase 45).
- Pinned MCP apps are only rendered in the session tab strip when
  `dockEnabled() === false` (this phase deletes those branches).
- The `forceMount + opacity:0 + position:absolute` overlay hack
  (`session-side-panel.tsx` lines 465–508) exists ONLY to keep pinned
  app iframes alive across tab switches. The dock manages its own
  iframe lifecycle and doesn't need this trick.

Two things have to happen together for the deletion to be safe:

1. **Flip the default.** `experimental.app_dock` becomes default-on
   (was implicit `undefined` → falsy). Users who don't set it now get
   the dock automatically. Phase 51 will remove the flag entirely;
   Phase 48 just changes the default and keeps the escape hatch.
2. **Delete the legacy branches.** Once the dock is default-on, the
   `<Show when={!dockEnabled()}>` branches become "render only if the
   user explicitly opts OUT of the dock." That makes them legitimately
   dead in steady state — and the file-size pressure on
   `session-side-panel.tsx` (currently 669 lines, target ≤500) demands
   we delete them and extract the file-tree panel into its own
   component.

Net effect: every user with no config override gets the dock; the
session tab strip becomes session-scoped again (Review, Timeline,
Context, files, port previews — nothing else).

---

## 1. Done-state walkthrough

After Phase 48 ships at **v0.9.88**:

1. User on a fresh install opens LibreCode. Their session view shows
   the agent thread on the left, Review/Timeline/Context/files in a
   clean tab strip, **and the App Dock on the right is visible by
   default with the "+ Add" empty state**. The `experimental.app_dock`
   flag is omitted from their `librecode.jsonc` — they get the dock
   anyway because the schema default is now `true`.
2. User who had `"experimental": { "app_dock": true }` set sees no
   change — they were already on the dock path.
3. User who had `"experimental": { "app_dock": false }` set explicitly
   sees **no Apps tab and no pinned MCP app tabs** — those legacy
   surfaces are gone. They also see no MCP apps anywhere (no dock, no
   tabs). This is intentional: opting out of the dock means opting out
   of MCP apps entirely. A migration note in the release notes calls
   this out.
4. User who had pinned apps in the old tab-strip model: their pinned
   list seeds the dock via the existing `use-dock-state.tsx`
   `pinnedApps` snapshot path (no new migration code needed —
   Phase 44/45 already wired this).
5. `packages/app/src/pages/session/session-side-panel.tsx` is **≤500
   lines** (currently 669). The file-tree right-side panel has been
   extracted to `session-file-tree-panel.tsx` for clean separation.
6. `packages/app/src/components/session/session-header.tsx` no longer
   has a dead `tabs().open("mcp-app:...")` call after `pinnedApps.pin(...)`.
   The Start menu / dock add-handler is the only MCP add path now.
7. The `forceMount + opacity:0` overlay hack is gone. iframe lifecycle
   in the session view is no longer tangled with tab visibility.
8. `mcpTabValue` helper, `mcp-app:` filter in `sortableFileTabs`, and
   the `fallbackActive` pinned-app branch are all deleted.

---

## 2. Scope

### In scope

- Flip `experimental.app_dock` schema default → `true`.
- Delete all legacy MCP-pinned-app rendering from
  `session-side-panel.tsx`.
- Delete the legacy `tabs().open("mcp-app:...")` call from
  `session-header.tsx`. Keep the `pinnedApps.pin(...)` call (it seeds
  the dock).
- Extract right-pane file-tree section into
  `session-file-tree-panel.tsx`.
- Update / add tests to cover both the deletion (negative assertions)
  and the extracted component.
- ADR-009 changelog entry for Phase 48.
- PLAN.md entry for Phase 48.
- Release notes / CHANGELOG entry calling out the default flip and the
  "opt-out = no MCP apps" implication.
- Version bump 0.9.87 → 0.9.88 across all packages.

### Out of scope

- Removing the `experimental.app_dock` flag entirely (that's Phase 51).
- Touching the Start menu pin handler in `start-menu.tsx` (already
  migrated in Phase 45).
- Tauri detach windows (Phase 49).
- Performance/a11y polish (Phase 50).
- Any changes to `pinned-apps.tsx` context — the dock currently relies
  on it; Phase 51 will retire it.

---

## 3. Constraints

### CLAUDE.md non-negotiables

- **No semicolons**, **120 char line width**, **named exports only**,
  **explicit return types** on exported functions.
- **TypeScript strict** — no `any`. Use `unknown` + narrowing.
- **Cyclomatic complexity ≤ 12** per function. **File length ≤ 1000**;
  Phase 48's whole point is dropping under 500.
- **TDD**: write failing test, see it fail, fix code, see it pass.
- **No `export namespace`** in new code.

### ADR-006 (Suspense / startTransition) — danger zone

`session-side-panel.tsx` is already in the lint allow-list as
`pages/session/**` is a danger-zone glob. After Phase 48:

- The `startTransition(() => openTab(value))` in the Tabs `onChange`
  handler **stays**. It's still needed because legitimately slow tab
  switches (Review with large diffs, Timeline on long sessions) can
  trigger Suspense in the activity grid resource. Don't remove it.
- The Phase 45 `createEffect` redirecting `activeTab() === "apps"` to
  `"activity"` (lines 218–222 in the current file) becomes
  unreachable: with the dock default-on, no user creates a state with
  `activeTab() === "apps"` again. **You can delete this effect.**
  Add a one-line comment in the commit message noting that any stored
  legacy `"apps"` tab value will gracefully no-op (Kobalte Tabs falls
  back to the first available trigger when the requested value has no
  match).
- The new `session-file-tree-panel.tsx` doesn't introduce any
  `createResource` calls; the file-tree state comes from the existing
  `useFile()` and `useLayout()` contexts, which are mount-time stable.
  No ADR-006 lint annotation needed.

### File-size target

- `session-side-panel.tsx` MUST end up ≤500 lines after this phase.
  Current = 669. Pure deletion gets ~579. Extracting the file-tree
  panel (~95 lines) lands ~484. That's the budget.
- `session-file-tree-panel.tsx` will be ~110 lines (95 lines of
  extracted content + module header + named export wrapper).
- If you can't get under 500 with just the file-tree extraction, the
  fallback is to also extract the empty-state `<Tabs.Content
value="empty">` block (currently lines 526–537) into a small
  `<SessionEmptyTab />` component. Only do this if needed.

---

## 4. Files to modify

### 4a. `packages/librecode/src/config/schema.ts` — flip default

Current (line 700, you must verify the exact line after rebasing):

```ts
app_dock: z.boolean().optional().describe("Enable the experimental App Dock for MCP apps. Phase 42 prototype."),
```

After Phase 48:

```ts
app_dock: z
  .boolean()
  .optional()
  .default(true)
  .describe(
    "App Dock for MCP apps. Default-on as of v0.9.88 (Phase 48). " +
      "Setting this to false hides the dock and removes MCP apps from the session entirely — " +
      "use only if you specifically don't want MCP apps in this workspace.",
  ),
```

**Verify the consumer logic still works.** In
`session-side-panel.tsx`, `app-dock/dock.tsx`, and `activity-grid.tsx`,
the read pattern is `sync.data.config?.experimental?.app_dock === true`.
With a Zod default of `true`, the parsed config always has the field
set, so `=== true` still works. Run `grep -rn "experimental?.app_dock\|experimental.app_dock"
packages/app packages/librecode` after the change to confirm no consumer
uses `?? false` semantics that would break the default flip.

**Regenerate the config JSON schema.** Run:

```bash
bun run build:schema
```

Commit both the schema.ts edit AND the regenerated
`schema/config.json` in the same commit.

### 4b. `packages/app/src/pages/session/session-side-panel.tsx` — large deletion + extraction

Read the file first (it's 669 lines). The structure as of v0.9.87:

| Lines   | What                                                                 |
| ------- | -------------------------------------------------------------------- |
| 1–44    | Imports                                                              |
| 46–61   | Component signature + contexts                                       |
| 62–73   | `dockEnabled()`, pinned-apps state, `mcpTabValue` helper             |
| 74–93   | Port discovery (keep)                                                |
| 95–166  | Layout memos + helpers (keep)                                        |
| 167–183 | `normalizeTab`, `openReviewPanel`, `openTab` (keep)                  |
| 185–211 | `tabState` + `sortableFileTabs` (modify)                             |
| 213–222 | Phase 45 stale-apps redirect effect (delete)                         |
| 224–279 | Drag handlers + handoff (keep)                                       |
| 281–296 | Aside wrapper opening (keep)                                         |
| 297–443 | Left review/tabs column with Tabs.List (modify — delete apps + pins) |
| 444–567 | Tabs content panes (modify — delete apps + pinned + overlay div)     |
| 569–664 | Right file-tree panel (EXTRACT to new file)                          |
| 665–669 | Closing tags                                                         |

**Deletions inside `session-side-panel.tsx`:**

1. **Line 72** — `mcpTabValue` helper. Delete.
2. **Lines 196–199** — `fallbackActive` body. Simplify to
   `fallbackActive: () => undefined` OR remove the prop entirely if
   `createSessionTabs` accepts that. Verify the signature in
   `pages/session/helpers.ts` — if `fallbackActive` is optional, drop
   the prop; otherwise pass `() => undefined`.
3. **Line 210** — Remove the `!tab.startsWith("mcp-app:")` clause:

   ```ts
   const sortableFileTabs = createMemo(() => openedTabs().filter((tab) => !tab.startsWith("port:")))
   ```

4. **Lines 213–222** — Delete the entire Phase 45 stale-apps redirect
   `createEffect`. Add a one-line comment explaining why in the
   commit body (not the source).
5. **Lines 344–348** — Delete the `<Show when={!dockEnabled()}>`
   wrapping the Apps tab trigger:

   ```jsx
   <Show when={!dockEnabled()}>
     <Tabs.Trigger value="apps">
       <div>{language.t("session.tab.apps")}</div>
     </Tabs.Trigger>
   </Show>
   ```

6. **Lines 352–371** — Delete the `<For each={pinnedApps()}>` block
   of pinned-app `Tabs.Trigger`s. Entire block including the
   `IconButton` close button.
7. **Lines 452–463** — Delete the `<Show when={!dockEnabled()}>`
   wrapping the Apps tab content.
8. **Lines 465–508** — Delete the overlay-hack wrapper:

   ```jsx
   {
     /* big comment about forceMount + opacity hack */
   }
   ;<div class="relative flex-1 min-h-0">
     <For each={pinnedApps()}>{/* ... */}</For>
   </div>
   ```

   This is the most important deletion of the phase — the
   `forceMount + opacity:0 + position:absolute` pattern is the
   long-tail jank source we've been trying to retire. Comment lines
   are part of the deletion (the comment narrates the hack).

9. **Lines 569–664** — Right-side file-tree panel `<div
id="file-tree-panel">`. Move this entire block to the new file
   below. Replace it in `session-side-panel.tsx` with:

   ```jsx
   <SessionFileTreePanel
     fileOpen={fileOpen}
     reviewOpen={reviewOpen}
     treeWidth={treeWidth}
     reviewCount={reviewCount}
     hasReview={hasReview}
     diffsReady={diffsReady}
     diffFiles={diffFiles}
     kinds={kinds}
     nofiles={nofiles}
     reviewEmptyKey={reviewEmptyKey}
     activeDiff={props.activeDiff}
     focusReviewDiff={props.focusReviewDiff}
     onFileClick={(path) => openTab(file.tab(path))}
     size={props.size}
   />
   ```

**Imports to remove (verify they have no other consumers in the
file after deletion):**

- `McpAppPanel`, `McpAppsTab`, `McpAppResource` from
  `@/components/mcp-app-panel`
- `usePinnedApps` from `@/context/pinned-apps`
- `FileTree` from `@/components/file-tree` (moved to new file)
- `ResizeHandle` from `@librecode/ui/resize-handle` (moved to new file)

**Locals to remove:**

- `pinnedAppsCtx`, `pinnedApps`, `pinApp`, `unpinApp`, `mcpTabValue`
- `dockEnabled` — likely still needed by callers; if not, delete.

### 4c. `packages/app/src/pages/session/session-file-tree-panel.tsx` — NEW

This is the extracted right-side panel. Approximate skeleton:

```ts
import { For, Match, Show, Switch, type JSX } from "solid-js"
import { Tabs } from "@librecode/ui/tabs"
import { ResizeHandle } from "@librecode/ui/resize-handle"
import FileTree from "@/components/file-tree"
import { useLanguage } from "@/context/language"
import { useLayout } from "@/context/layout"
import { useSync } from "@/context/sync"
import type { Sizing } from "@/pages/session/helpers"

/**
 * Right-side panel of the session view: switches between "changes"
 * (review-scoped file list) and "all" (full project tree) with a
 * shared resize handle.
 *
 * Extracted from `session-side-panel.tsx` in Phase 48 to bring that
 * file under the 500-line budget. All state still flows in from the
 * parent — this component is purely presentational.
 */
export interface SessionFileTreePanelProps {
  fileOpen: () => boolean
  reviewOpen: () => boolean
  treeWidth: () => string
  reviewCount: () => number
  hasReview: () => boolean
  diffsReady: () => boolean
  diffFiles: () => string[]
  kinds: () => Map<string, "add" | "del" | "mix">
  nofiles: () => boolean
  reviewEmptyKey: () => string
  activeDiff: string | undefined
  focusReviewDiff: (path: string) => void
  onFileClick: (path: string) => void
  size: Sizing
}

export function SessionFileTreePanel(props: SessionFileTreePanelProps): JSX.Element {
  const layout = useLayout()
  const language = useLanguage()
  const sync = useSync()

  const fileTreeTab = (): string => layout.fileTree.tab()

  const setFileTreeTabValue = (value: string): void => {
    if (value !== "changes" && value !== "all") return
    layout.fileTree.setTab(value)
  }

  const showAllFiles = (): void => {
    if (fileTreeTab() !== "changes") return
    layout.fileTree.setTab("all")
  }

  const empty = (msg: string): JSX.Element => (
    <div class="h-full flex flex-col">
      <div class="h-6 shrink-0" aria-hidden />
      <div class="flex-1 pb-64 flex items-center justify-center text-center">
        <div class="text-12-regular text-text-weak">{msg}</div>
      </div>
    </div>
  )

  return (
    <div
      id="file-tree-panel"
      aria-hidden={!props.fileOpen()}
      inert={!props.fileOpen()}
      class="relative min-w-0 h-full shrink-0 overflow-hidden"
      classList={{
        "pointer-events-none": !props.fileOpen(),
        "transition-[width] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] will-change-[width] motion-reduce:transition-none":
          !props.size.active(),
      }}
      style={{ width: props.treeWidth() }}
    >
      <div
        class="h-full flex flex-col overflow-hidden group/filetree"
        classList={{ "border-l border-border-weaker-base": props.reviewOpen() }}
      >
        <Tabs
          variant="pill"
          value={fileTreeTab()}
          onChange={setFileTreeTabValue}
          class="h-full"
          data-scope="filetree"
        >
          <Tabs.List>
            <Tabs.Trigger value="changes" class="flex-1" classes={{ button: "w-full" }}>
              {props.reviewCount()}{" "}
              {language.t(
                props.reviewCount() === 1 ? "session.review.change.one" : "session.review.change.other",
              )}
            </Tabs.Trigger>
            <Tabs.Trigger value="all" class="flex-1" classes={{ button: "w-full" }}>
              {language.t("session.files.all")}
            </Tabs.Trigger>
          </Tabs.List>
          <Tabs.Content value="changes" class="bg-background-stronger px-3 py-0">
            <Switch>
              <Match when={props.hasReview()}>
                <Show
                  when={props.diffsReady()}
                  fallback={
                    <div class="px-2 py-2 text-12-regular text-text-weak">
                      {language.t("common.loading")}
                      {language.t("common.loading.ellipsis")}
                    </div>
                  }
                >
                  <FileTree
                    path=""
                    class="pt-3"
                    allowed={props.diffFiles()}
                    kinds={props.kinds()}
                    draggable={false}
                    active={props.activeDiff}
                    onFileClick={(node) => props.focusReviewDiff(node.path)}
                  />
                </Show>
              </Match>
              <Match when={true}>
                {empty(
                  language.t(
                    sync.project && !sync.project.vcs ? "session.review.noChanges" : props.reviewEmptyKey(),
                  ),
                )}
              </Match>
            </Switch>
          </Tabs.Content>
          <Tabs.Content value="all" class="bg-background-stronger px-3 py-0">
            <Switch>
              <Match when={props.nofiles()}>{empty(language.t("session.files.empty"))}</Match>
              <Match when={true}>
                <FileTree
                  path=""
                  class="pt-3"
                  modified={props.diffFiles()}
                  kinds={props.kinds()}
                  onFileClick={(node) => props.onFileClick(node.path)}
                />
              </Match>
            </Switch>
          </Tabs.Content>
        </Tabs>
      </div>
      <Show when={props.fileOpen()}>
        <div onPointerDown={() => props.size.start()}>
          <ResizeHandle
            direction="horizontal"
            edge="start"
            size={layout.fileTree.width()}
            min={200}
            max={480}
            collapseThreshold={160}
            onResize={(width) => {
              props.size.touch()
              layout.fileTree.resize(width)
            }}
            onCollapse={layout.fileTree.close}
          />
        </div>
      </Show>
    </div>
  )
}
```

Notes:

- Type the `Sizing` import precisely. Look at the existing
  `pages/session/helpers.ts` for the exported `Sizing` type.
- `kinds()` returns `Map<string, "add" | "del" | "mix">` per the
  original `kinds` memo. Match it exactly in the prop type.
- `showAllFiles` is currently called from inside the
  `<DialogSelectFile mode="files" onOpenFile={showAllFiles} />` button
  in the left column (line ~437). That button stays in
  `session-side-panel.tsx`, so this function needs to either stay
  with the parent OR the parent passes its own copy. Simplest: keep
  `showAllFiles` in the parent (it's already there), and remove the
  duplicate from the extracted component if it's no longer needed
  there. Read carefully — the original `showAllFiles` is in the
  parent's scope and used by `DialogSelectFile`. The new file's copy
  is only needed if `SessionFileTreePanel` itself uses it; if not,
  drop it.

### 4d. `packages/app/src/components/session/session-header.tsx` — remove dead `tabs().open`

Around line 366:

```jsx
batch(() => {
  pinnedApps.pin({
    server: app.server,
    name: app.name,
    uri: app.uri,
    description: app.description,
  })
  // Set the pinned app as the active tab so it'll be visible
  // whenever the user opens the review panel. Intentionally
  // do NOT force the review panel open here — respect
  // whatever state the user left it in.
  void tabs().open(`mcp-app:${app.server}:${encodeURIComponent(app.uri)}`)
})
```

After Phase 48:

```jsx
// Pin the app into the dock state. The dock listens to `pinnedApps`
// and renders the new pane automatically (see
// `app-dock/use-dock-state.tsx`). Phase 48 dropped the legacy
// `tabs().open("mcp-app:...")` call — there's no tab to open
// anymore.
pinnedApps.pin({
  server: app.server,
  name: app.name,
  uri: app.uri,
  description: app.description,
})
```

Remove the `batch()` wrapper too — only one reactive write remains.
If `batch` was the only thing pulling it in, drop the import.

**Verify `tabs` is still used elsewhere in `session-header.tsx`** (it
almost certainly is — for opening files / context / Review). If so,
keep the `useSessionLayout()` destructure for `tabs`. Only drop the
import / destructure if there are no remaining callers.

### 4e. `PLAN.md` — Phase 48 entry

Append under "v0.9.x Continued":

```markdown
### Phase 48: Tab strip cleanup + drop legacy MCP code (v0.9.88)

After the dock proved stable through Phases 42–47, Phase 48 flips the
default and retires the legacy in-tab-strip MCP rendering. The dock is
now the only MCP surface unless the user explicitly disables it.

| Item                                                                             | Status |
| -------------------------------------------------------------------------------- | ------ |
| `experimental.app_dock` schema default → `true` (was implicit undefined → false) | ✅     |
| Apps tab + pinned-app `<Tabs.Trigger>`s deleted from session-side-panel.tsx      | ✅     |
| `forceMount + opacity:0 + position:absolute` pinned-pane overlay hack deleted    | ✅     |
| `mcpTabValue` helper, `mcp-app:` filter, stale-tab redirect effect all deleted   | ✅     |
| Dead `tabs().open("mcp-app:...")` after `pinnedApps.pin(...)` in session-header  | ✅     |
| Right-side file-tree panel extracted → `session-file-tree-panel.tsx`             | ✅     |
| `session-side-panel.tsx`: 669 → ≤500 lines                                       | ✅     |
| Migration note in CHANGELOG: opting out of dock = no MCP apps in workspace       | ✅     |
```

### 4f. `docs/adr/0009-app-dock.md` — append Phase 48 changelog

Add a row to the changelog table:

```markdown
| Phase 48 (v0.9.88) | Flipped `experimental.app_dock` default → on. Deleted legacy MCP-pinned-app rendering from session tab strip. Dropped the `forceMount + opacity:0` overlay hack. Extracted `<SessionFileTreePanel>` to bring `session-side-panel.tsx` from 669 → <500 lines. |
```

### 4g. `CHANGELOG.md` — Phase 48 entry

Append a section under the v0.9.88 header (create the header if it
doesn't exist):

````markdown
## [0.9.88] - 2026-05-25

### Changed

- **App Dock is now on by default.** The `experimental.app_dock`
  config flag defaults to `true` as of this release. Users who
  previously had no preference set now see the App Dock on the right
  side of the session view automatically.
- Migrated pinned MCP apps out of the session tab strip. The Apps
  tab and the inline pinned-app tabs are gone — MCP apps live
  exclusively in the dock now.

### Removed

- Legacy `forceMount + opacity:0 + position:absolute` overlay hack
  that kept pinned-app iframes alive across tab switches. The dock
  manages its own iframe lifecycle.
- `mcpTabValue` helper, `mcp-app:` tab prefix handling, and the Phase
  45 stale-`activeTab` redirect effect.

### Migration

Setting `"experimental": { "app_dock": false }` in your
`librecode.jsonc` now hides the App Dock AND removes all MCP apps
from the session — there's no longer any in-tab-strip fallback. Only
disable the dock if you specifically don't want MCP apps in this
workspace. The flag itself will be removed entirely in a future
release (Phase 51).

```json
// librecode.jsonc — opt out (rare)
{
  "experimental": {
    "app_dock": false // hides dock and removes ALL MCP apps from the workspace
  }
}
```
````

````

(Make the date today's date when committing.)

---

## 5. Tests required

Phase 48 is mostly deletion, so the test surface is:

1. Regression coverage — assert legacy DOM nodes are absent.
2. Coverage of the extracted `<SessionFileTreePanel>`.
3. Coverage of the flipped schema default.

### 5a. `packages/librecode/test/config/schema.test.ts` (or a new file)

Add to existing config schema tests:

```ts
test("experimental.app_dock defaults to true when omitted", () => {
  const parsed = Config.schema.parse({})
  expect(parsed.experimental?.app_dock).toBe(true)
})

test("experimental.app_dock=false is respected when set explicitly", () => {
  const parsed = Config.schema.parse({ experimental: { app_dock: false } })
  expect(parsed.experimental?.app_dock).toBe(false)
})
````

(Adjust the import path / parser call to match the existing test
style. If `Config.schema` isn't the right name, search for how
`schema.ts` is consumed in existing config tests.)

### 5b. `packages/app/src/pages/session/session-file-tree-panel.test.tsx` — NEW

Cover the extracted component:

```ts
import { describe, expect, test } from "bun:test"
import { render } from "@solidjs/testing-library"

// Mirror the pure derivation we need — DO NOT import from
// session-file-tree-panel.tsx itself in tests that drive DOM. Use the
// happy-dom preload for component renders.

import { SessionFileTreePanel } from "./session-file-tree-panel"
// + wrap with all required providers (useLanguage, useLayout, useSync, etc.)
```

Coverage targets (≥6 tests):

1. Renders with `fileOpen=false` → element is `inert` and has
   `aria-hidden="true"`, width is `0px`.
2. Renders with `fileOpen=true` → width matches `treeWidth()`.
3. `fileTreeTab="changes"` + `hasReview=true` + `diffsReady=true` →
   `FileTree` is rendered with `allowed={diffFiles()}`.
4. `fileTreeTab="changes"` + `hasReview=false` → empty message
   renders (loose match on the i18n key).
5. `fileTreeTab="all"` + `nofiles=true` → empty message renders.
6. `setFileTreeTabValue` rejects unknown tab values (call it with
   `"bogus"`, assert `layout.fileTree.setTab` wasn't called).

The provider-wrapping for tests is the painful part. Look at how
`packages/app/src/components/activity-grid.test.ts` or
`packages/app/src/pages/session/helpers.test.ts` set up their
provider tree (mock contexts via `Context.Provider`). Copy that
pattern.

**If full DOM render proves too painful** (e.g. the Tabs / FileTree
component pulls in too many transitive contexts), fall back to the
"mirror function" pattern used in Phase 46: extract the pure
helpers (`setFileTreeTabValue`, `empty`) into a sibling
`session-file-tree-panel.pure.ts` and unit-test those directly. This
buys 4+ tests without the provider tree.

### 5c. `packages/app/src/pages/session/session-side-panel.legacy.test.tsx` — NEW (optional but recommended)

A small file asserting deleted DOM is gone. With provider mocking
this is light:

1. Render `<SessionSidePanel>` with `experimental.app_dock` config = `true`
   AND a `pinnedApps` context returning `[stats, multica]` →
   neither pinned-app `Tabs.Trigger` appears in the DOM. Query for
   `[role="tab"]` and assert none of them has `value` matching
   `mcp-app:*`.
2. Same setup with `experimental.app_dock` config = `false` → still
   no pinned-app triggers (the Apps tab is also gone because the
   `<Show when={!dockEnabled()}>` wrapper was deleted entirely, not
   moved). This is the explicit "opting out = no MCP apps" assertion.
3. Render with empty pinned-apps array → no DOM regression in the
   non-pinned baseline state.

If the provider tree wrangling is prohibitive, skip 5c and rely on
the helpers.test.ts coverage + manual smoke. Spec-mandatory: at
least one negative-assertion test SOMEWHERE in the codebase that
catches re-introduction of `mcp-app:` tab triggers in the session
strip. The simplest version is a grep-based unit test:

```ts
import { test, expect } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

test("session-side-panel.tsx contains no mcp-app: tab references (Phase 48)", () => {
  const src = readFileSync(join(import.meta.dir, "../session-side-panel.tsx"), "utf8")
  expect(src).not.toMatch(/mcp-app:/)
  expect(src).not.toMatch(/mcpTabValue/)
  expect(src).not.toMatch(/forceMount/)
})
```

This is ugly but cheap and effective. Acceptable as primary
regression coverage if DOM rendering is too costly.

### 5d. `packages/app/src/components/session/session-header.test.tsx` — UPDATE

If the file exists (likely does — check), update the pin-handler
test to assert `tabs().open` is NOT called after `pinnedApps.pin`.
If no such test exists, add one. Mock `useSessionLayout` to return a
spy `tabs().open` and a stub `pinnedApps.pin`. Trigger the pin
handler. Assert spy was NEVER called.

### 5e. helpers.test.ts (`pages/session/helpers.test.ts`)

Verify `createSessionTabs` still works with no `fallbackActive` or
with `fallbackActive: () => undefined`. Add one test case if not
already covered:

```ts
test("createSessionTabs handles missing fallbackActive", () => {
  // ... existing setup
  const tabs = createSessionTabs({
    // ... no fallbackActive
  })
  expect(tabs.activeTab()).toBe(/* default value, likely 'review' */)
})
```

---

## 6. Step-by-step execution order

Strict ordering to keep tests passing at every step:

### Step 1 — Baseline

```bash
cd /home/tristan/Projects/librecode
bun install
cd packages/app && bun test --timeout 30000 2>&1 | tail -5
cd ../librecode && bun test --timeout 30000 2>&1 | tail -5
```

Record the baseline pass counts. After Phase 47: 705 app + 1984
librecode = 2689 total. Your delta must be ≥ 0 regressions.

### Step 2 — Flip the schema default

1. Read `packages/librecode/src/config/schema.ts` around line 700.
2. Apply the `.default(true).describe(...)` change.
3. Run `bun run build:schema` to regenerate `schema/config.json`.
4. Add the new config-schema test (5a).
5. Run librecode tests: `bun test --timeout 30000` from
   `packages/librecode`. Confirm green.
6. **Commit**: "feat(config): default `experimental.app_dock` to true (Phase 48)"

### Step 3 — Delete legacy from session-header.tsx

1. Read `packages/app/src/components/session/session-header.tsx` around the
   pin handler (search for `pinnedApps.pin`).
2. Remove the `tabs().open(...)` call and the surrounding `batch()`
   if it's no longer multi-write.
3. Update / add the session-header test (5d).
4. Run app tests. Confirm green.
5. **Commit**: "refactor(session-header): drop dead `tabs().open(mcp-app:...)` after pin (Phase 48)"

### Step 4 — Create `session-file-tree-panel.tsx`

1. Create the new file with the skeleton from §4c.
2. Add the test file (5b) — write the failing tests first, watch them
   fail (TDD).
3. Make them pass.
4. Run typecheck: `bun run typecheck` from repo root. Confirm clean.
5. **Commit**: "feat(session): extract SessionFileTreePanel from session-side-panel (Phase 48)"

### Step 5 — Delete legacy from session-side-panel.tsx + wire up extraction

1. Read the whole file. Plan the edits.
2. Apply all the deletions listed in §4b.
3. Replace the right-side file-tree block with
   `<SessionFileTreePanel>`.
4. Drop now-unused imports (`McpAppPanel`, `McpAppsTab`,
   `McpAppResource`, `usePinnedApps`, `FileTree`, `ResizeHandle`).
5. Run `wc -l packages/app/src/pages/session/session-side-panel.tsx`
   → confirm ≤500. If over: extract `<SessionEmptyTab />` per the
   fallback in §3.
6. Add the legacy-deletion regression test (5c). Run it.
7. Run all app tests: `cd packages/app && bun test --timeout 30000`.
   Confirm pass count is ≥ baseline.
8. Run typecheck: clean.
9. Run prettier: `bunx prettier --write packages/app/src/pages/session/session-side-panel.tsx`.
10. **Commit**: "refactor(session): delete legacy MCP-pinned-app rendering (Phase 48)"

### Step 6 — Manual smoke (CRITICAL)

Run the desktop app:

```bash
bun run dev:desktop
```

Verify:

- Fresh session → dock visible on right, no Apps tab in session strip.
- Add Stats from Start menu → appears in dock.
- Toggle to `experimental.app_dock=false` in `~/.config/librecode/librecode.jsonc`
  (or whatever the dev override path is). Reload. Confirm dock hides
  AND no Apps tab AND no pinned MCP tabs.
- Toggle back to true. Confirm baseline restored.

This is a critical manual verification because we're changing default
behavior for every existing user.

### Step 7 — Docs

1. Update `PLAN.md` (§4e).
2. Append `docs/adr/0009-app-dock.md` changelog row (§4f).
3. Update `CHANGELOG.md` with the v0.9.88 entry (§4g).
4. Run prettier on all three. Commit:
   - "docs(adr): ADR-009 Phase 48 changelog row"
   - "docs(plan): Phase 48 entry in PLAN.md"
   - "docs(changelog): v0.9.88 — App Dock default flip + legacy MCP cleanup"

### Step 8 — Version bump

Bump every package.json + Cargo.toml from 0.9.87 → 0.9.88:

```bash
# Find all version-bearing files
grep -rl '"version": "0.9.87"' packages/ --include="package.json"
grep -rl 'version = "0.9.87"' packages/desktop/src-tauri/
```

Update each. Single commit: "chore: bump version to 0.9.88".

### Step 9 — Push + release

```bash
git push origin main
git tag v0.9.88
git push origin v0.9.88
```

(The user has authorized direct-to-main pushes for Phase 47 work;
follow the same pattern. If you hit the auto-mode push denial, STOP
and ask the user to authorize once.)

Watch CI:

```bash
gh run watch
```

Release should complete in ~18 minutes (matches v0.9.86, v0.9.87 cadence).

---

## 7. Verification checklist

Before declaring Phase 48 done:

- [ ] `bun test --timeout 30000` from `packages/app` passes (≥705 +
      new tests).
- [ ] `bun test --timeout 30000` from `packages/librecode` passes
      (≥1984 + new config-schema test).
- [ ] `bun run typecheck` clean.
- [ ] `bunx prettier --check .` clean.
- [ ] `bun run lint` clean (ADR-006 checker doesn't fire — no new
      `createResource` calls were added).
- [ ] `wc -l packages/app/src/pages/session/session-side-panel.tsx`
      ≤ 500.
- [ ] `grep -rn "mcpTabValue\|mcp-app:" packages/app/src/pages/session/`
      returns ZERO matches (modulo the new regression test that
      asserts absence).
- [ ] `grep -rn "forceMount" packages/app/src/pages/session/session-side-panel.tsx`
      returns ZERO matches.
- [ ] Manual smoke: dock-default-on path works; dock-disabled path
      hides everything cleanly.
- [ ] v0.9.88 GitHub release is green with all 14+ assets.
- [ ] `schema/config.json` reflects the new default (`"default": true`
      under `experimental.app_dock`).

---

## 8. Common pitfalls

These are the foot-guns the previous phases hit. Read them.

### Pitfall 1 — Zod `.default(true)` changes the parsed type

`z.boolean().optional()` parses to `boolean | undefined`. Adding
`.default(true)` makes it parse to `boolean`. Consumers that do
`config.experimental?.app_dock === true` still work, but consumers
that check `app_dock === undefined` (if any exist) will break. Run
`grep -rn "app_dock === undefined\|app_dock == undefined" packages/`
before the change. If hits exist, update them.

### Pitfall 2 — `experimental.app_dock=false` is a real user state

Even with the default flipped, users who EXPLICITLY set `false` exist.
Don't accidentally turn the consumer check into a truthy check that
ignores their preference. Keep `=== true` semantics. The new tests
in 5c step 2 catch this.

### Pitfall 3 — `pinnedApps` context is still alive

Phase 48 doesn't retire `pinned-apps.tsx`. The dock seeds from it
(`use-dock-state.tsx:62`). The Start menu and Settings dialog still
write to it. Only the session-side-panel and session-header
**consumers** of pinned-apps disappear in this phase. Don't delete
`pinned-apps.tsx` — that's Phase 51.

### Pitfall 4 — `mcpTabValue`-shaped tab values persist in user state

A user's `openedTabs` (persisted in workspace storage) may contain
old `mcp-app:server:uri` entries. Kobalte Tabs ignores values with no
matching trigger, so the practical effect is the tab is silently
dropped. Confirm `createSessionTabs` handles missing tabs gracefully
(it should — Phase 45 already needed this). Add a one-line comment
in the commit body acknowledging the silent drop.

### Pitfall 5 — `showAllFiles` lives in two places

The parent `session-side-panel.tsx` uses `showAllFiles` inside
`onOpenFile={showAllFiles}` on `<DialogSelectFile>`. If you also put
a `showAllFiles` in the extracted `<SessionFileTreePanel>`, you'll
have two copies that drift. Keep it in the parent ONLY. The extracted
component doesn't need it for its own behavior.

### Pitfall 6 — `pages/session/**` is an ADR-006 danger zone

The lint checker at `scripts/lint-adr-006.ts` will scan
`session-file-tree-panel.tsx` for `createResource` calls. If you add
one, you need an `// adr-006: <reason>` comment. The clean skeleton
above has zero `createResource` calls, so this is a non-issue unless
you deviate. Don't add one.

### Pitfall 7 — Provider-tree pain in tests

`<SessionSidePanel>` and `<SessionFileTreePanel>` both need
`useLanguage`, `useLayout`, `useSync`, `useDialog`, `useFile`,
`useCommand`, `useGlobalSDK`, `useSessionLayout` providers to render.
Wrapping all of them is verbose but doable — look at how
`packages/app/src/pages/session/helpers.test.ts` set up its provider
tree (it's the canonical example).

If you can't get the full provider tree working in under ~30 minutes
of fighting, **fall back to the grep-based regression test in 5c**.
That's an acceptable Phase 48 deliverable — the deletions are
mechanical and a string-search catches re-introduction.

### Pitfall 8 — `Tabs.Trigger value="apps"` removal

The `i18n` key `session.tab.apps` becomes unused after this phase.
Don't delete the key itself in `librecode-i18n` — that's a separate
repo bump and Phase 48 doesn't justify the cross-repo coordination.
Leave the key in place. Phase 51 (the "out of experimental"
cleanup) can sweep unused i18n keys.

---

## 9. Pre-drafted atomic commit subjects

In execution order:

1. `feat(config): default experimental.app_dock to true (Phase 48)`
2. `refactor(session-header): drop dead tabs().open(mcp-app:...) after pin (Phase 48)`
3. `feat(session): extract SessionFileTreePanel from session-side-panel (Phase 48)`
4. `refactor(session): delete legacy MCP-pinned-app rendering (Phase 48)`
5. `test(session): regression coverage for Phase 48 deletions`
6. `docs(adr): ADR-009 Phase 48 changelog row`
7. `docs(plan): Phase 48 entry in PLAN.md`
8. `docs(changelog): v0.9.88 — App Dock default flip + legacy MCP cleanup`
9. `chore: bump version to 0.9.88`

Optionally batch 5–8 into fewer commits if the contents are small and
related. Don't batch 1–4 — each is a distinct logical change.

---

## 10. When you're done

Report back with the standard markdown table format used in Phases 42–47:

```
| Aspect | Detail |
|---|---|
| Release | v0.9.88 green, asset count, CI duration |
| Commits | N atomic, list of subjects |
| Test delta | app: X → Y (+Z); librecode: A → B (+C) |
| File size | session-side-panel.tsx: 669 → ??? |
| Deletions verified | mcpTabValue, forceMount, mcp-app: prefix |
| Default flip | experimental.app_dock=true confirmed via parsed config |
| Manual smoke | dock-on path ✓, dock-off path ✓ |
| Deviations | (if any — note them) |
| New pitfalls | (if any surfaced in execution — document for Phase 49) |
```

This format keeps the cycle tight: the reviewer (Opus) can audit the
report against the spec in one pass, plan the next phase, and hand
off.

---

## Appendix A — File checksum recon

Run these before starting to confirm we're working from the same
baseline:

```bash
cd /home/tristan/Projects/librecode
git rev-parse HEAD       # should match b741c88 (Phase 47 head) or later
wc -l packages/app/src/pages/session/session-side-panel.tsx  # 669
wc -l packages/app/src/components/session/session-header.tsx
grep -n "app_dock" packages/librecode/src/config/schema.ts   # line ~700
grep -c "mcp-app:\|mcpTabValue\|forceMount" packages/app/src/pages/session/session-side-panel.tsx
```

If any of these differ materially from what's described above, STOP
and re-check the recon notes in this spec before executing.

---

## Appendix B — What ships next

Phase 49 will be **Detachable Tauri windows**. It's the highest-risk
phase in the overhaul (multi-window IPC, Tauri 2.x ergonomics). Phase
48's clean deletion makes 49 simpler — the dock pane is the single
unit of detachment, and there's no legacy tab-strip path to also
detach from. So getting Phase 48 right is leverage for the riskiest
upcoming work.
