import { createWriteStream } from "node:fs"
import fs from "node:fs/promises"
import path from "node:path"
import z from "zod"
import { Global } from "../global"
import { Glob } from "./glob"
import { redactSecrets, redactSecretsInString } from "./redact"

export const Level = z.enum(["DEBUG", "INFO", "WARN", "ERROR"]).meta({ ref: "LogLevel", description: "Log level" })
export type Level = z.infer<typeof Level>

export type Logger = {
  debug(message?: unknown, extra?: Record<string, unknown>): void
  info(message?: unknown, extra?: Record<string, unknown>): void
  error(message?: unknown, extra?: Record<string, unknown>): void
  warn(message?: unknown, extra?: Record<string, unknown>): void
  tag(key: string, value: string): Logger
  clone(): Logger
  time(
    message: string,
    extra?: Record<string, unknown>,
  ): {
    stop(): void
    [Symbol.dispose](): void
  }
}

export interface Options {
  print: boolean
  dev?: boolean
  level?: Level
}

const levelPriority: Record<Level, number> = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
}

let level: Level = "INFO"

function shouldLog(input: Level): boolean {
  return levelPriority[input] >= levelPriority[level]
}

const loggers = new Map<string, Logger>()

let logpath = ""
function logFile() {
  return logpath
}

let write: (msg: string) => unknown = (msg: string) => {
  process.stderr.write(msg)
  return msg.length
}

async function logInit(options: Options) {
  if (options.level) level = options.level
  cleanup(Global.Path.log)
  if (options.print) return
  logpath = path.join(
    Global.Path.log,
    options.dev ? "dev.log" : `${new Date().toISOString().split(".")[0].replace(/:/g, "")}.log`,
  )
  await fs.truncate(logpath).catch(() => {})
  const stream = createWriteStream(logpath, { flags: "a" })
  write = async (msg: string) => {
    return new Promise((resolve, reject) => {
      stream.write(msg, (err) => {
        if (err) reject(err)
        else resolve(msg.length)
      })
    })
  }
}

async function cleanup(dir: string) {
  const files = await Glob.scan("????-??-??T??????.log", {
    cwd: dir,
    absolute: true,
    include: "file",
  })
  if (files.length <= 5) return

  const filesToDelete = files.slice(0, -10)
  await Promise.all(filesToDelete.map((file) => fs.unlink(file).catch(() => {})))
}

function formatError(error: Error, depth = 0): string {
  const result = error.message
  return error.cause instanceof Error && depth < 10
    ? `${result} Caused by: ${formatError(error.cause, depth + 1)}`
    : result
}

let last = Date.now()
function logCreate(tags?: Record<string, unknown>): Logger {
  tags = tags || {}

  const service = tags.service
  if (service && typeof service === "string") {
    const cached = loggers.get(service)
    if (cached) {
      return cached
    }
  }

  function build(message: unknown, extra?: Record<string, unknown>) {
    // A02/A09 — redact secret-looking values before anything touches
    // the log sink. Walks nested objects, replaces values at
    // known-secret keys, and scrubs inline patterns (GitHub tokens,
    // sk-* keys, JWTs, AWS key IDs) in string values.
    const safeTags = redactSecrets(tags)
    const safeExtra = extra ? redactSecrets(extra) : undefined
    const prefix = Object.entries({
      ...safeTags,
      ...safeExtra,
    })
      .filter(([_, value]) => value !== undefined && value !== null)
      .map(([key, value]) => {
        const prefix = `${key}=`
        if (value instanceof Error) return prefix + redactSecretsInString(formatError(value))
        if (typeof value === "object") return prefix + JSON.stringify(value)
        return prefix + redactSecretsInString(String(value))
      })
      .join(" ")
    const next = new Date()
    const diff = next.getTime() - last
    last = next.getTime()
    const safeMessage = typeof message === "string" ? redactSecretsInString(message) : message
    return `${[next.toISOString().split(".")[0], `+${diff}ms`, prefix, safeMessage].filter(Boolean).join(" ")}\n`
  }
  const result: Logger = {
    debug(message?: unknown, extra?: Record<string, unknown>) {
      if (shouldLog("DEBUG")) {
        write(`DEBUG ${build(message, extra)}`)
      }
    },
    info(message?: unknown, extra?: Record<string, unknown>) {
      if (shouldLog("INFO")) {
        write(`INFO  ${build(message, extra)}`)
      }
    },
    error(message?: unknown, extra?: Record<string, unknown>) {
      if (shouldLog("ERROR")) {
        write(`ERROR ${build(message, extra)}`)
      }
    },
    warn(message?: unknown, extra?: Record<string, unknown>) {
      if (shouldLog("WARN")) {
        write(`WARN  ${build(message, extra)}`)
      }
    },
    tag(key: string, value: string) {
      if (tags) tags[key] = value
      return result
    },
    clone() {
      return logCreate({ ...tags })
    },
    time(message: string, extra?: Record<string, unknown>) {
      const now = Date.now()
      result.info(message, { status: "started", ...extra })
      function stop() {
        result.info(message, {
          status: "completed",
          duration: Date.now() - now,
          ...extra,
        })
      }
      return {
        stop,
        [Symbol.dispose]() {
          stop()
        },
      }
    },
  }

  if (service && typeof service === "string") {
    loggers.set(service, result)
  }

  return result
}

const Default = logCreate({ service: "default" })

export const Log = {
  Level,
  Default,
  file: logFile,
  init: logInit,
  create: logCreate,
} as const
