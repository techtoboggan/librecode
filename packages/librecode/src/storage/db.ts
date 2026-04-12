import { Database as BunDatabase } from "bun:sqlite"
import { drizzle, type SQLiteBunDatabase } from "drizzle-orm/bun-sqlite"
import { migrate } from "drizzle-orm/bun-sqlite/migrator"
import type { SQLiteTransaction } from "drizzle-orm/sqlite-core"

export * from "drizzle-orm"

import { existsSync, readdirSync, readFileSync } from "node:fs"
import path from "node:path"
import { NamedError } from "@librecode/util/error"
import z from "zod"
import { iife } from "@/util/iife"
import { Flag } from "../flag/flag"
import { Global } from "../global"
import { Installation } from "../installation"
import { Context } from "../util/context"
import { lazy } from "../util/lazy"
import { Log } from "../util/log"
import type * as schema from "./schema"

declare const LIBRECODE_MIGRATIONS: { sql: string; timestamp: number; name: string }[] | undefined

export const NotFoundError = NamedError.create(
  "NotFoundError",
  z.object({
    message: z.string(),
  }),
)

const log = Log.create({ service: "db" })

const DatabasePath = iife(() => {
  const channel = Installation.CHANNEL
  if (["latest", "beta"].includes(channel) || Flag.LIBRECODE_DISABLE_CHANNEL_DB)
    return path.join(Global.Path.data, "librecode.db")
  const safe = channel.replace(/[^a-zA-Z0-9._-]/g, "-")
  return path.join(Global.Path.data, `librecode-${safe}.db`)
})

type Schema = typeof schema
type DatabaseTransaction = SQLiteTransaction<"sync", void, Schema>

type Client = SQLiteBunDatabase

type Journal = { sql: string; timestamp: number; name: string }[]

const databaseState = {
  sqlite: undefined as BunDatabase | undefined,
}

function time(tag: string) {
  const match = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/.exec(tag)
  if (!match) return 0
  return Date.UTC(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(match[4]),
    Number(match[5]),
    Number(match[6]),
  )
}

function migrations(dir: string): Journal {
  const dirs = readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)

  const sql = dirs
    .map((name) => {
      const file = path.join(dir, name, "migration.sql")
      if (!existsSync(file)) return undefined
      return {
        sql: readFileSync(file, "utf-8"),
        timestamp: time(name),
        name,
      }
    })
    .filter(Boolean) as Journal

  return sql.sort((a, b) => a.timestamp - b.timestamp)
}

const DatabaseClient = lazy(() => {
  log.info("opening database", { path: DatabasePath })

  const sqlite = new BunDatabase(DatabasePath, { create: true })
  databaseState.sqlite = sqlite

  sqlite.run("PRAGMA journal_mode = WAL")
  sqlite.run("PRAGMA synchronous = NORMAL")
  sqlite.run("PRAGMA busy_timeout = 5000")
  sqlite.run("PRAGMA cache_size = -64000")
  sqlite.run("PRAGMA foreign_keys = ON")
  sqlite.run("PRAGMA wal_checkpoint(PASSIVE)")

  const db = drizzle({ client: sqlite })

  // Apply schema migrations
  const entries =
    typeof LIBRECODE_MIGRATIONS !== "undefined"
      ? LIBRECODE_MIGRATIONS
      : migrations(path.join(import.meta.dirname, "../../migration"))
  if (entries.length > 0) {
    log.info("applying migrations", {
      count: entries.length,
      mode: typeof LIBRECODE_MIGRATIONS !== "undefined" ? "bundled" : "dev",
    })
    if (Flag.LIBRECODE_SKIP_MIGRATIONS) {
      for (const item of entries) {
        item.sql = "select 1;"
      }
    }
    migrate(db, entries)
  }

  return db
})

function databaseClose() {
  const sqlite = databaseState.sqlite
  if (!sqlite) return
  sqlite.close()
  databaseState.sqlite = undefined
  DatabaseClient.reset()
}

type TxOrDb = SQLiteTransaction<"sync", void, any, any> | Client

const ctx = Context.create<{
  tx: TxOrDb
  effects: (() => void | Promise<void>)[]
}>("database")

function databaseUse<T>(callback: (trx: TxOrDb) => T): T {
  try {
    return callback(ctx.use().tx)
  } catch (err) {
    if (err instanceof Context.NotFound) {
      const effects: (() => void | Promise<void>)[] = []
      const result = ctx.provide({ effects, tx: DatabaseClient() }, () => callback(DatabaseClient()))
      for (const effect of effects) effect()
      return result
    }
    throw err
  }
}

function databaseEffect(fn: () => any | Promise<any>) {
  try {
    ctx.use().effects.push(fn)
  } catch {
    fn()
  }
}

function databaseTransaction<T>(callback: (tx: TxOrDb) => T): T {
  try {
    return callback(ctx.use().tx)
  } catch (err) {
    if (err instanceof Context.NotFound) {
      const effects: (() => void | Promise<void>)[] = []
      const result = (DatabaseClient().transaction as any)((tx: TxOrDb) => {
        return ctx.provide({ tx, effects }, () => callback(tx))
      })
      for (const effect of effects) effect()
      return result
    }
    throw err
  }
}

export const Database = {
  Path: DatabasePath,
  Client: DatabaseClient,
  close: databaseClose,
  use: databaseUse,
  effect: databaseEffect,
  transaction: databaseTransaction,
} as const

// biome-ignore lint/style/noNamespace: type companion for declaration merging
export declare namespace Database {
  type Transaction = DatabaseTransaction
  type TxOrDb = SQLiteTransaction<"sync", void, any, any> | Client
}
