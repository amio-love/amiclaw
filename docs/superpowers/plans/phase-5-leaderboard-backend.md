# Phase 5: Leaderboard Backend

> **Part of:** [BombSquad MVP Development](2026-03-12-bombsquad-mvp-development.md)
> **Prerequisites:** Phase 4 complete (result page exists, game flow generates submission data)
> **Delivers to:** Phase 6 (deployment connects everything)

---

## Goal

Build the leaderboard API as a Cloudflare Workers service backed by KV storage, then wire it into the game's result and leaderboard pages. Players can submit scores after completing a game and view the day's global top 100.

---

## Architecture

```
packages/api/
├── package.json
├── wrangler.toml             ← Cloudflare Workers config
├── tsconfig.json
└── src/
    ├── index.ts              ← Worker entry point + router
    ├── handlers/
    │   ├── post-score.ts     ← POST /api/leaderboard
    │   └── get-leaderboard.ts ← GET /api/leaderboard
    └── validation.ts         ← Anti-cheat + input sanitization

shared/
└── leaderboard-types.ts      ← Submission + response types (new)

packages/game/src/
├── utils/
│   ├── device-fingerprint.ts ← UUID in localStorage
│   └── leaderboard-api.ts   ← API client
└── pages/
    ├── ResultPage.tsx        ← Updated: submit score, show rank
    └── LeaderboardPage.tsx   ← Updated: fetch + display real data
```

---

## Tech Stack

| Tool | Role |
|------|------|
| Cloudflare Workers | Serverless runtime |
| Cloudflare KV | Leaderboard + personal best storage |
| wrangler | Workers CLI + local dev |
| TypeScript | Typed Worker code |

**Install in `packages/api/`:**
```bash
pnpm add -D wrangler @cloudflare/workers-types typescript
```

---

## Tasks

### Shared types

- [ ] **Task 5.1** — Create `shared/leaderboard-types.ts`:

  ```typescript
  export interface ScoreSubmission {
    date: string           // YYYY-MM-DD
    nickname: string       // max 20 chars, sanitized
    time_ms: number        // total game time in milliseconds
    attempt_number: number // which attempt this was today
    module_times: number[] // time per module in ms (length 4)
    operations_hash: string // SHA-256 of operation log for post-hoc verification
    ai_tool?: string       // optional: 'claude' | 'chatgpt' | 'gemini' | string
    device_id: string      // UUID from localStorage
  }

  export interface ScoreSubmissionResponse {
    rank: number
    total_players: number
  }

  export interface LeaderboardEntry {
    rank: number
    nickname: string
    time_ms: number
    attempt_number: number
    ai_tool?: string
  }

  export interface LeaderboardResponse {
    date: string
    entries: LeaderboardEntry[]
  }
  ```

### API package setup

- [ ] **Task 5.2** — Create `packages/api/package.json`:

  ```json
  {
    "name": "api",
    "private": true,
    "main": "src/index.ts",
    "scripts": {
      "dev": "wrangler dev",
      "deploy": "wrangler deploy"
    },
    "devDependencies": {
      "@cloudflare/workers-types": "^4.0.0",
      "wrangler": "^3.0.0",
      "typescript": "^5.3.0"
    }
  }
  ```

- [ ] **Task 5.3** — Create `packages/api/wrangler.toml`:

  ```toml
  name = "bombsquad-api"
  main = "src/index.ts"
  compatibility_date = "2024-01-01"

  [[kv_namespaces]]
  binding = "LEADERBOARD"
  id = ""         # Fill in after creating with: wrangler kv:namespace create LEADERBOARD
  preview_id = "" # Fill in preview ID

  [vars]
  ENVIRONMENT = "production"
  ```

  **Note:** Run `wrangler kv:namespace create LEADERBOARD` to get real IDs, then fill them in.

- [ ] **Task 5.4** — Create `packages/api/tsconfig.json`:

  ```json
  {
    "extends": "../../tsconfig.base.json",
    "compilerOptions": {
      "target": "ES2022",
      "lib": ["ES2022"],
      "module": "ES2022",
      "moduleResolution": "bundler",
      "types": ["@cloudflare/workers-types"]
    },
    "include": ["src", "../../shared"]
  }
  ```

### KV schema

KV keys used in this Worker:

