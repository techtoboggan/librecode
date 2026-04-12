import { type ChildProcess, spawn as launch } from "node:child_process"
import { buffer } from "node:stream/consumers"

export type ProcessStdio = "inherit" | "pipe" | "ignore"

export interface ProcessOptions {
  cwd?: string
  env?: NodeJS.ProcessEnv | null
  stdin?: ProcessStdio
  stdout?: ProcessStdio
  stderr?: ProcessStdio
  abort?: AbortSignal
  kill?: NodeJS.Signals | number
  timeout?: number
}

export interface ProcessRunOptions extends Omit<ProcessOptions, "stdout" | "stderr"> {
  nothrow?: boolean
}

export interface ProcessResult {
  code: number
  stdout: Buffer
  stderr: Buffer
}

export interface ProcessTextResult extends ProcessResult {
  text: string
}

export class ProcessRunFailedError extends Error {
  readonly cmd: string[]
  readonly code: number
  readonly stdout: Buffer
  readonly stderr: Buffer

  constructor(cmd: string[], code: number, stdout: Buffer, stderr: Buffer) {
    const text = stderr.toString().trim()
    super(
      text
        ? `Command failed with code ${code}: ${cmd.join(" ")}\n${text}`
        : `Command failed with code ${code}: ${cmd.join(" ")}`,
    )
    this.name = "ProcessRunFailedError"
    this.cmd = [...cmd]
    this.code = code
    this.stdout = stdout
    this.stderr = stderr
  }
}

export type ProcessChild = ChildProcess & { exited: Promise<number> }

function processSpawn(cmd: string[], opts: ProcessOptions = {}): ProcessChild {
  if (cmd.length === 0) throw new Error("Command is required")
  opts.abort?.throwIfAborted()

  const proc = launch(cmd[0], cmd.slice(1), {
    cwd: opts.cwd,
    env: opts.env === null ? {} : opts.env ? { ...process.env, ...opts.env } : undefined,
    stdio: [opts.stdin ?? "ignore", opts.stdout ?? "ignore", opts.stderr ?? "ignore"],
    windowsHide: process.platform === "win32",
  })

  let closed = false
  let timer: ReturnType<typeof setTimeout> | undefined

  const abort = () => {
    if (closed) return
    if (proc.exitCode !== null || proc.signalCode !== null) return
    closed = true

    proc.kill(opts.kill ?? "SIGTERM")

    const ms = opts.timeout ?? 5_000
    if (ms <= 0) return
    timer = setTimeout(() => proc.kill("SIGKILL"), ms)
  }

  const exited = new Promise<number>((resolve, reject) => {
    const done = () => {
      opts.abort?.removeEventListener("abort", abort)
      if (timer) clearTimeout(timer)
    }

    proc.once("exit", (code, signal) => {
      done()
      resolve(code ?? (signal ? 1 : 0))
    })

    proc.once("error", (error) => {
      done()
      reject(error)
    })
  })

  if (opts.abort) {
    opts.abort.addEventListener("abort", abort, { once: true })
    if (opts.abort.aborted) abort()
  }

  const child = proc as ProcessChild
  child.exited = exited
  return child
}

async function processRun(cmd: string[], opts: ProcessRunOptions = {}): Promise<ProcessResult> {
  const proc = processSpawn(cmd, {
    cwd: opts.cwd,
    env: opts.env,
    stdin: opts.stdin,
    abort: opts.abort,
    kill: opts.kill,
    timeout: opts.timeout,
    stdout: "pipe",
    stderr: "pipe",
  })

  if (!proc.stdout || !proc.stderr) throw new Error("Process output not available")

  const out = await Promise.all([proc.exited, buffer(proc.stdout), buffer(proc.stderr)])
    .then(([code, stdout, stderr]) => ({
      code,
      stdout,
      stderr,
    }))
    .catch((err: unknown) => {
      if (!opts.nothrow) throw err
      return {
        code: 1,
        stdout: Buffer.alloc(0),
        stderr: Buffer.from(err instanceof Error ? err.message : String(err)),
      }
    })
  if (out.code === 0 || opts.nothrow) return out
  throw new ProcessRunFailedError(cmd, out.code, out.stdout, out.stderr)
}

async function processText(cmd: string[], opts: ProcessRunOptions = {}): Promise<ProcessTextResult> {
  const out = await processRun(cmd, opts)
  return {
    ...out,
    text: out.stdout.toString(),
  }
}

async function processLines(cmd: string[], opts: ProcessRunOptions = {}): Promise<string[]> {
  return (await processText(cmd, opts)).text.split(/\r?\n/).filter(Boolean)
}

export const Process = {
  spawn: processSpawn,
  run: processRun,
  text: processText,
  lines: processLines,
  RunFailedError: ProcessRunFailedError,
} as const

// biome-ignore lint/style/noNamespace: type companion for declaration merging
export declare namespace Process {
  type Stdio = ProcessStdio
  type Options = ProcessOptions
  type RunOptions = ProcessRunOptions
  type Result = ProcessResult
  type TextResult = ProcessTextResult
  type Child = ProcessChild
  type RunFailedError = ProcessRunFailedError
}
