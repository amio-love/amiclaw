# Phase 1: Project Foundation

> **Part of:** [BombSquad MVP Development](2026-03-12-bombsquad-mvp-development.md)
> **Prerequisites:** None (greenfield)
> **Delivers to:** Phase 2 (needs PRNG, shared types, Vitest), Phase 3+4 (need router + CSS tokens)

---

## Goal

Set up the complete monorepo infrastructure and all foundational code that every subsequent phase depends on: workspace config, Vite + React SPA scaffold, React Router v6, CSS design tokens, seeded PRNG, shared TypeScript types, and the SVG symbol pool.

Also includes **Phase 0 doc updates** (fix domain references in the two design docs) — merged here since it's a trivial first step.

---

## Architecture

```
amiclaw/                          ← pnpm workspace root
├── package.json                  ← workspace root (no code, just scripts)
├── pnpm-workspace.yaml           ← declares packages/* + shared/
├── tsconfig.base.json            ← base TS config with path aliases
├── shared/                       ← cross-package TypeScript types (not a pkg)
│   ├── manual-schema.ts          ← YAML manual type definitions
│   └── symbols.ts                ← SVG symbol pool (16 symbols)
└── packages/
    └── game/                     ← BombSquad React SPA
        ├── package.json
        ├── vite.config.ts
        ├── tsconfig.json         ← extends base, adds aliases
        ├── index.html
        └── src/
            ├── main.tsx
            ├── App.tsx           ← React Router setup
            ├── pages/            ← 4 placeholder pages
            ├── styles/
            │   └── global.css    ← design tokens + CSS reset
            └── engine/
                ├── rng.ts        ← seeded PRNG (mulberry32)
                └── rng.test.ts   ← PRNG determinism tests
```

---

## Tech Stack

| Tool | Version | Role |
|------|---------|------|
| pnpm | latest | Package manager + workspaces |
| Vite | ^5 | Dev server + build tool |
| React | ^18 | UI framework |
| react-dom | ^18 | DOM renderer |
| react-router-dom | ^6 | Client-side routing |
| TypeScript | ^5 | Type safety |
| js-yaml | ^4 | YAML parsing at runtime |
| Vitest | ^1 | Unit test runner |

---

## Tasks

### Phase 0 merged: Doc updates

- [ ] **Task 1.0a** — In `docs/AmiClaw_GameDesign.md`:
  - Replace all `bombsquad.amio` occurrences with `bombsquad.amio.fans`
  - Verify architecture diagram URLs are updated: `bombsquad.amio.fans`, `bombsquad.amio.fans/manual/2026-03-11`

- [ ] **Task 1.0b** — In `docs/AmiClaw_MVP.md`:
  - Replace `bombsquad.amio.fun` with `bombsquad.amio.fans`
  - Replace `bombsquad.amio/manual/2026-03-11` with `bombsquad.amio.fans/manual/2026-03-11`
  - Update all manual URL references and the prompt template URL placeholder

### Workspace root

- [ ] **Task 1.1** — Create `package.json` at workspace root:
  ```json
  {
    "name": "amiclaw",
    "private": true,
    "scripts": {
      "dev": "pnpm --filter game dev",
      "build": "pnpm --filter game build",
      "test": "pnpm --filter game test",
      "test:run": "pnpm --filter game test:run"
    }
  }
  ```

- [ ] **Task 1.2** — Create `pnpm-workspace.yaml`:
  ```yaml
  packages:
    - "packages/*"
    - "shared"
  ```

- [ ] **Task 1.3** — Create `tsconfig.base.json`:
  ```json
  {
    "compilerOptions": {
      "target": "ES2020",
      "lib": ["ES2020", "DOM", "DOM.Iterable"],
      "module": "ESNext",
      "moduleResolution": "bundler",
      "strict": true,
      "noUnusedLocals": true,
      "noUnusedParameters": true,
      "noFallthroughCasesInSwitch": true,
      "resolveJsonModule": true,
      "isolatedModules": true,
      "esModuleInterop": true,
      "skipLibCheck": true,
      "paths": {
        "@shared/*": ["../../shared/*"],
        "@/*": ["./src/*"]
      }
    }
  }
  ```

- [ ] **Task 1.4** — Create `.gitignore`:
  ```
  node_modules/
  dist/
  .wrangler/
  *.local
  .DS_Store
  ```

