/**
 * v0.9.74 — Agentic Control Panel.
 *
 * Four settings panes (Agents / Skills / Plugins / Tools) plus a
 * shared "Import" dialog that pulls skills + agents from the
 * curated catalog (Superpowers, Anthropic skills, etc.). Each pane
 * is a list view backed by `/control-panel/<kind>` — read-only in
 * this release; inline editing lands later.
 *
 * The four panes are exported as separate components so
 * dialog-settings.tsx can place them in their own `Tabs.Content`
 * slots (matches the existing settings tab pattern).
 */
import { Button } from "@librecode/ui/button"
import { Icon } from "@librecode/ui/icon"
import { createMemo, createResource, createSignal, For, Match, Show, Switch, type Component } from "solid-js"
import { useDialog } from "@librecode/ui/context/dialog"
import { useGlobalSDK } from "@/context/global-sdk"
// v0.9.75 — Control Panel endpoints are GLOBAL (not directory-scoped),
// so we deliberately do NOT call useSDK() here. The Settings dialog is
// opened from pages/layout.tsx at app-shell scope which is OUTSIDE
// any SDKProvider — useSDK() would throw "SDK context must be used
// within a context provider" the moment any of these tabs mounted.
// useGlobalSDK() lives at app root so it's always available.
import {
  type AgentEntry,
  fetchAgents,
  fetchImportSources,
  fetchPlugins,
  fetchSkills,
  fetchTools,
  formatSkillLocation,
  groupAgents,
  type ImportSourceEntry,
  removeImport,
  runImport,
  summariseImport,
} from "./settings-control-panel-client"

const sectionHeaderClass = "px-6 pt-5 pb-3 flex items-baseline gap-3"
const sectionTitleClass = "text-14-medium text-text-strong"
const sectionHintClass = "text-11-regular text-text-weaker"

export const SettingsAgents: Component = () => {
  // Global URL only — see header comment for why no useSDK().
  const globalSDK = useGlobalSDK()
  const [agents, { refetch }] = createResource(() => fetchAgents(globalSDK.fetch, globalSDK.url))
  const grouped = createMemo(() => groupAgents(agents() ?? []))

  return (
    <div class="flex flex-col h-full overflow-hidden" data-component="settings-agents">
      <header class={sectionHeaderClass}>
        <h2 class={sectionTitleClass}>Agents</h2>
        <span class={sectionHintClass}>
          Built-in agents + custom agents from your config and `~/.config/librecode/agents/*.md`.
        </span>
        <span class="flex-1" />
        <Button type="button" variant="ghost" size="small" onClick={() => refetch()}>
          Refresh
        </Button>
      </header>
      <div class="flex-1 overflow-y-auto px-6 pb-6 flex flex-col gap-5">
        <Show when={agents.loading}>
          <p class="text-12-regular text-text-weaker animate-pulse">Loading agents…</p>
        </Show>
        <Show when={!agents.loading && grouped().native.length > 0}>
          <AgentSection title="Built-in" entries={grouped().native} />
        </Show>
        <Show when={!agents.loading && grouped().user.length > 0}>
          <AgentSection title="Custom" entries={grouped().user} />
        </Show>
        <Show when={!agents.loading && grouped().native.length === 0 && grouped().user.length === 0}>
          <EmptyState
            icon="speech-bubble"
            title="No agents configured"
            hint="Add an agent to ~/.config/librecode/agents/<name>.md or import a pack from the Skills tab."
          />
        </Show>
      </div>
    </div>
  )
}

const AgentSection: Component<{ title: string; entries: AgentEntry[] }> = (props) => (
  <section class="flex flex-col gap-2">
    <h3 class="text-11-medium text-text-weaker uppercase tracking-wider">{props.title}</h3>
    <ul class="flex flex-col gap-2">
      <For each={props.entries}>
        {(a) => (
          <li
            class="rounded-md border border-border-weak-base bg-background-stronger p-3 flex flex-col gap-1"
            data-slot="agent-card"
          >
            <div class="flex items-baseline gap-2">
              <span class="text-13-medium text-text-strong">{a.name}</span>
              <span class="text-10-medium uppercase tracking-wider text-text-weaker">{a.mode}</span>
              <Show when={a.model}>
                {(m) => (
                  <code class="text-10-regular text-text-weaker font-mono">
                    {m().providerID}/{m().modelID}
                  </code>
                )}
              </Show>
            </div>
            <Show when={a.description}>
              <p class="text-12-regular text-text-weak">{a.description}</p>
            </Show>
            <Show when={a.hasPrompt && a.promptPreview}>
              <p class="text-11-regular text-text-weaker line-clamp-3">{a.promptPreview}</p>
            </Show>
          </li>
        )}
      </For>
    </ul>
  </section>
)

