/**
 * ActivityGrid — real-time visualization of agent file and tool activity.
 *
 * Layout:
 *   - Agent status bar at the top: one chip per active agent showing
 *     current phase/tool/file
 *   - File activity grid below: one cell per touched file, colored by
 *     the most recent activity kind
 *
 * Activity kinds → colors (CSS var tokens):
 *   read   → --color-blue-500   (informational)
 *   write  → --color-orange-500 (mutating)
 *   shell  → --color-purple-500 (execution)
 *   search → --color-green-500  (discovery)
 *   other  → --color-text-weaker
 *   idle   → --color-border-weaker-base (dim)
 *
 * Data source:
 *   - Initial state: REST GET /session/:id/activity
 *   - Live updates: activity.updated SSE event via useGlobalSDK event bus
 */

import { createEffect, createResource, createSignal, For, onCleanup, Show, type JSX } from "solid-js"
import { createStore, reconcile } from "solid-js/store"
import type { EventActivityAgentEntry, EventActivityFileEntry, EventActivityUpdated } from "@librecode/sdk/v2/client"
import { useGlobalSDK } from "@/context/global-sdk"
import { useSDK } from "@/context/sdk"

// ─── Types ────────────────────────────────────────────────────────────────────

type FileActivity = EventActivityFileEntry
type AgentActivity = EventActivityAgentEntry

type ActivityState = {
  files: Record<string, FileActivity>
  agents: Record<string, AgentActivity>
}

// ─── Color mapping ────────────────────────────────────────────────────────────

const KIND_CLASSES: Record<string, string> = {
  read: "bg-blue-500/70",
  write: "bg-orange-500/70",
  shell: "bg-purple-500/70",
  search: "bg-green-500/70",
  other: "bg-text-weaker/40",
  idle: "bg-border-weaker-base/60",
}

const KIND_LABEL: Record<string, string> = {
  read: "reading",
  write: "writing",
  shell: "shell",
  search: "searching",
  other: "active",
  idle: "idle",
}

function kindClass(kind: string): string {
  return KIND_CLASSES[kind] ?? KIND_CLASSES.other!
}

// ─── Fetch helpers ────────────────────────────────────────────────────────────

async function fetchActivity(baseUrl: string, directory: string, sessionID: string): Promise<ActivityState> {
  const url = new URL(`${baseUrl}/session/${sessionID}/activity`)
  url.searchParams.set("directory", directory)
  const res = await fetch(url.toString())
  if (!res.ok) throw new Error(`activity fetch failed: ${res.status}`)
  return res.json() as Promise<ActivityState>
}

// ─── Agent status bar ─────────────────────────────────────────────────────────

function AgentStatusBar(props: { agents: Record<string, AgentActivity> }): JSX.Element {
  const entries = () => Object.values(props.agents)

  return (
    <Show when={entries().length > 0}>
      <div
        class="flex flex-wrap gap-1.5 px-3 py-2 border-b border-border-weaker-base shrink-0"
        aria-label="Agent activity"
      >
        <For each={entries()}>
          {(agent) => (
            <div
              class="flex items-center gap-1.5 px-2 py-1 rounded-md bg-background-subtle text-11-regular max-w-[200px]"
              title={
                agent.file ? `${agent.agentID}: ${agent.phase} — ${agent.file}` : `${agent.agentID}: ${agent.phase}`
              }
            >
              <span class="text-text-weak shrink-0">{agent.agentID}</span>
              <span class="text-text-weaker">·</span>
              <span class="text-text-base truncate">{agent.tool ?? agent.phase}</span>
              <Show when={agent.file}>
                <span class="text-text-weaker truncate">{shortPath(agent.file!)}</span>
              </Show>
            </div>
          )}
        </For>
      </div>
    </Show>
  )
}

// ─── File activity cell ───────────────────────────────────────────────────────