### `packages/game/` scaffold

- [ ] **Task 1.5** — Create `packages/game/package.json`:
  ```json
  {
    "name": "game",
    "private": true,
    "type": "module",
    "scripts": {
      "dev": "vite",
      "build": "tsc && vite build",
      "test": "vitest",
      "test:run": "vitest run"
    },
    "dependencies": {
      "react": "^18.2.0",
      "react-dom": "^18.2.0",
      "react-router-dom": "^6.22.0",
      "js-yaml": "^4.1.0"
    },
    "devDependencies": {
      "@types/react": "^18.2.0",
      "@types/react-dom": "^18.2.0",
      "@types/js-yaml": "^4.0.0",
      "@vitejs/plugin-react": "^4.2.0",
      "typescript": "^5.3.0",
      "vite": "^5.1.0",
      "vitest": "^1.3.0",
      "@testing-library/react": "^14.0.0",
      "@testing-library/user-event": "^14.5.0",
      "@testing-library/jest-dom": "^6.4.0",
      "jsdom": "^24.0.0"
    }
  }
  ```

- [ ] **Task 1.6** — Create `packages/game/vite.config.ts`:
  ```typescript
  import { defineConfig } from 'vite'
  import react from '@vitejs/plugin-react'
  import { resolve } from 'path'

  export default defineConfig({
    plugins: [react()],
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src'),
        '@shared': resolve(__dirname, '../../shared'),
      },
    },
    test: {
      environment: 'jsdom',
      setupFiles: ['./src/test-setup.ts'],
      globals: true,
    },
  })
  ```

- [ ] **Task 1.7** — Create `packages/game/tsconfig.json`:
  ```json
  {
    "extends": "../../tsconfig.base.json",
    "compilerOptions": {
      "jsx": "react-jsx",
      "baseUrl": ".",
      "paths": {
        "@/*": ["src/*"],
        "@shared/*": ["../../shared/*"]
      }
    },
    "include": ["src", "../../shared"]
  }
  ```

- [ ] **Task 1.8** — Create `packages/game/index.html`:
  ```html
  <!DOCTYPE html>
  <html lang="en">
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <title>BombSquad — AmiClaw</title>
    </head>
    <body>
      <div id="root"></div>
      <script type="module" src="/src/main.tsx"></script>
    </body>
  </html>
  ```

- [ ] **Task 1.9** — Create `packages/game/src/test-setup.ts`:
  ```typescript
  import '@testing-library/jest-dom'
  ```

### React entry + routing

- [ ] **Task 1.10** — Create `packages/game/src/main.tsx`:
  ```typescript
  import React from 'react'
  import ReactDOM from 'react-dom/client'
  import { BrowserRouter } from 'react-router-dom'
  import App from './App'
  import './styles/global.css'

  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </React.StrictMode>
  )
  ```

- [ ] **Task 1.11** — Create `packages/game/src/App.tsx`:
  ```typescript
  import { Routes, Route } from 'react-router-dom'
  import HomePage from './pages/HomePage'
  import GamePage from './pages/GamePage'
  import ResultPage from './pages/ResultPage'
  import LeaderboardPage from './pages/LeaderboardPage'

  export default function App() {
    return (
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/game" element={<GamePage />} />
        <Route path="/result" element={<ResultPage />} />
        <Route path="/leaderboard" element={<LeaderboardPage />} />
      </Routes>
    )
  }
  ```

- [ ] **Task 1.12** — Create the 4 placeholder pages in `packages/game/src/pages/`:

  **`HomePage.tsx`:**
  ```typescript
  export default function HomePage() {
    return <div style={{ color: 'var(--color-text-primary)' }}>HomePage — placeholder</div>
  }
  ```
  Same pattern for `GamePage.tsx`, `ResultPage.tsx`, `LeaderboardPage.tsx`.

### CSS design tokens