export const SettingsSkills: Component = () => {
  // Global URL only — see header comment for why no useSDK().
  const globalSDK = useGlobalSDK()
  const dialog = useDialog()
  const [skills, { refetch }] = createResource(() => fetchSkills(globalSDK.fetch, globalSDK.url))

  return (
    <div class="flex flex-col h-full overflow-hidden" data-component="settings-skills">
      <header class={sectionHeaderClass}>
        <h2 class={sectionTitleClass}>Skills</h2>
        <span class={sectionHintClass}>
          Discovered via `SKILL.md` files in `~/.config/librecode/skills`, project `.librecode/skills`, and
          `~/.claude/skills`.
        </span>
        <span class="flex-1" />
        <Button
          type="button"
          variant="primary"
          size="small"
          onClick={() => {
            dialog.show(() => (
              <ImportDialog
                onClose={() => dialog.close()}
                onImported={() => {
                  refetch()
                }}
              />
            ))
          }}
        >
          Import…
        </Button>
        <Button type="button" variant="ghost" size="small" onClick={() => refetch()}>
          Refresh
        </Button>
      </header>
      <div class="flex-1 overflow-y-auto px-6 pb-6">
        <Show when={skills.loading}>
          <p class="text-12-regular text-text-weaker animate-pulse">Loading skills…</p>
        </Show>
        <Show when={!skills.loading && (skills() ?? []).length === 0}>
          <EmptyState
            icon="code-lines"
            title="No skills installed"
            hint='Click "Import…" above to pull a curated pack (Superpowers, Anthropic skills) into your config.'
          />
        </Show>
        <Show when={(skills() ?? []).length > 0}>
          <ul class="flex flex-col gap-2">
            <For each={skills() ?? []}>
              {(s) => (
                <li
                  class="rounded-md border border-border-weak-base bg-background-stronger p-3 flex flex-col gap-1"
                  data-slot="skill-card"
                >
                  <div class="flex items-baseline gap-2">
                    <span class="text-13-medium text-text-strong">{s.name}</span>
                    <span class="flex-1" />
                    <code class="text-10-regular text-text-weaker font-mono truncate max-w-md" title={s.location}>
                      {formatSkillLocation(s.location)}
                    </code>
                  </div>
                  <Show when={s.description}>
                    <p class="text-12-regular text-text-weak">{s.description}</p>
                  </Show>
                  <Show when={s.preview}>
                    <p class="text-11-regular text-text-weaker line-clamp-3 font-mono">{s.preview}</p>
                  </Show>
                </li>
              )}
            </For>
          </ul>
        </Show>
      </div>
    </div>
  )
}

export const SettingsPlugins: Component = () => {
  // Global URL only — see header comment for why no useSDK().
  const globalSDK = useGlobalSDK()
  const [plugins, { refetch }] = createResource(() => fetchPlugins(globalSDK.fetch, globalSDK.url))

  return (
    <div class="flex flex-col h-full overflow-hidden" data-component="settings-plugins">
      <header class={sectionHeaderClass}>
        <h2 class={sectionTitleClass}>Plugins</h2>
        <span class={sectionHintClass}>
          Plugin hooks loaded into the host process — provider auth, tool definitions, system-prompt transforms.
        </span>
        <span class="flex-1" />
        <Button type="button" variant="ghost" size="small" onClick={() => refetch()}>
          Refresh
        </Button>
      </header>
      <div class="flex-1 overflow-y-auto px-6 pb-6">
        <Show when={plugins.loading}>
          <p class="text-12-regular text-text-weaker animate-pulse">Loading plugins…</p>
        </Show>
        <Show when={!plugins.loading && (plugins() ?? []).length === 0}>
          <EmptyState
            icon="folder-add-left"
            title="No plugins loaded"
            hint="Plugins are TS modules from npm or local file:// paths configured under `[plugin]` in librecode.jsonc."
          />
        </Show>
        <Show when={(plugins() ?? []).length > 0}>
          <ul class="flex flex-col gap-2">
            <For each={plugins() ?? []}>
              {(p) => (
                <li
                  class="rounded-md border border-border-weak-base bg-background-stronger p-3 flex flex-col gap-1"
                  data-slot="plugin-card"
                >
                  <div class="flex items-baseline gap-2">
                    <span class="text-13-medium text-text-strong">Plugin #{p.index + 1}</span>
                    <span class="flex-1" />
                    <span class="text-11-regular text-text-weaker">{p.hooks.length} hook(s)</span>
                  </div>
                  <Show when={p.hooks.length > 0}>
                    <code class="text-11-regular text-text-weaker font-mono">{p.hooks.join(", ")}</code>
                  </Show>
                </li>
              )}
            </For>
          </ul>
        </Show>
      </div>
    </div>
  )
}

