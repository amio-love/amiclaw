/**
 * Minimal D1-shaped database interface the domain logic targets.
 *
 * Structurally satisfied by Cloudflare's `D1Database` (prepare/bind/run/
 * first/all/batch), so production code passes the real binding straight in;
 * the unit tests pass the `node:sqlite`-backed adapter from
 * `test-support/sqlite-db.ts`. Kept deliberately narrower than the full D1
 * lib type — only the surface the domain actually uses — so the test adapter
 * stays small and the domain stays runtime-agnostic.
 */

export interface CompanionDbRunResult {
  meta: {
    /** Rows written by the statement (D1 `meta.changes`). */
    changes: number
  }
}

export interface CompanionDbStatement {
  bind(...values: unknown[]): CompanionDbStatement
  run(): Promise<CompanionDbRunResult>
  first<T>(): Promise<T | null>
  all<T>(): Promise<{ results: T[] }>
}

export interface CompanionDb {
  prepare(sql: string): CompanionDbStatement
  /**
   * Execute the statements as one atomic batch (D1 semantics: a transaction).
   * Returns one run result per statement, in order (D1 `D1Result[]`).
   */
  batch(statements: CompanionDbStatement[]): Promise<CompanionDbRunResult[]>
}