- [ ] **Task 1.13** — Create `packages/game/src/styles/global.css` with all design tokens from `docs/DesignSystem.md`:
  ```css
  /* Design tokens */
  :root {
    /* Colors */
    --color-bg: #1a1a2e;
    --color-neon-cyan: #00ffff;
    --color-neon-green: #39ff14;
    --color-neon-red: #ff073a;
    --color-surface: #0d0d1a;
    --color-border: #1e2a4a;
    --color-text-primary: #e0e0ff;
    --color-text-muted: #6b7299;

    /* Typography */
    --font-mono: 'Courier New', 'Consolas', monospace;
    --font-sans: system-ui, -apple-system, sans-serif;

    /* Layout */
    --puzzle-max-width: 60%;
    --touch-target: 44px;
    --breakpoint-mobile: 768px;
  }

  /* Reset */
  *, *::before, *::after {
    box-sizing: border-box;
    margin: 0;
    padding: 0;
  }

  html, body {
    height: 100%;
    background-color: var(--color-bg);
    color: var(--color-text-primary);
    font-family: var(--font-sans);
  }

  #root {
    min-height: 100%;
  }

  /* Focus rings */
  :focus-visible {
    outline: 2px solid var(--color-neon-cyan);
    outline-offset: 2px;
  }
  ```

### Seeded PRNG

- [ ] **Task 1.14** — Create `packages/game/src/engine/rng.ts` — mulberry32 seeded PRNG:
  ```typescript
  /**
   * Seeded PRNG using mulberry32 algorithm.
   * Practice mode: use seed 42. Daily challenge: use Date.now() at game start.
   */
  export function createRng(seed: number) {
    let s = seed >>> 0

    function next(): number {
      s += 0x6d2b79f5
      let t = Math.imul(s ^ (s >>> 15), 1 | s)
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }

    return {
      /** Returns a float in [0, 1) */
      float: (): number => next(),

      /** Returns an integer in [min, max] inclusive */
      intBetween: (min: number, max: number): number =>
        Math.floor(next() * (max - min + 1)) + min,

      /** Picks a random element from an array */
      pick: <T>(arr: readonly T[]): T => arr[Math.floor(next() * arr.length)],

      /** Returns a new shuffled copy of the array (Fisher-Yates) */
      shuffle: <T>(arr: readonly T[]): T[] => {
        const result = [...arr]
        for (let i = result.length - 1; i > 0; i--) {
          const j = Math.floor(next() * (i + 1));
          [result[i], result[j]] = [result[j], result[i]]
        }
        return result
      },
    }
  }

  export type Rng = ReturnType<typeof createRng>
  ```

- [ ] **Task 1.15** — Create `packages/game/src/engine/rng.test.ts`:
  ```typescript
  import { describe, it, expect } from 'vitest'
  import { createRng } from './rng'

  describe('createRng', () => {
    it('is deterministic — same seed produces same sequence', () => {
      const a = createRng(42)
      const b = createRng(42)
      for (let i = 0; i < 20; i++) {
        expect(a.float()).toBe(b.float())
      }
    })

    it('different seeds produce different sequences', () => {
      const a = createRng(42)
      const b = createRng(43)
      const aVals = Array.from({ length: 10 }, () => a.float())
      const bVals = Array.from({ length: 10 }, () => b.float())
      expect(aVals).not.toEqual(bVals)
    })

    it('intBetween stays within bounds over 1000 calls', () => {
      const rng = createRng(42)
      for (let i = 0; i < 1000; i++) {
        const v = rng.intBetween(1, 6)
        expect(v).toBeGreaterThanOrEqual(1)
        expect(v).toBeLessThanOrEqual(6)
      }
    })

    it('intBetween covers the full range given enough calls', () => {
      const rng = createRng(42)
      const seen = new Set<number>()
      for (let i = 0; i < 1000; i++) seen.add(rng.intBetween(1, 6))
      expect(seen.size).toBe(6)
    })

    it('pick returns an element from the array', () => {
      const rng = createRng(42)
      const arr = ['a', 'b', 'c', 'd']
      for (let i = 0; i < 100; i++) {
        expect(arr).toContain(rng.pick(arr))
      }
    })

    it('shuffle returns a permutation of the same elements', () => {
      const rng = createRng(42)
      const arr = [1, 2, 3, 4, 5]
      const shuffled = rng.shuffle(arr)
      expect(shuffled).toHaveLength(arr.length)
      expect(shuffled.sort()).toEqual([...arr].sort())
    })

    it('shuffle does not mutate the input array', () => {
      const rng = createRng(42)
      const arr = [1, 2, 3, 4, 5]
      const copy = [...arr]
      rng.shuffle(arr)
      expect(arr).toEqual(copy)
    })
  })
  ```

