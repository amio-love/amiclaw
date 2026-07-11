/**
 * Reward-economy public entry for `@amiclaw/companion-memory` (L2 design §1/§9).
 *
 * Downstream PRs (balance HTTP surface, reward wiring, session pricing gate)
 * import the ledger layer, its numeric SSOT, and the source-key helpers from
 * here. The package's other modules (store / resolver / consolidate / …) keep
 * their established deep-path imports — this barrel is scoped to the ledger
 * layer, not a whole-package re-export.
 */

export * from './economy'
export * from './idempotency'
export * from './ledger'