export const SettingsTools: Component = () => {
  // Global URL only — see header comment for why no useSDK().
  const globalSDK = useGlobalSDK()
  const [tools, { refetch }] = createResource(() => fetchTools(globalSDK.fetch, globalSDK.url))

  return (
    <div class="flex flex-col h-full overflow-hidden" data-component="settings-tools">
      <header class={sectionHeaderClass}>
        <h2 class={sectionTitleClass}>Tools</h2>
        <span class={sectionHintClass}>
          Every tool registered with the host — built-ins (bash, edit, read, …), custom files in
          `&lt;config&gt;/tools/*.ts`, and plugin tools.
        </span>
        <span class="flex-1" />
        <Button type="button" variant="ghost" size="small" onClick={() => refetch()}>
          Refresh
        </Button>
      </header>
      <div class="flex-1 overflow-y-auto px-6 pb-6">
        <Show when={tools.loading}>
          <p class="text-12-regular text-text-weaker animate-pulse">Loading tools…</p>
        </Show>
        <Show when={!tools.loading && (tools() ?? []).length === 0}>
          <EmptyState
            icon="settings-gear"
            title="No tools registered"
            hint="Something is very wrong — restart LibreCode."
          />
        </Show>
        <Show when={(tools() ?? []).length > 0}>
          <ul class="flex flex-col gap-2">
            <For each={tools() ?? []}>
              {(t) => (
                <li
                  class="rounded-md border border-border-weak-base bg-background-stronger p-3 flex flex-col gap-1"
                  data-slot="tool-card"
                >
                  <code class="text-13-medium text-text-strong font-mono">{t.id}</code>
                  <Show when={t.description}>
                    <p class="text-12-regular text-text-weak line-clamp-2">{t.description}</p>
                  </Show>
                </li>
              )}
            </For>
          </ul>
        </Show>
      </div>
    </div>
  )
}

const EmptyState: Component<{ icon: string; title: string; hint: string }> = (props) => (
  <div class="flex flex-col items-center justify-center py-16 text-center gap-2">
    <Icon name={props.icon as never} class="size-8 text-text-weaker" />
    <p class="text-13-medium text-text-strong">{props.title}</p>
    <p class="text-11-regular text-text-weaker max-w-md">{props.hint}</p>
  </div>
)