### Shared TypeScript types

- [ ] **Task 1.16** — Create `shared/manual-schema.ts` with base types (Phase 2 will extend with module-specific types):
  ```typescript
  /**
   * TypeScript types for the BombSquad YAML manual schema.
   * Phase 2 will extend this with ModuleConfig, ModuleAnswer, and rule types.
   */

  export interface SceneInfo {
    serialNumber: string      // 6-char alphanumeric, e.g. "A7K3B9"
    batteryCount: number      // 1–4
    indicators: Indicator[]
  }

  export interface Indicator {
    label: string             // e.g. "FRK", "CAR", "NSA"
    lit: boolean
  }

  export interface ManualMeta {
    version: string           // YYYY-MM-DD
    type: 'practice' | 'daily'
  }

  export interface Manual {
    meta: ManualMeta
    // Populated by Phase 2
    modules: Record<string, unknown>
    decoy_modules?: Record<string, unknown>
  }
  ```

- [ ] **Task 1.17** — Create `shared/symbols.ts` with 16 abstract SVG symbols:
  ```typescript
  /**
   * SVG symbol pool for DialModule and KeypadModule.
   * Each symbol has a unique id, human-readable name, description for voice use,
   * and SVG path data rendered in a 100×100 viewBox.
   */

  export interface Symbol {
    id: string
    name: string
    description: string   // How a player would describe it verbally
    path: string          // SVG path data (viewBox 0 0 100 100)
  }

  export const SYMBOLS: readonly Symbol[] = [
    {
      id: 'omega',
      name: 'Omega',
      description: 'horseshoe shape open at the bottom',
      path: 'M50 15 C25 15 10 30 10 50 C10 70 25 82 38 85 L38 90 L30 90 L30 95 L70 95 L70 90 L62 90 L62 85 C75 82 90 70 90 50 C90 30 75 15 50 15 Z M50 25 C68 25 80 36 80 50 C80 64 68 76 54 78 L54 90 L46 90 L46 78 C32 76 20 64 20 50 C20 36 32 25 50 25 Z',
    },
    {
      id: 'psi',
      name: 'Psi',
      description: 'three-pronged fork with a stem',
      path: 'M50 5 L50 35 M30 15 L30 50 C30 65 38 72 50 72 C62 72 70 65 70 50 L70 15 M50 72 L50 95',
    },
    {
      id: 'delta',
      name: 'Delta',
      description: 'upward-pointing triangle',
      path: 'M50 10 L90 85 L10 85 Z',
    },
    {
      id: 'star',
      name: 'Star',
      description: 'five-pointed star',
      path: 'M50 5 L61 35 L95 35 L68 57 L79 91 L50 70 L21 91 L32 57 L5 35 L39 35 Z',
    },
    {
      id: 'xi',
      name: 'Xi',
      description: 'three horizontal parallel lines',
      path: 'M15 25 L85 25 M15 50 L85 50 M15 75 L85 75',
    },
    {
      id: 'diamond',
      name: 'Diamond',
      description: 'diamond or rhombus shape',
      path: 'M50 5 L95 50 L50 95 L5 50 Z',
    },
    {
      id: 'trident',
      name: 'Trident',
      description: 'trident with curved outer prongs',
      path: 'M50 10 L50 90 M30 10 C20 10 15 20 15 30 L15 50 M70 10 C80 10 85 20 85 30 L85 50 M30 10 L30 40 M70 10 L70 40',
    },
    {
      id: 'crescent',
      name: 'Crescent',
      description: 'crescent moon shape',
      path: 'M65 15 C40 15 20 30 20 50 C20 70 40 85 65 85 C50 75 42 63 42 50 C42 37 50 25 65 15 Z',
    },
    {
      id: 'spiral',
      name: 'Spiral',
      description: 'spiral coiling inward',
      path: 'M50 50 C50 30 65 20 75 25 C90 32 90 55 75 65 C60 75 35 70 25 55 C12 37 20 15 38 10 C58 4 80 15 85 38',
    },
    {
      id: 'cross',
      name: 'Cross',
      description: 'plus sign or cross',
      path: 'M50 10 L50 90 M10 50 L90 50',
    },
    {
      id: 'eye',
      name: 'Eye',
      description: 'eye shape with a dot in the center',
      path: 'M10 50 C25 25 75 25 90 50 C75 75 25 75 10 50 Z M50 50 m-8 0 a8 8 0 1 0 16 0 a8 8 0 1 0 -16 0',
    },
    {
      id: 'lambda',
      name: 'Lambda',
      description: 'upside-down V shape',
      path: 'M10 90 L50 10 L90 90',
    },
    {
      id: 'hourglass',
      name: 'Hourglass',
      description: 'two triangles touching at their points',
      path: 'M10 10 L90 10 L50 50 L90 90 L10 90 L50 50 Z',
    },
    {
      id: 'arrow-loop',
      name: 'Arrow Loop',
      description: 'circular arrow pointing right',
      path: 'M30 50 C30 30 45 15 60 15 C75 15 85 28 85 40 C85 55 72 65 60 65 L60 55 L40 70 L60 85 L60 75 C80 75 95 62 95 45 C95 25 80 5 60 5 C38 5 20 22 20 45',
    },
    {
      id: 'target',
      name: 'Target',
      description: 'circle with a dot in the center',
      path: 'M50 50 m-35 0 a35 35 0 1 0 70 0 a35 35 0 1 0 -70 0 M50 50 m-8 0 a8 8 0 1 0 16 0 a8 8 0 1 0 -16 0',
    },
    {
      id: 'zigzag',
      name: 'Zigzag',
      description: 'zigzag or lightning bolt shape',
      path: 'M60 5 L25 50 L55 50 L40 95 L75 45 L45 45 Z',
    },
  ]

  /** Look up a symbol by id. Throws if not found. */
  export function getSymbol(id: string): Symbol {
    const sym = SYMBOLS.find(s => s.id === id)
    if (!sym) throw new Error(`Unknown symbol id: ${id}`)
    return sym
  }
  ```

