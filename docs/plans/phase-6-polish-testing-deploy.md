# Phase 6: Polish, Testing + Deploy

> **Part of:** [BombSquad MVP Development](2026-03-12-bombsquad-mvp-development.md)
> **Prerequisites:** All prior phases complete
> **Final deliverable:** Live at `bombsquad.amio.fans`

---

## Goal

Make the game production-ready: responsive layout, comprehensive error handling, a full test suite, and Cloudflare Pages deployment with custom domain. This phase also includes manual AI tool testing and mobile verification.

---

## Architecture

No new code architecture introduced. Changes are spread across all existing packages:

```
amiclaw/
├── packages/game/src/
│   ├── styles/
│   │   ├── global.css          ← Add responsive breakpoints
│   │   └── animations.css      ← Verify prefers-reduced-motion
│   ├── pages/                  ← Add error states + loading fallbacks
│   └── components/             ← Responsive touch target fixes
├── packages/api/               ← Production wrangler.toml
└── packages/manual/            ← Production build output
```

---

## Tech Stack

No new dependencies.

**Deploy tooling (already available):**
- `wrangler` — deploy Workers + configure KV namespaces
- Cloudflare Pages — deploy game SPA + manual static pages
- `pnpm build` — build all packages

---

## Tasks

### Responsive design

- [ ] **Task 6.1** — Add responsive rules to `packages/game/src/styles/global.css`:

  ```css
  /* Desktop default: puzzle panel centered at 60% */
  .puzzle-panel {
    max-width: 60%;
    margin: 0 auto;
  }

  /* Mobile: full width */
  @media (max-width: 768px) {
    .puzzle-panel {
      max-width: 100%;
      padding: 0 12px;
    }
  }
  ```

- [ ] **Task 6.2** — Verify all interactive elements have `min-height: 44px; min-width: 44px` (touch targets). Check:
  - Wire click targets (the hit-area `<path>` stroke-width)
  - Dial arrow buttons
  - Keypad cells
  - Confirm and "Play Again" buttons

- [ ] **Task 6.3** — Make `SceneInfoBar` collapsible on mobile:
  - Default: expanded (shows all fields)
  - On mobile (`max-width: 768px`): collapsed behind a toggle button, expand on tap
  - This keeps the game panel uncluttered on small screens

- [ ] **Task 6.4** — Verify SVG viewBox scales correctly on mobile:
  - `WireModule` SVG: `viewBox="0 0 300 250"`, `width="100%"`, `height="auto"` — scales naturally
  - `KeypadModule` grid: uses CSS grid `fr` units, not fixed `px`

- [ ] **Task 6.5** — Test on 320px viewport width (iPhone SE) — no horizontal overflow.

### Error handling

- [ ] **Task 6.6** — Manual load failure in `GamePage.tsx`:
  - Show error message: "Could not load manual. Check your connection."
  - Show "Retry" button that re-triggers `loadManual()`
  - Show "Go Home" fallback link
  - Cache last successfully loaded manual in sessionStorage as backup

  ```typescript
  const loadWithRetry = async (url: string) => {
    try {
      return await loadManual(url)
    } catch {
      // Try sessionStorage cache
      const cached = sessionStorage.getItem(`manual-cache:${url}`)
      if (cached) return yaml.load(cached) as Manual
      throw err
    }
  }
  ```

- [ ] **Task 6.7** — Generator exhaustion in `useGameSession.ts`:
  - If a generator throws after 100 attempts, catch the error
  - Show error overlay: "Puzzle generation failed. Please restart."
  - Offer "Restart" button → navigates to home
  - This should only happen if manual rules have incomplete coverage — log to console

- [ ] **Task 6.8** — Leaderboard API failure in `ResultPage.tsx` (already partial from Phase 5):
  - Failure: show time + module stats, hide rank section
  - Add "Try submitting again" button that retries once
  - Store completed run data in sessionStorage in case user returns later

- [ ] **Task 6.9** — Clipboard fallback already implemented in `utils/clipboard.ts` from Phase 4. Verify it works in:
  - Safari (requires user gesture, already handled)
  - Firefox (no `navigator.clipboard` in some contexts — fallback to `execCommand`)

