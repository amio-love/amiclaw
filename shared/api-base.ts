/**
 * Single source of truth for the API origin the frontend talks to.
 *
 * Overridable per-environment via the `VITE_API_BASE` env var (e.g. a preview
 * deployment pointing at a staging Worker); defaults to the production
 * canonical. Every frontend `fetch` to `/api/*` builds its URL from this origin
 * so the fallback string is defined once, not copied per call site.
 */
export const API_BASE =
  (import.meta.env.VITE_API_BASE as string | undefined) ?? 'https://claw.amio.fans'
