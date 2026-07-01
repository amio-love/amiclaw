/**
 * Dev-only companion seed — representative MOCK data so the album / profile
 * surfaces can be FELT in a Cloudflare preview before the capture pipeline that
 * produces real episodes + claims is wired (that pipeline is a downstream wire
 * task; until it lands, production renders honest empty states).
 *
 * Activation is an explicit opt-in query param `?companionSeed=1`; it is then
 * persisted to sessionStorage so the flag survives client-side navigation
 * across the nested `/me/*` routes within the preview session. `?companionSeed=0`
 * clears it.
 *
 * Four guarantees:
 *  1. PREVIEW / LOCAL ONLY — the seed may activate ONLY on a Cloudflare Pages
 *     preview host (`*.amiclaw.pages.dev` branch/hash subdomains) or local dev
 *     (`localhost` / `127.0.0.1`). On the production hosts — the custom domain
 *     `claw.amio.fans` AND the bare production `amiclaw.pages.dev` — it is inert
 *     (no flag persisted, no API short-circuit, the login gate stays intact), so
 *     `?companionSeed=1` can never bypass auth or fake destructive actions in
 *     production. Note: bare `amiclaw.pages.dev` does NOT end with
 *     `.amiclaw.pages.dev`, so the `endsWith` check correctly excludes it.
 *  2. MUST render in a Cloudflare PREVIEW — a preview is a production `vite
 *     build`, so this is NOT gated on `import.meta.env.DEV` (which is statically
 *     false there and would dead-code-eliminate the seed). The gate is the
 *     runtime host + query param instead.
 *  3. Inert for real users — with no `companionSeed` param (and no persisted
 *     flag) `companionSeedEnabled()` is false and the data layer talks to the
 *     real API exactly as in production.
 *  4. READ-ONLY — the seed never writes anywhere. In seed mode the data layer
 *     short-circuits every read to this mock data and turns every mutation into
 *     a local no-op (the page reflects it in React state only); nothing reaches
 *     the backend.
 */

import type { CompanionIdentity, MemoryView, ProfileClaimView } from '@shared/companion-types'

const SEED_QUERY_KEY = 'companionSeed'
const SEED_STORAGE_KEY = 'amiclaw:companionSeed'

/**
 * Whether the current host is allowed to run the seed: local dev, or a
 * Cloudflare Pages preview subdomain (`*.amiclaw.pages.dev`). The custom
 * production domain and the bare production `amiclaw.pages.dev` are excluded.
 * SSR-safe.
 */
function seedHostAllowed(): boolean {
  if (typeof window === 'undefined') return false
  const host = window.location.hostname
  return host === 'localhost' || host === '127.0.0.1' || host.endsWith('.amiclaw.pages.dev')
}

/**
 * Whether the dev seed is active for this preview session. Gated FIRST on the
 * host (preview / local only — see `seedHostAllowed`); on a production host it
 * returns false without reading or persisting any flag. On an allowed host it
 * reads the `companionSeed` query param (1 enables + persists, 0 disables +
 * clears) else the persisted sessionStorage flag. SSR-safe: returns false with
 * no `window`.
 */
export function companionSeedEnabled(): boolean {
  if (typeof window === 'undefined') return false
  // Production hosts can never enable the seed — no persistence, no bypass.
  if (!seedHostAllowed()) return false
  try {
    const param = new URLSearchParams(window.location.search).get(SEED_QUERY_KEY)
    if (param === '1') {
      window.sessionStorage.setItem(SEED_STORAGE_KEY, '1')
      return true
    }
    if (param === '0') {
      window.sessionStorage.removeItem(SEED_STORAGE_KEY)
      return false
    }
    return window.sessionStorage.getItem(SEED_STORAGE_KEY) === '1'
  } catch {
    // Private mode / storage blocked — fall back to a one-shot param read.
    try {
      return new URLSearchParams(window.location.search).get(SEED_QUERY_KEY) === '1'
    } catch {
      return false
    }
  }
}

// --- Seed data ---------------------------------------------------------------

export const SEED_COMPANION: CompanionIdentity = {
  name: '小南',
  address_style: '队长',
  voice_id: 'companion-warm',
  profile_enabled: true,
  created_at: '2026-05-30T09:12:00.000Z',
}

