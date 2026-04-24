# ADR-006: Suspense-Safe State Changes via `startTransition`

**Status:** Accepted
**Date:** 2026-04-24
**Decision:** User-triggered state changes inside a session route that
feed a `createResource` fetcher key MUST be wrapped in `startTransition`.

---

## Context

The LibreCode UI uses SolidJS with a `<Suspense>` boundary around the
session route's main content (`packages/app/src/pages/session/session.tsx`).
The boundary catches legitimately slow route transitions (e.g. loading a
large message history on navigation) and swaps in a fallback so the app
doesn't render partially-loaded state.

Inside that boundary, several components use `createResource` to fetch
data keyed on a user-controlled signal:

- The Start menu's `/mcp/apps` lookup is keyed on whether the menu is open
  (`open() ? baseUrl() : undefined`).
- The McpAppPanel's app HTML is keyed on `(server, uri)`, which can change
  when a new app is pinned via the For loop that renders one panel per
  pinned app.
- Session-side-panel tabs use `fetchAppList` keyed on the directory +
  session id, which can change during a tab switch.

When such a signal flips synchronously in response to a click, the resource
enters `loading`, and that state propagates upward to the nearest Suspense
boundary. The boundary swaps in its fallback, which unmounts every child
of the boundary momentarily. The user sees:

- A brief white flash where panes were.
- Iframes remounting (because their DOM element is removed + recreated).
- Text re-measuring (scroll position resets, line-wrap recomputes).

We shipped variants of this bug three times before deciding to
codify the pattern:

| Release | Trigger                                  | Fix site                                      |
| ------- | ---------------------------------------- | --------------------------------------------- |
| v0.9.54 | Tab switches in the session side panel   | `session-side-panel.tsx` tab-change handler   |
| v0.9.58 | Pinning a new MCP app for the first time | `context/pinned-apps.tsx` `pin()` setter      |
| v0.9.70 | Opening / closing the Start menu         | `components/start-menu.tsx` open/close toggle |

Each time the instinct was "that's weird, specific to this surface" rather
than "this is the same underlying bug." Three is enough: codify it.

## Decision

Two complementary rules, in preference order.

### Primary: decouple user interactions from resource loading

If the fetch doesn't _need_ the interaction's new value, don't key the
resource on it. Fetch against a stable source (mount-time URL, session
ID, etc.) and let the interaction toggle pure presentation. This
eliminates the Suspense/transition interaction entirely — there's no
resource loading to wait on, so no fallback can fire.

```typescript
// WRONG — flipping `open` changes the resource source → loading state
const [open, setOpen] = createSignal(false)
const [apps] = createResource(() => (open() ? baseUrl() : undefined), fetcher)

// RIGHT — resource keyed on a stable value, fires at mount
const [open, setOpen] = createSignal(false)
const [apps] = createResource(() => baseUrl(), fetcher)
```

### Secondary: `startTransition` for setters that genuinely trigger loads

When the data actually depends on user input (search boxes, selected
session switches, etc.), wrap the setter in `startTransition` so Solid
holds the previous UI while the resource settles:

```typescript
import { startTransition } from "solid-js"
const [query, setRawQuery] = createSignal("")
const setQuery = (next: string) => void startTransition(() => setRawQuery(next))
const [results] = createResource(() => query(), searchFetcher)
```

Wrap the setter once so every call site benefits automatically —
sprinkling `startTransition` at each `setFoo(...)` site means missing one
brings the bug back.

### When `startTransition` is not enough

v0.9.70 wrapped the Start menu's open setter in `startTransition` and
the Suspense fallback STILL fired. Solid's transition tracking is
strongest when the resource is directly read inside the transition
callback, not reached through a chain of reactive dependencies. A cheap
synchronous flip that causes a _downstream_ resource to enter loading
can commit the Suspense fallback before the transition settles.

**Rule of thumb: if a `startTransition` fix doesn't hold under visual
testing, fall back to the primary rule — break the coupling.** Don't
try to patch the transition harder.

## Non-goals

- **Not removing the Suspense boundary.** The boundary exists for
  legitimately slow route transitions (loading a 10k-message session,
  re-authenticating a provider mid-session). Its fallback is correct UX
  in those cases.
- **Not wrapping every setState in startTransition.** Only the ones that
  feed a resource's fetcher key. Plain UI state (hover, focus, tooltip
  open) doesn't need it.
- **Not routing server-initiated updates through `startTransition`.**
  SSE-driven sync updates (new message arrives, activity event) don't
  need the wrapper because they're not blocking a user interaction; a
  brief Suspense fallback is acceptable.

## Detection

Two checks when reviewing a PR that adds a `createResource` under a
session route:

1. **Source trace.** Read the fetcher's first argument (the source
   function). For every signal / store / prop it reads, trace where that
   value is written. If any writer is an event handler (click, key,
   hover, etc.), confirm that handler uses `startTransition`.

2. **Visual test.** Mount the component, trigger the state change, watch
   the surrounding panes. If anything re-measures or flashes white, the
   transition wrapper is missing.

Both are manual today. A lint rule that flags `createResource` whose
source function reads a signal that an `onClick` writes to is the long
game — SolidJS ASTs make this tractable but it's not on today's backlog.

## Consequences

**Good:**

- Eliminates the Suspense-fallback flash class of bug. Three recurrences
  proves the UI hazard is systemic, not component-specific.
- The wrapper pattern is self-documenting — any reader of
  `setRawOpen` / `setOpen` pair infers "this is deliberately wrapped."

**Bad:**

- Slightly more boilerplate for each resource-backed user state. The
  setter wrapper is ~3 lines extra.
- A developer who doesn't know the pattern will ask "why are there two
  setters?" The CLAUDE.md entry + this ADR answer that question.

**Neutral:**

- `startTransition` is standard SolidJS — no new dependency, no custom
  abstraction. The pattern travels with the framework.

## Known hot surfaces (already fixed, don't regress)

| File                                           | Release | Technique                                         |
| ---------------------------------------------- | ------- | ------------------------------------------------- |
| `app/src/pages/session/session-side-panel.tsx` | v0.9.54 | `startTransition` around tab-change setter        |
| `app/src/context/pinned-apps.tsx`              | v0.9.58 | `startTransition` around `pin()` setter           |
| `app/src/components/start-menu.tsx`            | v0.9.70 | `startTransition` around open/close (DIDN'T WORK) |
| `app/src/components/start-menu.tsx`            | v0.9.71 | Un-gated resource from `open()` — the actual fix  |

v0.9.70 is instructive: the first `startTransition` fix looked correct
and shipped green. Visual testing revealed the Suspense fallback was
still firing, leading to the v0.9.71 redesign. Always verify with a
manual visual test, not just a typecheck + unit run.

Adding a fifth entry to this table means we missed one at review. Add
it, don't treat it as an isolated regression.
