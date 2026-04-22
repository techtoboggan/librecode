/**
 * ActivityTracker — real-time file and agent activity state for a session.
 *
 * Subscribes to bus events and maintains a live map of:
 *   - Per-file activity: read / write / search / shell / idle + last-touched timestamp
 *   - Per-agent activity: current tool, current file, state machine phase
 *
 * Data is exposed via `ActivityTracker.get(sessionID)` and via the
 * `ActivityTracker.Updated` bus event so the frontend can subscribe
 * to incremental pushes over SSE.
 *
 * Tool → activity-kind classification:
 *   read, glob, grep, codesearch          → "read"
 *   edit, write, apply_patch, multiedit   → "write"
 *   bash                                  → "shell"
 *   websearch, webfetch                   → "search"
 *   everything else                       → "other"
 */

import z from "zod/v4"
import type { ToolPart } from "@/session/message-v2-parts"
import { BusEvent } from "../bus/bus-event"
import { Bus } from "../bus"
import { File as FileModule } from "../file"
import { TransitionEvent } from "./agent-loop"
import { MessageV2 } from "./message-v2"
import { Instance } from "../project/instance"
import type { SessionID } from "./schema"

// ─── Types ────────────────────────────────────────────────────────────────────

export type ActivityKind = "read" | "write" | "shell" | "search" | "other" | "idle"

const FileActivity = z
  .object({
    path: z.string(),
    kind: z.enum(["read", "write", "shell", "search", "other", "idle"]),
    tool: z.string().optional(),
    updatedAt: z.number(),
  })
  .meta({ ref: "FileActivity" })

const AgentActivity = z
  .object({
    agentID: z.string(),
    phase: z.string(),
    tool: z.string().optional(),
    file: z.string().optional(),
    updatedAt: z.number(),
  })
  .meta({ ref: "AgentActivity" })

const SessionActivity = z
  .object({
    sessionID: z.string(),
    files: z.record(z.string(), FileActivity),
    agents: z.record(z.string(), AgentActivity),
    updatedAt: z.number(),
  })
  .meta({ ref: "SessionActivity" })

export type FileActivity = z.infer<typeof FileActivity>
export type AgentActivity = z.infer<typeof AgentActivity>
export type SessionActivity = z.infer<typeof SessionActivity>

// ─── Bus event ────────────────────────────────────────────────────────────────

const Updated = BusEvent.define(
  "activity.updated",
  z.object({
    sessionID: z.string(),
    files: z.record(z.string(), FileActivity),
    agents: z.record(z.string(), AgentActivity),
    updatedAt: z.number(),
  }),
)

// ─── Tool classification ──────────────────────────────────────────────────────

const READ_TOOLS = new Set(["read", "glob", "grep", "codesearch", "lsp"])
const WRITE_TOOLS = new Set(["edit", "write", "apply_patch", "multiedit"])
const SHELL_TOOLS = new Set(["bash"])
const SEARCH_TOOLS = new Set(["websearch", "webfetch"])

function classifyTool(tool: string): ActivityKind {
  if (READ_TOOLS.has(tool)) return "read"
  if (WRITE_TOOLS.has(tool)) return "write"
  if (SHELL_TOOLS.has(tool)) return "shell"
  if (SEARCH_TOOLS.has(tool)) return "search"
  return "other"
}

/** Extract a file path from a tool's input arguments, if applicable. */
function fileFromInput(tool: string, input: Record<string, unknown>): string | undefined {
  if (READ_TOOLS.has(tool) || WRITE_TOOLS.has(tool)) {
    const path = input.filePath ?? input.path ?? input.file_path
    if (typeof path === "string") return path
  }
  return undefined
}

// ─── State ────────────────────────────────────────────────────────────────────

type ActivityState = {
  sessions: Map<string, SessionActivity>
  unsubs: Array<() => void>
}

function emptySession(sessionID: string): SessionActivity {
  return { sessionID, files: {}, agents: {}, updatedAt: Date.now() }
}

function emptyState(): ActivityState {
  return { sessions: new Map(), unsubs: [] }
}

function getOrCreate(state: ActivityState, sessionID: string): SessionActivity {
  let s = state.sessions.get(sessionID)
  if (!s) {
    s = emptySession(sessionID)
    state.sessions.set(sessionID, s)
  }
  return s
}

function publishUpdate(session: SessionActivity) {
  Bus.publish(Updated, {
    sessionID: session.sessionID,
    files: session.files,
    agents: session.agents,
    updatedAt: session.updatedAt,
  }).catch(() => {})
}

