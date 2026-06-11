/**
 * Minimal ambient declarations for the Node built-ins the test support uses
 * (`node:sqlite` is available unflagged on Node >= 22.13 — the CI baseline).
 * Declared locally instead of pulling `@types/node` into the workers-typed
 * packages, whose global declarations conflict with
 * `@cloudflare/workers-types`. Only the surface `test-support/sqlite-db.ts`
 * uses is declared.
 */

interface ImportMeta {
  url: string
}

declare module 'node:fs' {
  export function readdirSync(path: string): string[]
  export function readFileSync(path: string, encoding: 'utf8'): string
}

declare module 'node:path' {
  export function dirname(path: string): string
  export function join(...parts: string[]): string
}

declare module 'node:url' {
  export function fileURLToPath(url: string): string
}

declare module 'node:sqlite' {
  export interface StatementResultingChanges {
    changes: number | bigint
    lastInsertRowid: number | bigint
  }

  export class StatementSync {
    run(...params: unknown[]): StatementResultingChanges
    get(...params: unknown[]): unknown
    all(...params: unknown[]): unknown[]
  }

  export class DatabaseSync {
    constructor(path: string)
    exec(sql: string): void
    prepare(sql: string): StatementSync
    close(): void
  }
}
