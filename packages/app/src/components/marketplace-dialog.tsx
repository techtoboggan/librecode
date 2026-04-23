/**
 * v0.9.64 — in-app "Browse MCP apps" dialog.
 *
 * Users reach this from the Start menu → "Browse marketplace". It's a
 * search-driven grid of curated apps from mcpapps.vip (proxied via
 * the host's `/marketplace/*` route). Clicking Install on a card
 * triggers the server-side install flow and, on success, pins the
 * app to the user's Start menu by dropping it into the same
 * pinnedApps store the top-right Apps button already uses.
 *
 * The install path is stubbed in this release (the server endpoint
 * records intent and returns a placeholder). That lets us land the
 * UI plumbing + types + client + proxy shape ahead of the first
 * production mcpapps.vip launch. When the real install flow lands,
 * only `installFromMarketplace`'s server handler needs to change —
 * the client contract is stable.
 */
import { createResource, createSignal, For, Match, Show, Switch, type JSX } from "solid-js"
import { Button } from "@librecode/ui/button"
import { Icon } from "@librecode/ui/icon"
import { useGlobalSDK } from "@/context/global-sdk"
import { usePinnedApps } from "@/context/pinned-apps"
import { useSDK } from "@/context/sdk"
import {
  describeInstall,
  formatInstalls,
  installFromMarketplace,
  type MarketplaceApp,
  searchMarketplace,
} from "./marketplace-client"

export interface MarketplaceDialogProps {
  /** Close the dialog. Parent (StartMenu) owns the open-state. */
  onClose: () => void
}