| Key pattern | Value | TTL |
|-------------|-------|-----|
| `leaderboard:YYYY-MM-DD` | JSON `LeaderboardEntry[]` (top 100, sorted by time_ms ASC) | 48 hours |
| `best:YYYY-MM-DD:{device_id}` | JSON `{ time_ms: number }` | 48 hours |
| `ratelimit:{device_id}` | JSON `{ lastSubmit: number }` | 60 seconds |

### Validation + anti-cheat

- [ ] **Task 5.5** — Create `packages/api/src/validation.ts`:

  ```typescript
  import type { ScoreSubmission } from '@shared/leaderboard-types'

  const MIN_GAME_TIME_MS = 15_000   // 15 seconds minimum — reject obvious cheats
  const MAX_GAME_TIME_MS = 3_600_000 // 1 hour max
  const RATE_LIMIT_MS = 10_000      // 1 submission per 10 seconds per device
  const MAX_NICKNAME_LEN = 20

  export interface ValidationResult {
    ok: boolean
    error?: string
  }

  export function validateSubmission(submission: ScoreSubmission): ValidationResult {
    // Type checks
    if (typeof submission.time_ms !== 'number') return fail('Invalid time_ms')
    if (typeof submission.date !== 'string') return fail('Invalid date')
    if (typeof submission.device_id !== 'string') return fail('Invalid device_id')
    if (typeof submission.nickname !== 'string') return fail('Invalid nickname')

    // Time bounds
    if (submission.time_ms < MIN_GAME_TIME_MS) return fail('Time too short — minimum 15 seconds')
    if (submission.time_ms > MAX_GAME_TIME_MS) return fail('Time exceeds maximum')

    // Date must be today or yesterday (allow timezone offset)
    const today = new Date().toISOString().slice(0, 10)
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10)
    if (submission.date !== today && submission.date !== yesterday) {
      return fail('Invalid date — must be today or yesterday')
    }

    // Module times must sum to ≈ total time
    if (Array.isArray(submission.module_times) && submission.module_times.length === 4) {
      const moduleSum = submission.module_times.reduce((a, b) => a + b, 0)
      if (Math.abs(moduleSum - submission.time_ms) > 2000) {
        return fail('Module times do not match total time')
      }
    }

    return { ok: true }
  }

  export function sanitizeNickname(raw: string): string {
    return raw
      .replace(/<[^>]*>/g, '')    // strip HTML tags
      .replace(/[^\w\s\-_.!?]/g, '') // allow alphanumeric, spaces, common punctuation
      .trim()
      .slice(0, MAX_NICKNAME_LEN)
      || 'Anonymous'
  }

  function fail(error: string): ValidationResult {
    return { ok: false, error }
  }
  ```

### POST /api/leaderboard handler

- [ ] **Task 5.6** — Create `packages/api/src/handlers/post-score.ts`:

  ```typescript
  import type { ScoreSubmission, LeaderboardEntry, ScoreSubmissionResponse } from '@shared/leaderboard-types'
  import { validateSubmission, sanitizeNickname } from '../validation'

  const RATE_LIMIT_MS = 10_000
  const MAX_ENTRIES = 100
  const KV_TTL_SECONDS = 48 * 60 * 60  // 48 hours

  export async function handlePostScore(
    request: Request,
    kv: KVNamespace,
  ): Promise<Response> {
    let body: ScoreSubmission
    try {
      body = await request.json()
    } catch {
      return json({ error: 'Invalid JSON' }, 400)
    }

    // Validate
    const validation = validateSubmission(body)
    if (!validation.ok) {
      return json({ error: validation.error }, 422)
    }

    // Rate limiting
    const rateLimitKey = `ratelimit:${body.device_id}`
    const lastSubmit = await kv.get(rateLimitKey, 'json') as { ts: number } | null
    if (lastSubmit && Date.now() - lastSubmit.ts < RATE_LIMIT_MS) {
      return json({ error: 'Rate limit: wait 10 seconds between submissions' }, 429)
    }
    await kv.put(rateLimitKey, JSON.stringify({ ts: Date.now() }), { expirationTtl: 60 })

    // Update personal best
    const bestKey = `best:${body.date}:${body.device_id}`
    const currentBest = await kv.get(bestKey, 'json') as { time_ms: number } | null
    const isPersonalBest = !currentBest || body.time_ms < currentBest.time_ms
    if (isPersonalBest) {
      await kv.put(bestKey, JSON.stringify({ time_ms: body.time_ms }), {
        expirationTtl: KV_TTL_SECONDS,
      })
    }

    // Read-modify-write leaderboard
    const leaderboardKey = `leaderboard:${body.date}`
    const existing = (await kv.get(leaderboardKey, 'json') as LeaderboardEntry[] | null) ?? []

    const newEntry: LeaderboardEntry = {
      rank: 0,  // will be set below
      nickname: sanitizeNickname(body.nickname),
      time_ms: body.time_ms,
      attempt_number: body.attempt_number,
      ai_tool: body.ai_tool,
    }

    // Insert + sort + cap at 100
    const updated = [...existing, newEntry]
      .sort((a, b) => a.time_ms - b.time_ms)
      .slice(0, MAX_ENTRIES)
      .map((entry, idx) => ({ ...entry, rank: idx + 1 }))

    await kv.put(leaderboardKey, JSON.stringify(updated), {
      expirationTtl: KV_TTL_SECONDS,
    })

    const rank = updated.findIndex(e =>
      e.nickname === newEntry.nickname && e.time_ms === newEntry.time_ms
    ) + 1

    const response: ScoreSubmissionResponse = {
      rank: rank > 0 ? rank : updated.length + 1,
      total_players: updated.length,
    }
    return json(response, 200)
  }

  function json(body: unknown, status: number): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    })
  }
  ```