### Testing

- [ ] **Task 6.10** — Verify Phase 2 unit tests are complete:
  - Rule engine: all operators tested (`gt`, `gte`, `lt`, `lte`, `odd`, `even`, `present`)
  - Wire solver: color_at_last, count_N, multi-condition AND
  - Dial solver: column lookup with known symbol sets
  - Button solver: tap vs hold vs hold+release_on_color
  - Keypad solver: sequence matching with overlap cases
  - Integration: 10 full game loops without error

- [ ] **Task 6.11** — Verify Phase 3 component tests cover:
  - `WireModule`: correct cut → `onComplete`, wrong cut → `onError`, multiple wrong cuts reset state
  - `DialModule`: rotation wraps at 0/5, Confirm with wrong positions → `onError` + reset to [0,0,0]
  - `ButtonModule`: tap (<500ms) vs hold (≥500ms), wrong action type → `onError`
  - `KeypadModule`: correct sequence → `onComplete`, wrong order → `onError` + reset, ignore re-click

- [ ] **Task 6.12** — Add integration test for full game flow in `packages/game/src/`:

  Create `src/game-flow.test.tsx`:
  ```typescript
  /**
   * Full game flow integration test.
   * Mocks: yaml-loader (returns practice.yaml fixture), API calls.
   * Simulates: home → start practice → complete 4 modules → result page.
   */
  import { render, screen, fireEvent, act } from '@testing-library/react'
  import { MemoryRouter } from 'react-router-dom'
  import { vi, describe, it, expect, beforeEach } from 'vitest'
  import App from './App'
  import * as yamlLoader from './utils/yaml-loader'
  import practiceManual from '../../../manual/data/practice.yaml?raw'
  import yaml from 'js-yaml'

  vi.mock('./utils/yaml-loader')
  vi.mock('./utils/leaderboard-api', () => ({
    submitScore: vi.fn().mockResolvedValue({ rank: 5, total_players: 100 }),
    fetchLeaderboard: vi.fn().mockResolvedValue({ date: '2026-03-16', entries: [] }),
  }))

  describe('full game flow', () => {
    beforeEach(() => {
      vi.mocked(yamlLoader.loadManual).mockResolvedValue(yaml.load(practiceManual) as any)
    })

    it('navigates home → game → result', async () => {
      render(<MemoryRouter initialEntries={['/']}><App /></MemoryRouter>)
      // ... simulate clicks through the full flow
      expect(screen.getByText(/DEFUSED/i)).toBeInTheDocument()
    })
  })
  ```

- [ ] **Task 6.13** — AI tool testing (manual — not automated):

  Test with each major AI tool before deployment:
  - **Claude** (voice mode): Send practice manual URL in a prompt, play one full game
  - **ChatGPT** (Voice): Same
  - **Gemini Live**: Same

  Verify for each:
  - AI successfully reads the manual URL
  - AI correctly interprets YAML structure
  - AI provides useful guidance for all 4 module types
  - `?format=yaml` URL variant also works

- [ ] **Task 6.14** — Mobile testing (manual):
  - iOS Safari: touch events, button module long-press, vibration
  - Android Chrome: same checks
  - Verify portrait orientation on 375px width

- [ ] **Task 6.15** — Run full test suite + verify coverage:
  ```bash
  pnpm test:run
  # All tests must pass before deploying
  ```

### Deployment

- [ ] **Task 6.16** — Configure Cloudflare Pages for the game SPA:
  1. Connect GitHub repo at Cloudflare Pages dashboard
  2. Set build configuration:
     - Build command: `pnpm build`
     - Output directory: `packages/game/dist`
     - Root directory: (leave blank — monorepo root)
  3. Set environment variable: `VITE_API_BASE=https://bombsquad.amio.fans`

- [ ] **Task 6.17** — Configure Cloudflare Pages for manual static pages:
  The manual pages deploy alongside the game SPA. Add to `vite.config.ts` or configure a separate Pages project:
  - Manual HTML output goes to `packages/manual/dist/`
  - Route: `/manual/*` served from manual dist
  - Pages Function for content negotiation at `functions/manual/[date].ts`

