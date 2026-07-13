import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'
import type { ArcadeProfileDb, ArcadeProfileDbRunResult, ArcadeProfileDbStatement } from '../db'

const MIGRATIONS_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'companion-memory',
  'migrations'
)
const ARCADE_MIGRATIONS = [
  '0002_arcade_profile.sql',
  '0003_arcade_public_profile.sql',
  '0005_arcade_community_like.sql',
]

class SqliteStatement implements ArcadeProfileDbStatement {
  private params: unknown[] = []

  constructor(
    private readonly db: DatabaseSync,
    private readonly sql: string
  ) {}

  bind(...values: unknown[]): ArcadeProfileDbStatement {
    this.params = values
    return this
  }

  runSync(): ArcadeProfileDbRunResult {
    const result = this.db.prepare(this.sql).run(...this.params)
    return { meta: { changes: Number(result.changes) } }
  }

  async run(): Promise<ArcadeProfileDbRunResult> {
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

class SqliteArcadeProfileDb implements ArcadeProfileDb {
  constructor(private readonly raw: DatabaseSync) {}

  prepare(sql: string): ArcadeProfileDbStatement {
    return new SqliteStatement(this.raw, sql)
  }

  async batch(statements: ArcadeProfileDbStatement[]): Promise<ArcadeProfileDbRunResult[]> {
    this.raw.exec('BEGIN')
    try {
      const results = (statements as SqliteStatement[]).map((statement) => statement.runSync())
      this.raw.exec('COMMIT')
      return results
    } catch (error) {
      this.raw.exec('ROLLBACK')
      throw error
    }
  }
}

export function createTestDb(options: { migrations?: string[] } = {}): ArcadeProfileDb {
  const db = new DatabaseSync(':memory:')
  for (const file of options.migrations ?? ARCADE_MIGRATIONS) {
    db.exec(readFileSync(join(MIGRATIONS_DIR, file), 'utf8'))
  }
  return new SqliteArcadeProfileDb(db)
}

// Proxy-social tests need the companion table (0001) + the arcade tables the
// feed derives from + the 0007 proxy tables. One shared helper so every proxy
// suite consumes the same migration list instead of duplicating it. (The
// missing-0007 degrade path deliberately uses the default `createTestDb()`,
// whose set omits 0007.)
const PROXY_SOCIAL_MIGRATIONS = [
  '0001_companion_memory.sql',
  '0002_arcade_profile.sql',
  '0003_arcade_public_profile.sql',
  '0005_arcade_community_like.sql',
  '0007_companion_proxy_social.sql',
]

export function createProxySocialTestDb(): ArcadeProfileDb {
  return createTestDb({ migrations: PROXY_SOCIAL_MIGRATIONS })
}