### GET /api/leaderboard handler

- [ ] **Task 5.7** — Create `packages/api/src/handlers/get-leaderboard.ts`:

  ```typescript
  import type { LeaderboardEntry, LeaderboardResponse } from '@shared/leaderboard-types'

  export async function handleGetLeaderboard(
    request: Request,
    kv: KVNamespace,
  ): Promise<Response> {
    const url = new URL(request.url)
    const date = url.searchParams.get('date') ?? new Date().toISOString().slice(0, 10)

    // Validate date format
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return new Response(JSON.stringify({ error: 'Invalid date format' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const entries = (await kv.get(`leaderboard:${date}`, 'json') as LeaderboardEntry[] | null) ?? []

    const response: LeaderboardResponse = { date, entries }
    return new Response(JSON.stringify(response), {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=60',  // 1-minute cache
      },
    })
  }
  ```

### Worker entry point + router

- [ ] **Task 5.8** — Create `packages/api/src/index.ts`:

  ```typescript
  import { handlePostScore } from './handlers/post-score'
  import { handleGetLeaderboard } from './handlers/get-leaderboard'

  interface Env {
    LEADERBOARD: KVNamespace
  }

  const CORS_HEADERS = {
    'Access-Control-Allow-Origin': 'https://bombsquad.amio.fans',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  }

  export default {
    async fetch(request: Request, env: Env): Promise<Response> {
      // Handle CORS preflight
      if (request.method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: CORS_HEADERS })
      }

      const url = new URL(request.url)

      // Route: POST /api/leaderboard
      if (request.method === 'POST' && url.pathname === '/api/leaderboard') {
        const response = await handlePostScore(request, env.LEADERBOARD)
        return addCors(response)
      }

      // Route: GET /api/leaderboard
      if (request.method === 'GET' && url.pathname === '/api/leaderboard') {
        const response = await handleGetLeaderboard(request, env.LEADERBOARD)
        return addCors(response)
      }

      return new Response('Not Found', { status: 404 })
    },
  }

  function addCors(response: Response): Response {
    const newResponse = new Response(response.body, response)
    for (const [key, value] of Object.entries(CORS_HEADERS)) {
      newResponse.headers.set(key, value)
    }
    return newResponse
  }
  ```

### Frontend integration

- [ ] **Task 5.9** — Create `packages/game/src/utils/device-fingerprint.ts`:

  ```typescript
  const DEVICE_ID_KEY = 'bombsquad-device-id'

  export function getDeviceId(): string {
    let id = localStorage.getItem(DEVICE_ID_KEY)
    if (!id) {
      id = crypto.randomUUID()
      localStorage.setItem(DEVICE_ID_KEY, id)
    }
    return id
  }
  ```