- [ ] **Task 6.18** — Deploy Cloudflare Worker (leaderboard API):
  ```bash
  cd packages/api
  # Create KV namespace (run once)
  wrangler kv:namespace create LEADERBOARD
  # → Outputs namespace ID — paste into wrangler.toml

  # Deploy
  pnpm deploy
  # → Deployed to: https://bombsquad-api.{account}.workers.dev
  ```

- [ ] **Task 6.19** — Configure custom domain `bombsquad.amio.fans`:
  1. In Cloudflare Pages: Custom domains → Add → `bombsquad.amio.fans`
  2. Cloudflare auto-provisions HTTPS via Let's Encrypt
  3. DNS: CNAME record `bombsquad` → `{pages-project}.pages.dev` (Cloudflare manages this)

- [ ] **Task 6.20** — Verify production deployment:

  ```bash
  # Game SPA
  curl https://bombsquad.amio.fans/ -I
  # → 200, Content-Type: text/html

  # Manual HTML (browser view)
  curl https://bombsquad.amio.fans/manual/practice -I
  # → 200, Content-Type: text/html

  # Manual YAML (AI tool view)
  curl https://bombsquad.amio.fans/manual/practice?format=yaml
  # → 200, Content-Type: text/plain, body starts with "meta:"

  # Leaderboard GET
  curl https://bombsquad.amio.fans/api/leaderboard?date=2026-03-16
  # → 200, Content-Type: application/json, {"date":"...","entries":[...]}

  # Leaderboard POST
  curl -X POST https://bombsquad.amio.fans/api/leaderboard \
    -H "Content-Type: application/json" \
    -d '{"date":"2026-03-16","nickname":"DeployTest","time_ms":120000,...}'
  # → 200, {"rank":N,"total_players":N}
  ```

---

## Verification

**Full checklist before declaring MVP complete:**

**Functional:**
- [ ] `pnpm test:run` — all tests pass
- [ ] Practice mode: load manual → generate puzzle → complete all 4 modules → result page
- [ ] Daily challenge mode: same flow with today's manual
- [ ] "Play Again" — same manual, new puzzle, timer reset
- [ ] Score submission → real rank returned and displayed
- [ ] Leaderboard page → real top-100 data shown

**Responsive:**
- [ ] Desktop (1280px): puzzle centered at 60% width
- [ ] Mobile (375px): full width, no horizontal scroll
- [ ] Touch targets ≥44px on all interactive elements
- [ ] Button module long-press works on iOS and Android

**Error handling:**
- [ ] Manual fetch fails → retry button + fallback message
- [ ] API submit fails → result shows without rank, no crash
- [ ] Clipboard fails → graceful error message

**Manual + prompts:**
- [ ] `bombsquad.amio.fans/manual/practice` → human-unreadable bottom section
- [ ] `bombsquad.amio.fans/manual/practice?format=yaml` → clean YAML
- [ ] All 3 prompt template files present in `prompts/`

**Deployment:**
- [ ] `bombsquad.amio.fans` serves the game SPA
- [ ] HTTPS active (auto via Cloudflare)
- [ ] Leaderboard API responds at `/api/leaderboard`
- [ ] Custom domain resolves correctly

**AI tool testing (manual):**
- [ ] Claude voice: completes practice run, correctly guides all 4 modules
- [ ] ChatGPT voice: same
- [ ] Gemini Live: same

---

## Key Changes in This Phase

| Area | What changes |
|------|--------------|
| `packages/game/src/styles/global.css` | Responsive breakpoints at 768px |
| `packages/game/src/pages/GamePage.tsx` | Manual load error state + retry |
| `packages/game/src/hooks/useGameSession.ts` | Generator exhaustion error state |
| `packages/game/src/pages/ResultPage.tsx` | Score submit retry button |
| `packages/game/src/components/SceneInfoBar.tsx` | Collapsible on mobile |
| `packages/game/src/game-flow.test.tsx` | New full-flow integration test |
| `packages/api/wrangler.toml` | Production KV namespace IDs filled in |
| Cloudflare Pages config | Build + deploy settings |
| DNS | `bombsquad.amio.fans` CNAME |