---

## Verification

Run these commands to confirm Phase 1 is complete:

```bash
# From workspace root
pnpm install

# Start dev server — should open without errors
pnpm dev

# Verify all 4 routes render (open in browser):
# http://localhost:5173/        → "HomePage — placeholder"
# http://localhost:5173/game    → "GamePage — placeholder"
# http://localhost:5173/result  → "ResultPage — placeholder"
# http://localhost:5173/leaderboard → "LeaderboardPage — placeholder"

# Run PRNG tests — should all pass
pnpm test:run
```

**Checklist:**
- [ ] `pnpm install` completes without errors
- [ ] `pnpm dev` starts without TypeScript errors
- [ ] All 4 routes render their placeholder text
- [ ] `pnpm test:run` passes all 7 PRNG tests
- [ ] Background is `#1a1a2e` (design token applied)
- [ ] No light mode rendering
- [ ] Domain references in design docs updated to `bombsquad.amio.fans`

---

## Key Files Created in This Phase

| File | Role |
|------|------|
| `package.json` | Workspace root — pnpm scripts |
| `pnpm-workspace.yaml` | Workspace package declarations |
| `tsconfig.base.json` | Base TS config with `@shared/*` + `@/*` aliases |
| `packages/game/package.json` | Game SPA dependencies |
| `packages/game/vite.config.ts` | Vite + Vitest config |
| `packages/game/tsconfig.json` | Extends base, scoped to game |
| `packages/game/index.html` | HTML entry point |
| `packages/game/src/main.tsx` | React + BrowserRouter entry |
| `packages/game/src/App.tsx` | Route definitions |
| `packages/game/src/pages/HomePage.tsx` | Placeholder (full impl in Phase 4) |
| `packages/game/src/pages/GamePage.tsx` | Placeholder (full impl in Phase 4) |
| `packages/game/src/pages/ResultPage.tsx` | Placeholder (full impl in Phase 4) |
| `packages/game/src/pages/LeaderboardPage.tsx` | Placeholder (full impl in Phase 4) |
| `packages/game/src/styles/global.css` | Design tokens + reset |
| `packages/game/src/engine/rng.ts` | Seeded PRNG (mulberry32) |
| `packages/game/src/engine/rng.test.ts` | Determinism + range tests |
| `shared/manual-schema.ts` | YAML manual base types |
| `shared/symbols.ts` | 16 SVG symbols for Dial + Keypad |
