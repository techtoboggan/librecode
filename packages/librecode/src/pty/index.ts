import { lazy } from "@librecode/util/lazy"
import type { IPty } from "bun-pty"
import z from "zod"
import { Bus } from "@/bus"
import { BusEvent } from "@/bus/bus-event"
import { Plugin } from "@/plugin"
import { Shell } from "@/shell/shell"
import { Instance } from "../project/instance"
import { Log } from "../util/log"
import { PtyID } from "./schema"

// ---------------------------------------------------------------------------
// Module-level helpers
// ---------------------------------------------------------------------------

interface ActiveSessionShape {
  cursor: number
  subscribers: Map<
    unknown,
    {
      readyState: number
      data?: unknown
      send: (d: string | Uint8Array | ArrayBuffer) => void
      close: (code?: number, reason?: string) => void
    }
  >
  buffer: string
  bufferCursor: number
}

function handlePtyData(session: ActiveSessionShape & { buffer: string; bufferCursor: number }, chunk: string): void {
  const BUFFER_LIMIT = 1024 * 1024 * 2
  session.cursor += chunk.length

  for (const [key, ws] of session.subscribers.entries()) {
    if (ws.readyState !== 1 || ws.data !== key) {
      session.subscribers.delete(key)
      continue
    }
    try {
      ws.send(chunk)
    } catch {
      session.subscribers.delete(key)
    }
  }

  session.buffer += chunk
  if (session.buffer.length <= BUFFER_LIMIT) return
  const excess = session.buffer.length - BUFFER_LIMIT
  session.buffer = session.buffer.slice(excess)
  session.bufferCursor += excess
}

function sliceBufferedData(session: ActiveSessionShape, from: number): string {
  if (!session.buffer) return ""
  const end = session.cursor
  if (from >= end) return ""
  const offset = Math.max(0, from - session.bufferCursor)
  if (offset >= session.buffer.length) return ""
  return session.buffer.slice(offset)
}

function resolveCursorFrom(cursor: number | undefined, end: number): number {
  if (cursor === -1) return end
  if (typeof cursor === "number" && Number.isSafeInteger(cursor)) return Math.max(0, cursor)
  return 0
}

function sendBufferedData(
  ws: { send: (d: string | Uint8Array | ArrayBuffer) => void; close: (code?: number, reason?: string) => void },
  data: string,
  chunkSize: number,
  cleanup: () => void,
): boolean {
  try {
    for (let i = 0; i < data.length; i += chunkSize) ws.send(data.slice(i, i + chunkSize))
    return true
  } catch {
    cleanup()
    ws.close()
    return false
  }
}

// ---------------------------------------------------------------------------
// Module-level state (shared across all exported functions)
// ---------------------------------------------------------------------------

const _ptyLog = Log.create({ service: "pty" })

const _BUFFER_CHUNK = 64 * 1024
const _encoder = new TextEncoder()

type PtySocket = {
  readyState: number
  data?: unknown
  send: (data: string | Uint8Array | ArrayBuffer) => void
  close: (code?: number, reason?: string) => void
}

// WebSocket control frame: 0x00 + UTF-8 JSON.
const _meta = (cursor: number) => {
  const json = JSON.stringify({ cursor })
  const bytes = _encoder.encode(json)
  const out = new Uint8Array(bytes.length + 1)
  out[0] = 0
  out.set(bytes, 1)
  return out
}

const _ptySpawn = lazy(async () => {
  const { spawn } = await import("bun-pty")
  return spawn
})

export const Info = z
  .object({
    id: PtyID.zod,
    title: z.string(),
    command: z.string(),
    args: z.array(z.string()),
    cwd: z.string(),
    status: z.enum(["running", "exited"]),
    pid: z.number(),
  })
  .meta({ ref: "Pty" })

export type Info = z.infer<typeof Info>

export const CreateInput = z.object({
  command: z.string().optional(),
  args: z.array(z.string()).optional(),
  cwd: z.string().optional(),
  title: z.string().optional(),
  env: z.record(z.string(), z.string()).optional(),
})

export type CreateInput = z.infer<typeof CreateInput>

export const UpdateInput = z.object({
  title: z.string().optional(),
  size: z
    .object({
      rows: z.number(),
      cols: z.number(),
    })
    .optional(),
})

export type UpdateInput = z.infer<typeof UpdateInput>

export const Event = {
  Created: BusEvent.define("pty.created", z.object({ info: Info })),
  Updated: BusEvent.define("pty.updated", z.object({ info: Info })),
  Exited: BusEvent.define("pty.exited", z.object({ id: PtyID.zod, exitCode: z.number() })),
  Deleted: BusEvent.define("pty.deleted", z.object({ id: PtyID.zod })),
}

interface ActiveSession {
  info: Info
  process: IPty
  buffer: string
  bufferCursor: number
  cursor: number
  subscribers: Map<unknown, PtySocket>
}

const _state = Instance.state(
  () => new Map<PtyID, ActiveSession>(),
  async (sessions) => {
    for (const session of sessions.values()) {
      try {
        session.process.kill()
      } catch {}
      for (const [key, ws] of session.subscribers.entries()) {
        try {
          if (ws.data === key) ws.close()
        } catch {
          // ignore
        }
      }
    }
    sessions.clear()
  },
)

