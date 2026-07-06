export interface ArcadeProfileDbRunResult {
  meta: {
    changes: number
  }
}

export interface ArcadeProfileDbStatement {
  bind(...values: unknown[]): ArcadeProfileDbStatement
  run(): Promise<ArcadeProfileDbRunResult>
  first<T>(): Promise<T | null>
  all<T>(): Promise<{ results: T[] }>
}

export interface ArcadeProfileDb {
  prepare(sql: string): ArcadeProfileDbStatement
  batch(statements: ArcadeProfileDbStatement[]): Promise<ArcadeProfileDbRunResult[]>
}
