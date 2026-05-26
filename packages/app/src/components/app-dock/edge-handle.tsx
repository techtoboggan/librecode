import { Show, type JSX } from "solid-js"
import { useAppDockState } from "./use-dock-state"

/**
 * Always-visible edge handle for a hidden dock.
 *
 * Renders a slim tab on the right edge of the viewport whenever the
 * dock is hidden AND has at least one entry. Click → toggles the dock
 * back open.
 *
 * v0.9.95 — addresses the "even if hidden, why is there no way to make
 * it visible again?" discoverability gap. The existing affordances
 * (Ctrl+\ shortcut, dot-grid button in session header) require either
 * knowing the shortcut or recognizing the icon — neither is obvious to
 * first-time or returning users. This component makes "re-open the
 * dock" a single visible click that's impossible to miss.
 *
 * Empty hidden docks don't get the handle — if a user has no entries
 * and the dock is hidden, they probably hid it deliberately and don't
 * need a visible affordance pulling them back in.
 *
 * adr-006 N/A: no createResource.
 */
export function DockEdgeHandle(): JSX.Element {
  const dock = useAppDockState()
  const show = (): boolean => dock.state().visibility === "hidden" && dock.state().entries.length > 0
  const count = (): number => dock.state().entries.length
  const label = (): string => `Show app dock (${count()} app${count() === 1 ? "" : "s"})`

  return (
    <Show when={show()}>
      <button
        type="button"
        data-testid="dock-edge-handle"
        aria-label={label()}
        title={label()}
        onClick={() => dock.toggle()}
        class="fixed right-0 top-1/2 -translate-y-1/2 z-40 flex flex-col items-center justify-center gap-1 px-1.5 py-3 rounded-l-md bg-background-stronger border border-r-0 border-border-weak-base text-text-weak hover:text-text-base hover:bg-background-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-strong transition-colors"
      >
        <span aria-hidden="true" class="text-14-medium leading-none">
          ◀
        </span>
        <span aria-hidden="true" class="text-10-medium leading-none tabular-nums" data-testid="dock-edge-handle-count">
          {count()}
        </span>
      </button>
    </Show>
  )
}