function ptyList(): Info[] {
  return Array.from(_state().values()).map((s) => s.info)
}

function ptyGet(id: PtyID): Info | undefined {
  return _state().get(id)?.info
}

async function ptyCreate(input: CreateInput): Promise<Info> {
  const id = PtyID.ascending()
  const command = input.command || Shell.preferred()
  const args = input.args || []
  if (command.endsWith("sh")) {
    args.push("-l")
  }

  const cwd = input.cwd || Instance.directory
  const shellEnv = await Plugin.trigger("shell.env", { cwd }, { env: {} })
  const env = {
    ...process.env,
    ...input.env,
    ...shellEnv.env,
    TERM: "xterm-256color",
    LIBRECODE_TERMINAL: "1",
  } as Record<string, string>

  if (process.platform === "win32") {
    env.LC_ALL = "C.UTF-8"
    env.LC_CTYPE = "C.UTF-8"
    env.LANG = "C.UTF-8"
  }
  _ptyLog.info("creating session", { id, cmd: command, args, cwd })

  const spawn = await _ptySpawn()
  const ptyProcess = spawn(command, args, {
    name: "xterm-256color",
    cwd,
    env,
  })

  const info = {
    id,
    title: input.title || `Terminal ${id.slice(-4)}`,
    command,
    args,
    cwd,
    status: "running",
    pid: ptyProcess.pid,
  } as const
  const session: ActiveSession = {
    info,
    process: ptyProcess,
    buffer: "",
    bufferCursor: 0,
    cursor: 0,
    subscribers: new Map(),
  }
  _state().set(id, session)
  ptyProcess.onData((chunk) => handlePtyData(session, chunk))
  ptyProcess.onExit(({ exitCode }) => {
    if (session.info.status === "exited") return
    _ptyLog.info("session exited", { id, exitCode })
    session.info.status = "exited"
    Bus.publish(Event.Exited, { id, exitCode })
    ptyRemove(id)
  })
  Bus.publish(Event.Created, { info })
  return info
}

async function ptyUpdate(id: PtyID, input: UpdateInput): Promise<Info | undefined> {
  const session = _state().get(id)
  if (!session) return
  if (input.title) {
    session.info.title = input.title
  }
  if (input.size) {
    session.process.resize(input.size.cols, input.size.rows)
  }
  Bus.publish(Event.Updated, { info: session.info })
  return session.info
}

async function ptyRemove(id: PtyID): Promise<void> {
  const session = _state().get(id)
  if (!session) return
  _state().delete(id)
  _ptyLog.info("removing session", { id })
  try {
    session.process.kill()
  } catch {}
  for (const [key, ws] of session.subscribers.entries()) {
    try {
      if (ws.data === key) ws.close()
    } catch {
      // ignore
    }
  }
  session.subscribers.clear()
  Bus.publish(Event.Deleted, { id: session.info.id })
}

function ptyResize(id: PtyID, cols: number, rows: number): void {
  const session = _state().get(id)
  if (session && session.info.status === "running") {
    session.process.resize(cols, rows)
  }
}

function ptyWrite(id: PtyID, data: string): void {
  const session = _state().get(id)
  if (session && session.info.status === "running") {
    session.process.write(data)
  }
}

function ptyConnect(
  id: PtyID,
  ws: PtySocket,
  cursor?: number,
): { onMessage: (message: string | ArrayBuffer) => void; onClose: () => void } | undefined {
  const session = _state().get(id)
  if (!session) {
    ws.close()
    return
  }
  _ptyLog.info("client connected to session", { id })

  // Use ws.data as the unique key for this connection lifecycle.
  // If ws.data is undefined, fallback to ws object.
  const connectionKey = ws.data && typeof ws.data === "object" ? ws.data : ws
  session.subscribers.delete(connectionKey)
  session.subscribers.set(connectionKey, ws)

  const cleanup = () => {
    session.subscribers.delete(connectionKey)
  }

  const end = session.cursor
  const from = resolveCursorFrom(cursor, end)
  const data = sliceBufferedData(session, from)

  if (data && !sendBufferedData(ws, data, _BUFFER_CHUNK, cleanup)) return

  try {
    ws.send(_meta(end))
  } catch {
    cleanup()
    ws.close()
    return
  }

  return {
    onMessage: (message: string | ArrayBuffer) => {
      session.process.write(String(message))
    },
    onClose: () => {
      _ptyLog.info("client disconnected from session", { id })
      cleanup()
    },
  }
}

export const Pty = {
  list: ptyList,
  get: ptyGet,
  create: ptyCreate,
  update: ptyUpdate,
  remove: ptyRemove,
  resize: ptyResize,
  write: ptyWrite,
  connect: ptyConnect,
  Info,
  CreateInput,
  UpdateInput,
  Event,
} as const

// biome-ignore lint/style/noNamespace: type companion for declaration merging
export declare namespace Pty {
  type Info = z.infer<typeof Info>
  type CreateInput = z.infer<typeof CreateInput>
  type UpdateInput = z.infer<typeof UpdateInput>
}