const ImportDialog: Component<{ onClose: () => void; onImported: () => void }> = (props) => {
  // Global URL only — see header comment for why no useSDK().
  const globalSDK = useGlobalSDK()
  const [sources] = createResource(() => fetchImportSources(globalSDK.fetch, globalSDK.url))
  const [busy, setBusy] = createSignal<string | undefined>()
  const [status, setStatus] = createSignal<{ kind: "ok" | "err"; message: string } | undefined>()

  const onImport = async (s: ImportSourceEntry) => {
    setBusy(s.id)
    setStatus(undefined)
    try {
      const result = await runImport(globalSDK.fetch, globalSDK.url, s.id)
      if (!result.ok) {
        setStatus({ kind: "err", message: `Import failed: ${result.error}` })
        return
      }
      setStatus({ kind: "ok", message: summariseImport(result) })
      props.onImported()
    } finally {
      setBusy(undefined)
    }
  }

  const onRemove = async (s: ImportSourceEntry) => {
    setBusy(s.id)
    setStatus(undefined)
    try {
      const removed = await removeImport(globalSDK.fetch, globalSDK.url, s.id)
      setStatus({
        kind: "ok",
        message: removed ? `Removed imports from ${s.name}` : `${s.name} had nothing to remove`,
      })
      props.onImported()
    } finally {
      setBusy(undefined)
    }
  }

  return (
    <div
      data-component="control-panel-import-dialog"
      class="flex flex-col w-[min(720px,92vw)] max-h-[min(640px,80vh)] bg-surface-float-base rounded-md border border-border-weak-base overflow-hidden"
    >
      <header class="flex items-center gap-3 px-4 py-3 border-b border-border-weak-base">
        <Icon name="folder-add-left" class="size-4 text-text-strong" />
        <div class="flex flex-col gap-0.5">
          <span class="text-14-medium text-text-strong">Import skills + agents</span>
          <span class="text-11-regular text-text-weaker">
            Pulls from public git repositories into ~/.config/librecode/{"{"}skills,agents{"}"}/imported/&lt;source&gt;/
          </span>
        </div>
        <span class="flex-1" />
        <Button type="button" variant="ghost" size="small" onClick={props.onClose} aria-label="Close">
          <Icon name="close-small" class="size-3.5" />
        </Button>
      </header>

      <div class="flex-1 overflow-y-auto p-4 flex flex-col gap-3">
        <Switch>
          <Match when={sources.loading}>
            <p class="text-12-regular text-text-weaker animate-pulse text-center py-12">Loading sources…</p>
          </Match>
          <Match when={(sources() ?? []).length === 0}>
            <p class="text-12-regular text-text-weaker text-center py-12">
              No import sources configured. Edit `src/importer/sources.ts` to add one.
            </p>
          </Match>
          <Match when={(sources() ?? []).length > 0}>
            <For each={sources() ?? []}>
              {(s) => (
                <div
                  class="flex flex-col gap-2 p-3 rounded-md border border-border-weak-base bg-background-stronger"
                  data-slot="source-card"
                  data-source-id={s.id}
                >
                  <div class="flex items-baseline gap-2">
                    <span class="text-13-medium text-text-strong">{s.name}</span>
                    <span class="text-10-medium px-1 py-0.5 rounded bg-success-surface text-success-text">
                      {s.license}
                    </span>
                    <span class="flex-1" />
                    <a
                      href={s.homepage}
                      target="_blank"
                      rel="noopener noreferrer"
                      class="text-11-regular text-text-weaker hover:text-text-base underline"
                    >
                      {s.repo}
                    </a>
                  </div>
                  <p class="text-11-regular text-text-weak">{s.description}</p>
                  <div class="flex items-center gap-2 pt-1">
                    <span class="text-10-regular text-text-weaker">by {s.author}</span>
                    <Show when={s.contents.skills}>
                      <span class="text-10-regular text-text-weaker">· skills</span>
                    </Show>
                    <Show when={s.contents.agents}>
                      <span class="text-10-regular text-text-weaker">· agents</span>
                    </Show>
                    <span class="flex-1" />
                    <Button
                      type="button"
                      variant="ghost"
                      size="small"
                      onClick={() => onRemove(s)}
                      disabled={busy() !== undefined}
                    >
                      Remove
                    </Button>
                    <Button
                      type="button"
                      variant="primary"
                      size="small"
                      onClick={() => onImport(s)}
                      disabled={busy() !== undefined}
                    >
                      {busy() === s.id ? "Importing…" : "Import"}
                    </Button>
                  </div>
                </div>
              )}
            </For>
          </Match>
        </Switch>

        <Show when={status()}>
          {(s) => (
            <div
              role="alert"
              class="px-3 py-2 rounded text-11-regular border"
              classList={{
                "border-success-border bg-success-surface text-success-text": s().kind === "ok",
                "border-danger-border bg-danger-surface text-danger-text": s().kind === "err",
              }}
            >
              {s().message}
            </div>
          )}
        </Show>
      </div>

      <footer class="px-4 py-2 border-t border-border-weak-base text-10-regular text-text-weaker">
        Imports clone via git into `~/.cache/librecode/imports/&lt;source&gt;/` then copy `SKILL.md` + `agents/*.md`
        into your config. Re-importing refreshes the source.
      </footer>
    </div>
  )
}