// ─── Event handlers ───────────────────────────────────────────────────────────

function handlePartUpdated(state: ActivityState, part: ToolPart, sessionID: string) {
  const session = getOrCreate(state, sessionID)
  const now = Date.now()
  const kind = classifyTool(part.tool)
  const agentID = part.messageID ?? "main"

  // Update agent state
  const inputRecord = (part.state.input ?? {}) as Record<string, unknown>
  const filePath = fileFromInput(part.tool, inputRecord)
  session.agents[agentID] = {
    agentID,
    phase: part.state.status,
    tool: part.tool,
    file: filePath,
    updatedAt: now,
  }

  // v0.9.59 — keep the classified tool kind (read/write/shell/search)
  // on the file record regardless of whether the tool is still
  // running or has just completed. Previously we flipped to "idle"
  // the moment `status === "completed"`, which for fast tools
  // (read / grep / glob finish in milliseconds) meant the graph
  // never showed any colour — the nodes went straight from "not
  // there" to "grey". The iframe fades nodes via alpha based on
  // `age`, so stale activity still dims naturally; we just let the
  // colour reflect what the tool actually did.
  if (filePath && kind !== "other") {
    session.files[filePath] = {
      path: filePath,
      kind,
      tool: part.tool,
      updatedAt: now,
    }
  }

  session.updatedAt = now
  publishUpdate(session)
}

function handleFileEdited(state: ActivityState, file: string, sessionID: string | undefined) {
  if (!sessionID) return
  const session = getOrCreate(state, sessionID)
  const now = Date.now()
  session.files[file] = {
    path: file,
    kind: "write",
    tool: "edit",
    updatedAt: now,
  }
  session.updatedAt = now
  publishUpdate(session)
}

function handleAgentTransition(state: ActivityState, sessionID: string, _from: string, to: string) {
  const session = getOrCreate(state, sessionID)
  const now = Date.now()
  const agentID = "main"
  session.agents[agentID] = {
    ...(session.agents[agentID] ?? { agentID }),
    agentID,
    phase: to,
    updatedAt: now,
  }
  // v0.9.59 — previously we flipped every file's `kind` to "idle" on
  // agent exit, which immediately wiped the colour-coded activity
  // trail users wanted to see after a turn ended. Fade is handled
  // client-side by `age`-based alpha in fs-activity-graph.html;
  // we just leave the files' classified kind alone so the iframe
  // can keep showing what the turn touched until natural decay.
  session.updatedAt = now
  publishUpdate(session)
}

// ─── Instance-scoped singleton ────────────────────────────────────────────────

const activityState = Instance.state(
  (): ActivityState => {
    const state = emptyState()

    state.unsubs = [
      // Tool call progress (the primary source)
      Bus.subscribe(MessageV2.Event.PartUpdated, (ev) => {
        const part = ev.properties.part
        if (part.type !== "tool") return
        handlePartUpdated(state, part as ToolPart, part.sessionID)
      }),

      // Direct file edits (catches writes that may not surface a file path in input)
      Bus.subscribe(FileModule.Event.Edited, (ev) => {
        // We don't know the sessionID here; best-effort: update whichever session
        // most recently touched this file. For now, broadcast to all sessions.
        for (const session of state.sessions.values()) {
          handleFileEdited(state, ev.properties.file, session.sessionID)
        }
      }),

      // Agent loop state transitions
      Bus.subscribe(TransitionEvent, (ev) => {
        const { sessionID, from, to } = ev.properties
        handleAgentTransition(state, sessionID, from, to)
      }),
    ]

    return state
  },
  async (current) => {
    for (const unsub of current.unsubs) unsub()
    current.sessions.clear()
    current.unsubs = []
  },
)

// ─── Public API ───────────────────────────────────────────────────────────────

async function get(sessionID: SessionID): Promise<SessionActivity> {
  const state = await activityState()
  return state.sessions.get(sessionID) ?? emptySession(sessionID)
}

export const ActivityTracker = {
  FileActivity,
  AgentActivity,
  SessionActivity,
  Updated,
  get,
} as const

// biome-ignore lint/style/noNamespace: type companion
export declare namespace ActivityTracker {
  type FileActivity = z.infer<typeof FileActivity>
  type AgentActivity = z.infer<typeof AgentActivity>
  type SessionActivity = z.infer<typeof SessionActivity>
}
