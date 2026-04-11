# ADR-002: Storage Layer Cleanup

**Status:** Proposed
**Date:** 2026-04-07
**Decision:** Simplify migration system, add schema versioning, remove legacy JSON migration

---

## Context

The storage layer uses Drizzle ORM with Bun's native SQLite driver. It works well
but has accumulated complexity from the opencode era:

### Current state

| Component      | File                        | Lines  | Purpose                                    |
| -------------- | --------------------------- | ------ | ------------------------------------------ |
| DB client      | `storage/db.ts`             | ~120   | SQLite connection, pragma config, WAL mode |
| Schema         | `storage/schema.ts`         | ~50    | Re-exports table definitions               |
| Schema SQL     | `storage/schema.sql.ts`     | ~30    | SQL table definitions                      |
| Storage        | `storage/storage.ts`        | ~80    | High-level storage operations              |
| JSON migration | `storage/json-migration.ts` | ~200   | One-time JSON→SQLite migration             |
| SQL migrations | `migration/*/migration.sql` | 9 dirs | Drizzle-generated schema changes           |

### Problems

1. **Dual migration system**: Build-time bundled migrations (LIBRECODE_MIGRATIONS define) AND
   filesystem-based migrations for dev mode. The build script bundles migrations as a JSON
   constant injected at compile time.

2. **Legacy JSON→SQLite migration**: `json-migration.ts` handles a one-time migration from
   the pre-SQLite JSON file storage era. This code runs on every startup to check if migration
   is needed, even though virtually all installations have already migrated.

3. **No schema versioning**: There's no explicit schema version number. Migrations are identified
   by timestamp directories (YYYYMMDDHHMMSS format). There's no way to query "what schema
   version am I on?" without checking which migrations have run.

4. **Migration naming**: Directories use a mix of timestamp + random comic-book names
   (e.g., `20260127222353_familiar_lady_ursula`). The random names add no information value.

## Proposed Changes

### 1. Remove JSON migration code (safe now)

The JSON→SQLite migration was a one-time operation from early 2026. By the time LibreCode
ships its first release, all opencode users who would migrate have already done so.

- Delete `storage/json-migration.ts`
- Remove the startup check in `src/index.ts` that calls it
- Remove the progress bar UI code associated with it

### 2. Add schema version table

```sql
CREATE TABLE IF NOT EXISTS _schema_version (
  version INTEGER NOT NULL,
  applied_at INTEGER NOT NULL DEFAULT (unixepoch()),
  migration_name TEXT
);
```

Each migration inserts a row. `SELECT MAX(version) FROM _schema_version` gives current version.

### 3. Simplify migration naming

Future migrations use sequential numbers: `0010_description.sql`, `0011_description.sql`.
Existing timestamp-based ones are kept as-is (renaming would break existing installations).

### 4. Unify migration loading

Remove the dual-path (bundled JSON vs filesystem) in favor of:

- **Production**: Migrations bundled at build time (current LIBRECODE_MIGRATIONS approach, keep)
- **Development**: Drizzle generates migrations, same as today
- Remove the runtime filesystem scan — it's only needed for dev, and `drizzle-kit` handles that

## Consequences

### Positive

- Simpler startup path (no JSON migration check)
- Queryable schema version
- Consistent migration naming going forward

### Negative

- Users upgrading from very old opencode versions (pre-SQLite) to LibreCode directly
  would lose their data. Mitigation: document upgrade path via opencode first.

### Implementation order

1. Add `_schema_version` table as a new migration
2. Remove `json-migration.ts` and startup check
3. Document new migration naming convention
4. Each step is a separate PR
