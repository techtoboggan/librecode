/**
 * Loads SQL migrations from the migration/ directory.
 * Returns an array of { sql, timestamp, name } sorted by timestamp.
 *
 * Used by build.ts to bundle migrations into the binary as LIBRECODE_MIGRATIONS.
 */

import fs from "fs"
import path from "path"

export interface Migration {
  sql: string
  timestamp: number
  name: string
}

export async function loadMigrations(baseDir: string): Promise<Migration[]> {
  const migrationDir = path.join(baseDir, "migration")

  const entries = await fs.promises.readdir(migrationDir, { withFileTypes: true })

  const migrationDirs = entries
    .filter((entry) => entry.isDirectory() && /^\d{14}/.test(entry.name))
    .map((entry) => entry.name)
    .sort()

  const migrations = await Promise.all(
    migrationDirs.map(async (name) => {
      const file = path.join(migrationDir, name, "migration.sql")
      const sql = await Bun.file(file).text()
      const match = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/.exec(name)
      const timestamp = match
        ? Date.UTC(
            Number(match[1]),
            Number(match[2]) - 1,
            Number(match[3]),
            Number(match[4]),
            Number(match[5]),
            Number(match[6]),
          )
        : 0
      return { sql, timestamp, name }
    }),
  )

  return migrations
}