export function MarketplaceDialog(props: MarketplaceDialogProps): JSX.Element {
  const sdk = useSDK()
  const globalSDK = useGlobalSDK()
  const pinnedApps = usePinnedApps()

  const [query, setQuery] = createSignal("")
  const [installing, setInstalling] = createSignal<Set<string>>(new Set())
  const [installError, setInstallError] = createSignal<string | undefined>()

  const [results, { refetch }] = createResource(
    () => query(),
    async (q) => searchMarketplace(globalSDK.fetch, sdk.url, q, { limit: 24 }),
  )

  const isPinned = (app: MarketplaceApp) => Boolean(app.uri && pinnedApps.isPinned(app.uri))

  const onInstall = async (app: MarketplaceApp) => {
    setInstallError(undefined)
    setInstalling((s) => new Set(s).add(app.id))
    try {
      const res = await installFromMarketplace(globalSDK.fetch, sdk.url, app.id)
      if (!res.ok) {
        setInstallError(res.error)
        return
      }
      // v0.9.64 — when the marketplace entry advertises a ui:// URI,
      // pin it straight to the Start menu so the user sees their
      // newly-installed app immediately. When the real install flow
      // lands, this path stays — the server will have wired up the
      // MCP server before returning `ok: true`.
      if (app.uri) {
        pinnedApps.pin({
          server: res.server,
          name: app.name,
          uri: app.uri,
          description: app.description,
        })
      }
      // Successful install — close the dialog so the pinned tab has
      // the floor. The user can always reopen the marketplace if they
      // want to install more apps.
      props.onClose()
    } catch (err) {
      setInstallError(err instanceof Error ? err.message : String(err))
    } finally {
      setInstalling((s) => {
        const next = new Set(s)
        next.delete(app.id)
        return next
      })
    }
  }

  return (
    <div
      data-component="marketplace-dialog"
      class="flex flex-col w-[min(800px,92vw)] max-h-[min(640px,80vh)] bg-surface-panel rounded-md border border-border-weak-base overflow-hidden"
    >
      <header class="flex items-center gap-3 px-4 py-3 border-b border-border-weak-base">
        <Icon name="dot-grid" class="size-4 text-text-strong" />
        <div class="flex flex-col gap-0.5">
          <span class="text-14-medium text-text-strong">MCP App Marketplace</span>
          <span class="text-11-regular text-text-weaker">
            Curated apps from mcpapps.vip · Install adds them to your Start menu
          </span>
        </div>
        <span class="flex-1" />
        <Button type="button" variant="ghost" size="small" onClick={props.onClose} aria-label="Close marketplace">
          <Icon name="close-small" class="size-3.5" />
        </Button>
      </header>

      <div class="px-4 py-3 border-b border-border-weak-base">
        <div class="flex items-center gap-2 px-2 rounded-md border border-border-weak-base bg-background-stronger">
          <Icon name="magnifying-glass" class="size-3.5 text-text-weaker" />
          <input
            type="search"
            value={query()}
            onInput={(e) => setQuery(e.currentTarget.value)}
            placeholder="Search apps…"
            class="flex-1 bg-transparent outline-none h-8 text-12-regular text-text-base placeholder:text-text-weaker"
            autofocus
          />
          <Show when={query()}>
            <Button type="button" variant="ghost" size="small" onClick={() => setQuery("")} aria-label="Clear search">
              <Icon name="close-small" class="size-3" />
            </Button>
          </Show>
        </div>
      </div>

      <div class="flex-1 overflow-y-auto p-4" data-slot="marketplace-results">
        <Switch>
          <Match when={results.loading && !results()}>
            <div class="text-12-regular text-text-weaker text-center py-12 animate-pulse">Loading apps…</div>
          </Match>

          <Match when={!results.loading && (results()?.apps.length ?? 0) === 0 && !query()}>
            <div class="flex flex-col items-center gap-3 text-center py-12">
              <Icon name="dot-grid" class="size-8 text-text-weaker" />
              <div class="text-12-regular text-text-weak">
                The marketplace is empty right now.
                <br />
                mcpapps.vip is coming online — check back soon.
              </div>
              <Button type="button" variant="ghost" size="small" onClick={() => refetch()}>
                Retry
              </Button>
            </div>
          </Match>

          <Match when={!results.loading && (results()?.apps.length ?? 0) === 0 && query()}>
            <div class="text-12-regular text-text-weaker text-center py-12">No matches for "{query()}".</div>
          </Match>

          <Match when={(results()?.apps.length ?? 0) > 0}>
            <ul class="grid grid-cols-1 md:grid-cols-2 gap-3" data-slot="marketplace-grid">
              <For each={results()?.apps ?? []}>
                {(app) => (
                  <li
                    class="flex flex-col gap-2 p-3 rounded-md border border-border-weak-base bg-background-stronger"
                    data-slot="marketplace-card"
                    data-app-id={app.id}
                  >
                    <div class="flex items-baseline gap-2">
                      <span class="text-13-medium text-text-strong truncate">{app.name}</span>
                      <Show when={app.verified}>
                        <span
                          class="text-10-medium px-1 py-0.5 rounded bg-success-surface text-success-text shrink-0"
                          title="Verified by the marketplace curators"
                        >
                          verified
                        </span>
                      </Show>
                      <span class="flex-1" />
                      <span class="text-10-regular text-text-weaker shrink-0">v{app.version}</span>
                    </div>
                    <div class="text-11-regular text-text-weak line-clamp-2">{app.description}</div>
                    <div class="flex flex-wrap items-center gap-2 text-10-regular text-text-weaker">
                      <span>by {app.author.name}</span>
                      <Show when={formatInstalls(app.stats?.installs)}>
                        {(count) => <span>· {count()} installs</span>}
                      </Show>
                      <Show when={app.stats?.rating}>{(r) => <span>· ★ {r().toFixed(1)}</span>}</Show>
                    </div>
                    <div class="flex items-center gap-2 pt-1">
                      <code class="text-10-regular text-text-weaker font-mono truncate flex-1">
                        {describeInstall(app.install)}
                      </code>
                      <Show
                        when={!isPinned(app)}
                        fallback={
                          <Button type="button" variant="ghost" size="small" disabled>
                            Installed
                          </Button>
                        }
                      >
                        <Button
                          type="button"
                          variant="primary"
                          size="small"
                          onClick={() => onInstall(app)}
                          disabled={installing().has(app.id)}
                        >
                          {installing().has(app.id) ? "Installing…" : "Install"}
                        </Button>
                      </Show>
                    </div>
                  </li>
                )}
              </For>
            </ul>
          </Match>
        </Switch>

        <Show when={installError()}>
          {(msg) => (
            <div
              role="alert"
              class="mt-3 px-3 py-2 rounded border border-danger-border bg-danger-surface text-11-regular text-danger-text"
            >
              Install failed: {msg()}
            </div>
          )}
        </Show>
      </div>

      <footer class="px-4 py-2 border-t border-border-weak-base text-10-regular text-text-weaker">
        Powered by{" "}
        <a
          href="https://mcpapps.vip"
          target="_blank"
          rel="noopener noreferrer"
          class="text-text-weak hover:text-text-base underline"
        >
          mcpapps.vip
        </a>
        {" · "}
        Listings curated for quality + compatibility with the MCP Apps host spec.
      </footer>
    </div>
  )
}