- [ ] **Task 5.10** — Create `packages/game/src/utils/leaderboard-api.ts`:

  ```typescript
  import type { ScoreSubmission, ScoreSubmissionResponse, LeaderboardResponse } from '@shared/leaderboard-types'

  const API_BASE = import.meta.env.VITE_API_BASE ?? 'https://bombsquad.amio.fans'

  export async function submitScore(
    submission: ScoreSubmission,
  ): Promise<ScoreSubmissionResponse | null> {
    try {
      const res = await fetch(`${API_BASE}/api/leaderboard`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(submission),
      })
      if (!res.ok) return null
      return res.json()
    } catch {
      return null   // Network failure — result page shows without rank
    }
  }

  export async function fetchLeaderboard(date?: string): Promise<LeaderboardResponse | null> {
    const query = date ? `?date=${date}` : ''
    try {
      const res = await fetch(`${API_BASE}/api/leaderboard${query}`)
      if (!res.ok) return null
      return res.json()
    } catch {
      return null
    }
  }
  ```

- [ ] **Task 5.11** — Update `packages/game/src/pages/ResultPage.tsx` to:
  1. After game completes, build a `ScoreSubmission` object using game state
  2. Call `submitScore()` — show loading state, then display returned rank
  3. If submission fails → show "Could not submit score (offline?)" gracefully, no rank displayed
  4. Store result in sessionStorage for "today's best" comparison

- [ ] **Task 5.12** — Update `packages/game/src/pages/LeaderboardPage.tsx` to:
  1. Call `fetchLeaderboard()` on mount
  2. Display loading state (neon spinner or "Loading…")
  3. Render real top-100 table from API response
  4. If fetch fails → show "Leaderboard unavailable" fallback

- [ ] **Task 5.13** — Add `VITE_API_BASE` to `packages/game/.env.development`:

  ```
  VITE_API_BASE=http://localhost:8787
  ```

  Workers dev server runs on port 8787 via `wrangler dev`.

---

## Verification

```bash
# Start Workers dev server (from packages/api/)
cd packages/api && pnpm dev
# → Running at http://localhost:8787

# Test POST endpoint
curl -X POST http://localhost:8787/api/leaderboard \
  -H "Content-Type: application/json" \
  -d '{"date":"2026-03-16","nickname":"Tester","time_ms":120000,"attempt_number":1,"module_times":[30000,30000,30000,30000],"operations_hash":"abc123","device_id":"test-device-1"}'
# → {"rank":1,"total_players":1}

# Test GET endpoint
curl http://localhost:8787/api/leaderboard?date=2026-03-16
# → {"date":"2026-03-16","entries":[{"rank":1,"nickname":"Tester","time_ms":120000,...}]}

# Test rate limiting: submit again within 10 seconds
# → 429 response

# Test time validation: submit time_ms < 15000
# → 422 with "Time too short" error
```

**Checklist:**
- [ ] `POST /api/leaderboard` returns `{ rank, total_players }` for valid submissions
- [ ] `GET /api/leaderboard?date=YYYY-MM-DD` returns `{ date, entries }` array
- [ ] Submissions with `time_ms < 15000` are rejected with 422
- [ ] Rate limiting blocks second submission within 10 seconds with 429
- [ ] HTML tags in nickname are stripped
- [ ] Nickname capped at 20 characters
- [ ] CORS headers present on all responses
- [ ] Result page shows actual rank after successful game
- [ ] Result page gracefully handles API failure (shows time, no rank)
- [ ] Leaderboard page fetches and renders real data
- [ ] Leaderboard page shows fallback on fetch failure

---

## Key Files Created in This Phase

| File | Role |
|------|------|
| `shared/leaderboard-types.ts` | Submission + response type definitions |
| `packages/api/package.json` | Workers package |
| `packages/api/wrangler.toml` | Cloudflare Workers + KV config |
| `packages/api/tsconfig.json` | Workers TS config |
| `packages/api/src/index.ts` | Worker entry point + router |
| `packages/api/src/handlers/post-score.ts` | POST handler with KV write |
| `packages/api/src/handlers/get-leaderboard.ts` | GET handler with KV read |
| `packages/api/src/validation.ts` | Anti-cheat + nickname sanitization |
| `packages/game/src/utils/device-fingerprint.ts` | UUID-based device ID |
| `packages/game/src/utils/leaderboard-api.ts` | Typed API client |
| `packages/game/src/pages/ResultPage.tsx` | Updated with score submission + rank display |
| `packages/game/src/pages/LeaderboardPage.tsx` | Updated with real API data |
| `packages/game/.env.development` | Local API base URL |