function FileCell(props: { file: FileActivity }): JSX.Element {
  const isActive = () => props.file.kind !== "idle"

  return (
    <div
      class={`relative group rounded-sm transition-colors duration-200 ${kindClass(props.file.kind)}`}
      style={{ width: "12px", height: "12px" }}
      title={`${props.file.path}\n${KIND_LABEL[props.file.kind] ?? props.file.kind}${props.file.tool ? ` (${props.file.tool})` : ""}`}
      role="img"
      aria-label={`${props.file.path}: ${props.file.kind}`}
    >
      <Show when={isActive()}>
        <span class="absolute inset-0 rounded-sm animate-ping opacity-40 bg-current" />
      </Show>
    </div>
  )
}

// ─── File activity legend ─────────────────────────────────────────────────────

function ActivityLegend(): JSX.Element {
  const entries: Array<{ kind: string; label: string }> = [
    { kind: "read", label: "read" },
    { kind: "write", label: "write" },
    { kind: "shell", label: "shell" },
    { kind: "search", label: "search" },
    { kind: "idle", label: "idle" },
  ]

  return (
    <div class="flex flex-wrap gap-x-3 gap-y-1 px-3 py-1.5 border-t border-border-weaker-base shrink-0">
      <For each={entries}>
        {(entry) => (
          <div class="flex items-center gap-1">
            <div class={`w-2.5 h-2.5 rounded-sm ${kindClass(entry.kind)}`} />
            <span class="text-10-regular text-text-weaker">{entry.label}</span>
          </div>
        )}
      </For>
    </div>
  )
}

// ─── File grid ────────────────────────────────────────────────────────────────

function FileGrid(props: { files: Record<string, FileActivity> }): JSX.Element {
  const files = () => Object.values(props.files).sort((a, b) => b.updatedAt - a.updatedAt)

  return (
    <Show
      when={files().length > 0}
      fallback={
        <div class="flex-1 flex items-center justify-center">
          <span class="text-12-regular text-text-weaker">No file activity yet</span>
        </div>
      }
    >
      <div class="flex-1 overflow-y-auto px-3 py-2">
        <div class="flex flex-wrap gap-1" role="list" aria-label="File activity grid">
          <For each={files()}>{(file) => <FileCell file={file} />}</For>
        </div>
      </div>
    </Show>
  )
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function shortPath(path: string): string {
  const parts = path.split("/")
  if (parts.length <= 2) return path
  return `…/${parts.slice(-2).join("/")}`
}

// ─── ActivityTab — the side-panel tab content ─────────────────────────────────

export interface ActivityTabProps {
  sessionID: string
}

export function ActivityTab(props: ActivityTabProps): JSX.Element {
  const sdk = useSDK()
  const globalSDK = useGlobalSDK()

  const [store, setStore] = createStore<ActivityState>({ files: {}, agents: {} })

  // Initial fetch
  const [initial] = createResource(
    () => props.sessionID,
    (id) => fetchActivity(sdk.url, sdk.directory, id),
  )

  // Seed store from initial fetch
  createEffect(() => {
    const data = initial()
    if (!data) return
    setStore(reconcile(data))
  })

  // Live updates via SSE
  createEffect(() => {
    const unsub = globalSDK.event.listen((e) => {
      const event = e.details
      if (event.type !== "activity.updated") return
      const activity = (event as EventActivityUpdated).properties
      if (activity.sessionID !== props.sessionID) return
      setStore(reconcile({ files: activity.files, agents: activity.agents }))
    })
    onCleanup(unsub)
  })

  return (
    <div class="w-full h-full flex flex-col overflow-hidden" data-component="activity-tab">
      <Show when={initial.loading && Object.keys(store.files).length === 0}>
        <div class="flex-1 flex items-center justify-center">
          <span class="text-12-regular text-text-weak animate-pulse">Loading activity…</span>
        </div>
      </Show>

      <Show when={!initial.loading || Object.keys(store.files).length > 0}>
        <AgentStatusBar agents={store.agents} />
        <FileGrid files={store.files} />
        <ActivityLegend />
      </Show>
    </div>
  )
}
