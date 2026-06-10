/**
 * Minimal in-memory KV double for the auth tests.
 *
 * Implements the slice of `KVNamespace` the auth handlers use: `get` (text +
 * `'json'`), `put` (capturing `expirationTtl`), `delete`, and `list` (prefix).
 * It records the last TTL per key so tests can assert TTL invariants (e.g.
 * magic-link ≤ 15 min) without a Workers runtime.
 */

interface StoredEntry {
  value: string
  ttl?: number
}

export class FakeKV {
  readonly store = new Map<string, StoredEntry>()

  async get(key: string, type?: 'json'): Promise<unknown> {
    const entry = this.store.get(key)
    if (entry === undefined) return null
    return type === 'json' ? JSON.parse(entry.value) : entry.value
  }

  async put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void> {
    this.store.set(key, { value, ttl: options?.expirationTtl })
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key)
  }

  async list(options?: { prefix?: string }): Promise<{
    keys: { name: string }[]
    list_complete: boolean
    cursor?: string
  }> {
    const prefix = options?.prefix ?? ''
    const keys = [...this.store.keys()]
      .filter((k) => k.startsWith(prefix))
      .map((name) => ({ name }))
    return { keys, list_complete: true }
  }

  // --- test helpers -----------------------------------------------------

  /** TTL last written for a key, or undefined. */
  ttlOf(key: string): number | undefined {
    return this.store.get(key)?.ttl
  }

  /** All keys matching a prefix. */
  keysWithPrefix(prefix: string): string[] {
    return [...this.store.keys()].filter((k) => k.startsWith(prefix))
  }

  asKV(): KVNamespace {
    return this as unknown as KVNamespace
  }
}
