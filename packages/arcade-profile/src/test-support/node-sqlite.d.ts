interface ImportMeta {
  url: string
}

declare module 'node:fs' {
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
  }
}
