// Ambient types for the workerd test runtime (`@cloudflare/vitest-pool-workers`),
// scoped to the `cloudflare:test` slice the session-DO suites consume. Declared
// locally rather than via a module import of `@cloudflare/workers-types` (a
// module-form import of that package sends `tsc` into a pathological multi-minute
// hang in this package): `DurableObjectNamespace` / `DurableObjectStub` /
// `DurableObjectState` / `KVNamespace` / `DurableObject` resolve as ambient
// globals from the workers-types already loaded via tsconfig `types`.

// `Cloudflare.Env` is left as the empty, augmentable interface that
// `@cloudflare/workers-types` declares — deliberately NOT extended with the test
// bindings. The Agents SDK constrains `Agent<Env extends Cloudflare.Env>`, so
// adding required members here would reject `SessionDoEnv`; the test kit casts
// `env` to its binding shape instead.
declare module 'cloudflare:test' {
  /** The Worker bindings declared in `wrangler.vitest.toml` (cast by the kit). */
  export const env: Cloudflare.Env

  /**
   * Runs `callback` inside the Durable Object pointed-to by `stub`'s I/O
   * context, returning the callback's result. Used to drive a contract method
   * directly, spy on the real `ctx.waitUntil`, overwrite `instance.env`, or
   * release a parked gated turn in-context.
   */
  export function runInDurableObject<O, R>(
    stub: DurableObjectStub<O>,
    callback: (instance: O, state: DurableObjectState) => R | Promise<R>
  ): Promise<R>

  /**
   * Immediately runs (and removes) the Durable Object's scheduled alarm, if one is
   * due. Returns whether an alarm ran. Used to fire the durable burn-through
   * schedule deterministically in the FIX 1 alarm tests.
   */
  export function runDurableObjectAlarm(stub: DurableObjectStub): Promise<boolean>
}
