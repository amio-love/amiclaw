/**
 * Injectable side-effect dependencies (clock + id generation) so every domain
 * function is deterministic under test. Production callers use the defaults
 * (`crypto.randomUUID` exists in both Workers and Node).
 */

export interface DomainDeps {
  now(): string
  newId(): string
}

export const defaultDeps: DomainDeps = {
  now: () => new Date().toISOString(),
  newId: () => crypto.randomUUID(),
}