const EP_LAST_THREE = 'seed-ep-1'
const EP_FIRST_DAILY = 'seed-ep-2'
const EP_KEYPAD_STUCK = 'seed-ep-3'
const EP_ONE_LINE = 'seed-ep-4'

export const SEED_MEMORIES: MemoryView[] = [
  {
    id: EP_LAST_THREE,
    occurred_at: '2026-06-28T21:40:00.000Z',
    game_id: 'bombsquad',
    title: '最后三秒拆掉了炸弹',
    narrative: '你在最后三秒剪断了那根红线，我们都屏住了呼吸。那一下你比谁都冷静。',
  },
  {
    id: EP_ONE_LINE,
    occurred_at: '2026-06-20T20:05:00.000Z',
    game_id: 'bombsquad',
    title: '一句话点醒了我',
    narrative: '我把方向报反了，你一句「先别动，从左边数」让整局重新清楚了起来。',
  },
  {
    id: EP_KEYPAD_STUCK,
    occurred_at: '2026-06-12T22:18:00.000Z',
    game_id: 'bombsquad',
    title: '在符号键盘前卡了很久',
    narrative: '那些星图符号你反复确认了好几遍才敢按下去，最后还是稳稳过了。',
  },
  {
    id: EP_FIRST_DAILY,
    occurred_at: '2026-06-02T19:30:00.000Z',
    game_id: 'bombsquad',
    title: '第一次通关每日挑战',
    narrative: '我们第一次一起拆完了四个模块，你说还想再来一局。',
  },
]

export const SEED_CLAIMS: ProfileClaimView[] = [
  {
    id: 'seed-claim-1',
    dimension: '节奏偏好',
    claim: '你在压力下反而更专注，最后关头往往是你最稳的时候。',
    status: 'active',
    updated_at: '2026-06-28T21:45:00.000Z',
    evidence: [
      {
        episode_id: EP_LAST_THREE,
        title: '最后三秒拆掉了炸弹',
        occurred_at: '2026-06-28T21:40:00.000Z',
        game_id: 'bombsquad',
      },
      {
        episode_id: EP_FIRST_DAILY,
        title: '第一次通关每日挑战',
        occurred_at: '2026-06-02T19:30:00.000Z',
        game_id: 'bombsquad',
      },
    ],
  },
  {
    id: 'seed-claim-2',
    dimension: '沟通习惯',
    claim: '你习惯先把全局讲清楚，再处理细节。',
    status: 'active',
    updated_at: '2026-06-20T20:10:00.000Z',
    evidence: [
      {
        episode_id: EP_ONE_LINE,
        title: '一句话点醒了我',
        occurred_at: '2026-06-20T20:05:00.000Z',
        game_id: 'bombsquad',
      },
    ],
  },
  {
    id: 'seed-claim-3',
    dimension: '卡点',
    claim: '符号类的模块更容易让你犹豫，但你会反复确认到有把握为止。',
    status: 'active',
    updated_at: '2026-06-12T22:20:00.000Z',
    evidence: [
      {
        episode_id: EP_KEYPAD_STUCK,
        title: '在符号键盘前卡了很久',
        occurred_at: '2026-06-12T22:18:00.000Z',
        game_id: 'bombsquad',
      },
    ],
  },
]

/** Fresh copies so a consumer mutating its local state never alters the seed. */
export function seedMemories(): MemoryView[] {
  return SEED_MEMORIES.map((m) => ({ ...m }))
}

export function seedClaims(): ProfileClaimView[] {
  return SEED_CLAIMS.map((c) => ({ ...c, evidence: c.evidence.map((e) => ({ ...e })) }))
}

/**
 * Companionship counters. NO real per-user source exists yet — they need the
 * leaderboard `user_id` migration + the capture pipeline (both downstream) — so
 * these are surfaced ONLY in seed mode and never in production. (The "在一起 X
 * 天" stat is different: it is computed client-side from the companion's real
 * `created_at`, so it renders in production too — it is not part of this object.)
 */
export interface CompanionStats {
  games_completed: number
  successes: number
}

/** Illustrative seed stats — round numbers consistent with the 4 seeded runs. */
export function seedCompanionStats(): CompanionStats {
  return { games_completed: 12, successes: 9 }
}
