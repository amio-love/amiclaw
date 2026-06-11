/**
 * Test-only D1 stand-in backed by the Node built-in `node:sqlite`.
 *
 * Wraps a real in-memory SQLite database in the `CompanionDb` interface and
 * applies the actual migration SQL from `migrations/`, so the unit tests
 * exercise the REAL schema semantics — triggers, foreign keys, CHECK
 * constraints, ON CONFLICT DO NOTHING — exactly as D1 (which is SQLite) runs
 * them. `batch` emulates D1's transactional batch with BEGIN/COMMIT.
 *
 * Chosen over @cloudflare/vitest-pool-workers (would replace the repo's plain
 * Node vitest pool) and better-sqlite3 (native build + pnpm build-script
 * allowlisting) — `node:sqlite` is zero-dependency and unflagged on the CI
 * Node 22 baseline.
 */

import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'
import type { CompanionDb, CompanionDbRunResult, CompanionDbStatement } from '../db'

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'migrations')

class SqliteStatement implements CompanionDbStatement {
  private params: unknown[] = []

  constructor(
    private readonly db: DatabaseSync,
    private readonly sql: string
  ) {}

  bind(...values: unknown[]): CompanionDbStatement {
    this.params = values
    return this
  }

  /** Run inside `batch`'s transaction (or standalone). */
  runSync(): CompanionDbRunResult {
    const result = this.db.prepare(this.sql).run(...this.params)
    return { meta: { changes: Number(result.changes) } }
  }

  async run(): Promise<CompanionDbRunResult> {
    return this.runSync()
  }

  async first<T>(): Promise<T | null> {
    const row = this.db.prepare(this.sql).get(...this.params)
    return row === undefined ? null : (row as T)
  }

  async all<T>(): Promise<{ results: T[] }> {
    return { results: this.db.prepare(this.sql).all(...this.params) as T[] }
  }
}

class SqliteCompanionDb implements CompanionDb {
  constructor(readonly raw: DatabaseSync) {}

  prepare(sql: string): CompanionDbStatement {
    return new SqliteStatement(this.raw, sql)
  }

  async batch(statements: CompanionDbStatement[]): Promise<unknown> {
    this.raw.exec('BEGIN')
    try {
      const results = (statements as SqliteStatement[]).map((s) => s.runSync())
      this.raw.exec('COMMIT')
      return results
    } catch (error) {
      this.raw.exec('ROLLBACK')
      throw error
    }
  }
}

/** Fresh in-memory database with all migrations applied, as a `CompanionDb`. */
export function createTestDb(): SqliteCompanionDb {
  const db = new DatabaseSync(':memory:')
  // D1 enforces foreign keys; pin the same behaviour explicitly.
  db.exec('PRAGMA foreign_keys = ON')
  for (const file of readdirSync(MIGRATIONS_DIR).sort()) {
    if (file.endsWith('.sql')) {
      db.exec(readFileSync(join(MIGRATIONS_DIR, file), 'utf8'))
    }
  }
  return new SqliteCompanionDb(db)
}
