# Phase 3: Puzzle Module UI

> **Part of:** [BombSquad MVP Development](2026-03-12-bombsquad-mvp-development.md)
> **Prerequisites:** Phase 2 complete (generators, solvers, shared types defined)
> **Delivers to:** Phase 4 (GamePage wires these components in) and Phase 6 (component tests extended)
> **Parallel with:** Phase 4 (page shell can be built independently — only GamePage wiring needs Phase 3)

---

## Goal

Build the 4 interactive SVG-based React puzzle components with CSS-only animations. Each component receives a config + pre-computed answer, renders the puzzle, handles player interactions, and calls `onComplete` / `onError` callbacks. No game state management here — that lives in Phase 4.

---

## Architecture

```
packages/game/src/
├── modules/
│   ├── wire/
│   │   ├── WireModule.tsx
│   │   └── WireModule.module.css
│   ├── dial/
│   │   ├── DialModule.tsx
│   │   └── DialModule.module.css
│   ├── button/
│   │   ├── ButtonModule.tsx
│   │   └── ButtonModule.module.css
│   └── keypad/
│       ├── KeypadModule.tsx
│       └── KeypadModule.module.css
└── styles/
    └── animations.css      ← shared keyframes (success, error, transitions)
```

All modules share the same `ModuleProps` interface. They are purely presentational — no API calls, no routing, no global state.

---

## Tech Stack

Same as Phase 1 + Phase 2. Uses:
- React 18 + TypeScript (existing)
- CSS Modules (existing pattern)
- Vitest + Testing Library (existing) for component tests
- `navigator.vibrate()` for mobile haptic feedback (gracefully no-ops in desktop)

**Hard constraint:** No JS animation libraries. CSS `@keyframes` only. See `docs/DesignSystem.md`.

---

## Tasks

### Shared setup

- [ ] **Task 3.1** — Define `ModuleProps` interface in `packages/game/src/modules/types.ts`:

  ```typescript
  import type { ModuleConfig, ModuleAnswer, SceneInfo } from '@shared/manual-schema'

  export interface ModuleProps<C extends ModuleConfig, A extends ModuleAnswer> {
    config: C
    answer: A
    onComplete: () => void   // called when the player succeeds
    onError: () => void      // called when the player makes a wrong move
    sceneInfo: SceneInfo
  }
  ```

- [ ] **Task 3.2** — Create `packages/game/src/styles/animations.css` with shared keyframes:

  ```css
  /* Success flash — green */
  @keyframes success-flash {
    0%   { background-color: transparent; }
    20%  { background-color: rgba(57, 255, 20, 0.3); }
    100% { background-color: transparent; }
  }

  /* Error flash — red */
  @keyframes error-flash {
    0%   { background-color: transparent; }
    20%  { background-color: rgba(255, 7, 58, 0.4); }
    100% { background-color: transparent; }
  }

  /* Screen shake on error */
  @keyframes shake {
    0%   { transform: translateX(0); }
    15%  { transform: translateX(-8px); }
    30%  { transform: translateX(8px); }
    45%  { transform: translateX(-6px); }
    60%  { transform: translateX(6px); }
    75%  { transform: translateX(-3px); }
    90%  { transform: translateX(3px); }
    100% { transform: translateX(0); }
  }

  /* Module crossfade */
  @keyframes fade-in {
    from { opacity: 0; transform: translateY(8px); }
    to   { opacity: 1; transform: translateY(0); }
  }

  /* Wire cut — top half falls up */
  @keyframes wire-cut-top {
    from { transform: translateY(0) rotate(0); opacity: 1; }
    to   { transform: translateY(-20px) rotate(-5deg); opacity: 0; }
  }

  /* Wire cut — bottom half falls down */
  @keyframes wire-cut-bottom {
    from { transform: translateY(0) rotate(0); opacity: 1; }
    to   { transform: translateY(20px) rotate(5deg); opacity: 0; }
  }

  /* Dial symbol slide up */
  @keyframes dial-slide-up {
    from { transform: translateY(0); opacity: 1; }
    to   { transform: translateY(-100%); opacity: 0; }
  }

  /* Dial symbol slide down */
  @keyframes dial-slide-down {
    from { transform: translateY(0); opacity: 1; }
    to   { transform: translateY(100%); opacity: 0; }
  }

  /* Reduced motion overrides */
  @media (prefers-reduced-motion: reduce) {
    @keyframes success-flash { 0% { opacity: 1; } 50% { opacity: 0.5; } 100% { opacity: 1; } }
    @keyframes error-flash   { 0% { opacity: 1; } 50% { opacity: 0.5; } 100% { opacity: 1; } }
    @keyframes shake         { 0%, 100% { transform: none; } }
    @keyframes fade-in       { from { opacity: 0; } to { opacity: 1; } }
    @keyframes wire-cut-top, @keyframes wire-cut-bottom { from, to { opacity: 1; } }
    @keyframes dial-slide-up, @keyframes dial-slide-down { from, to { opacity: 1; } }
  }
  ```

  Import this in `src/main.tsx` after `global.css`.

### Module A: Wire Routing

- [ ] **Task 3.3** — Create `packages/game/src/modules/wire/WireModule.tsx`:

  **Layout:** SVG canvas (viewBox `0 0 300 250`). Each wire is a Bezier curve from left side (x=20) to right side (x=280), spaced vertically. An invisible wider `<path>` sits behind each wire for click targeting.

  **States:** `idle | cutting | cut | error`

  **Key behaviors:**
  - Click a wire → check if `wireIndex === answer.cutPosition`
  - Correct: play `wire-cut-top`/`wire-cut-bottom` animation on that wire's two halves, then call `onComplete()` after 800ms
  - Wrong: trigger error-flash + shake animation + `navigator.vibrate?.(200)`, call `onError()`, reset to idle
  - Each wire drawn as quadratic Bezier; crossing wires use z-ordering (later wires drawn on top)

  **Wire spacing:** `startY = 40 + wireIndex * 45`

  ```typescript
  import { useState, useCallback } from 'react'
  import type { WireConfig, WireAnswer } from '@shared/manual-schema'
  import type { ModuleProps } from '../types'
  import styles from './WireModule.module.css'

  type WireState = 'idle' | 'cut' | 'error'

  export default function WireModule({
    config, answer, onComplete, onError,
  }: ModuleProps<WireConfig, WireAnswer>) {
    const [state, setState] = useState<WireState>('idle')
    const [cutIndex, setCutIndex] = useState<number | null>(null)

    const handleClick = useCallback((index: number) => {
      if (state !== 'idle') return
      if (index === answer.cutPosition) {
        setCutIndex(index)
        setState('cut')
        navigator.vibrate?.(100)
        setTimeout(onComplete, 800)
      } else {
        setState('error')
        navigator.vibrate?.(200)
        onError()
        setTimeout(() => setState('idle'), 600)
      }
    }, [state, answer.cutPosition, onComplete, onError])

    // ... SVG rendering
  }
  ```

- [ ] **Task 3.4** — Create `packages/game/src/modules/wire/WireModule.module.css`:

  ```css
  .container {
    animation: fade-in 300ms ease-out;
  }

  .container.error {
    animation: error-flash 600ms ease-out, shake 600ms ease-out;
  }

  .container.success {
    animation: success-flash 800ms ease-out;
  }

  .wire-hit-target {
    cursor: crosshair;
    stroke: transparent;
    stroke-width: 20;
    fill: none;
  }

  .wire-hit-target:hover {
    stroke: rgba(255, 255, 255, 0.1);
  }

  .wire-visual {
    stroke-width: 4;
    fill: none;
    stroke-linecap: round;
    transition: opacity 100ms;
  }

  .wire-cut-top {
    animation: wire-cut-top 400ms ease-out forwards;
  }

  .wire-cut-bottom {
    animation: wire-cut-bottom 400ms ease-out forwards;
  }
  ```

- [ ] **Task 3.5** — Create `packages/game/src/modules/wire/WireModule.test.tsx`:

  ```typescript
  import { render, screen } from '@testing-library/react'
  import userEvent from '@testing-library/user-event'
  import { describe, it, expect, vi } from 'vitest'
  import WireModule from './WireModule'

  const config = {
    wires: [
      { color: 'red', hasStripe: false },
      { color: 'blue', hasStripe: false },
      { color: 'yellow', hasStripe: false },
      { color: 'green', hasStripe: false },
    ],
  }
  const answer = { type: 'wire' as const, cutPosition: 2 }

  it('calls onComplete when correct wire is clicked', async () => {
    vi.useFakeTimers()
    const onComplete = vi.fn()
    const onError = vi.fn()
    render(<WireModule config={config} answer={answer} onComplete={onComplete} onError={onError} sceneInfo={{ serialNumber: 'A7K3B2', batteryCount: 2, indicators: [] }} />)
    await userEvent.click(screen.getByTestId('wire-2'))
    vi.advanceTimersByTime(800)
    expect(onComplete).toHaveBeenCalledOnce()
    expect(onError).not.toHaveBeenCalled()
    vi.useRealTimers()
  })

  it('calls onError when wrong wire is clicked', async () => {
    const onComplete = vi.fn()
    const onError = vi.fn()
    render(<WireModule config={config} answer={answer} onComplete={onComplete} onError={onError} sceneInfo={{ serialNumber: 'A7K3B2', batteryCount: 2, indicators: [] }} />)
    await userEvent.click(screen.getByTestId('wire-0'))
    expect(onError).toHaveBeenCalledOnce()
    expect(onComplete).not.toHaveBeenCalled()
  })
  ```

### Module B: Symbol Dial

- [ ] **Task 3.6** — Create `packages/game/src/modules/dial/DialModule.tsx`:

  **Layout:** 3 side-by-side dial columns. Each dial shows 1 symbol at a time in a "window". Left/right arrow buttons below each dial rotate it. A "Confirm" button at the bottom validates all 3 positions.

  **State per dial:** current position index (0–5).

  **Key behaviors:**
  - Arrow click → update position (wrap around 0–5), play slide animation
  - "Confirm" click → check if `positions === answer.positions`
  - Correct: success flash + `onComplete()` after 800ms
  - Wrong: error flash + reset positions to `[0, 0, 0]` + `onError()`
  - Render symbols using inline SVG path from `shared/symbols.ts` `getSymbol(id).path`
  - `aria-label` on each arrow button: `"Rotate dial {n} left/right"`

  ```typescript
  import { useState } from 'react'
  import type { DialConfig, DialAnswer } from '@shared/manual-schema'
  import type { ModuleProps } from '../types'
  import { getSymbol } from '@shared/symbols'
  import styles from './DialModule.module.css'

  export default function DialModule({
    config, answer, onComplete, onError,
  }: ModuleProps<DialConfig, DialAnswer>) {
    const [positions, setPositions] = useState([0, 0, 0])
    const [flashState, setFlashState] = useState<'idle' | 'success' | 'error'>('idle')

    const rotate = (dialIndex: number, direction: -1 | 1) => {
      setPositions(prev => {
        const next = [...prev]
        next[dialIndex] = (next[dialIndex] + direction + 6) % 6
        return next
      })
    }

    const confirm = () => {
      const correct = answer.positions.every((p, i) => p === positions[i])
      if (correct) {
        setFlashState('success')
        setTimeout(onComplete, 800)
      } else {
        setFlashState('error')
        onError()
        setTimeout(() => {
          setPositions([0, 0, 0])
          setFlashState('idle')
        }, 600)
      }
    }

    // ... render 3 dials + confirm button
  }
  ```

- [ ] **Task 3.7** — Create `packages/game/src/modules/dial/DialModule.module.css`:

  ```css
  .dials-container {
    display: flex;
    gap: 24px;
    justify-content: center;
    align-items: flex-start;
  }

  .dial {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
  }

  .dial-window {
    width: 80px;
    height: 80px;
    border: 2px solid var(--color-border);
    background: var(--color-surface);
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
    position: relative;
  }

  .symbol-svg {
    width: 60px;
    height: 60px;
    stroke: var(--color-neon-cyan);
    fill: none;
    stroke-width: 3;
  }

  .arrow-btn {
    background: none;
    border: 1px solid var(--color-border);
    color: var(--color-text-primary);
    cursor: pointer;
    width: var(--touch-target);
    height: var(--touch-target);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 18px;
  }

  .arrow-btn:hover {
    border-color: var(--color-neon-cyan);
    color: var(--color-neon-cyan);
  }

  .confirm-btn {
    margin-top: 16px;
    padding: 12px 32px;
    background: none;
    border: 2px solid var(--color-neon-cyan);
    color: var(--color-neon-cyan);
    font-family: var(--font-mono);
    font-size: 14px;
    letter-spacing: 2px;
    cursor: pointer;
    min-height: var(--touch-target);
    text-transform: uppercase;
  }

  .confirm-btn:hover {
    background: rgba(0, 255, 255, 0.1);
  }

  .slide-up { animation: dial-slide-up 150ms ease-out forwards; }
  .slide-down { animation: dial-slide-down 150ms ease-out forwards; }
  ```

- [ ] **Task 3.8** — Create `packages/game/src/modules/dial/DialModule.test.tsx`:

  Test that rotating a dial changes the displayed symbol, and that Confirm calls the right callback.

### Module C: Button

- [ ] **Task 3.9** — Create `packages/game/src/modules/button/ButtonModule.tsx`:

  **Layout:** Large centered button with color + label. Indicator light (circle) above/beside it. Numeric display below.

  **State machine:** `idle → pressed → (holding after 500ms) → released`

  **Key behaviors:**
  - `onPointerDown` → start press timer
  - If released before 500ms: short press
    - Check `answer.action === 'tap'` → correct if yes, error if no
  - If held 500ms+: enter holding state
    - Indicator starts cycling through colors (CSS animation or RAF interval)
    - `onPointerUp` → check `answer.action === 'hold'` and `releasedColor === answer.releaseOnColor`
    - Correct: `onComplete()`, Wrong: `onError()` + reset
  - Use `onPointerDown`/`onPointerUp` (works on touch + mouse)
  - `touch-action: none` on the button to prevent scroll interference

  ```typescript
  import { useState, useRef, useEffect } from 'react'
  import type { ButtonConfig, ButtonAnswer } from '@shared/manual-schema'
  import type { ModuleProps } from '../types'
  import styles from './ButtonModule.module.css'

  const INDICATOR_COLORS = ['white', 'yellow', 'blue', 'red']
  const HOLD_THRESHOLD_MS = 500
  const INDICATOR_CYCLE_MS = 800

  type ButtonState = 'idle' | 'pressed' | 'holding' | 'success' | 'error'

  export default function ButtonModule({
    config, answer, onComplete, onError,
  }: ModuleProps<ButtonConfig, ButtonAnswer>) {
    const [buttonState, setButtonState] = useState<ButtonState>('idle')
    const [indicatorColorIdx, setIndicatorColorIdx] = useState(0)
    const pressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    const cycleIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

    // Start holding state after threshold
    const handlePointerDown = () => {
      if (buttonState !== 'idle') return
      setButtonState('pressed')
      pressTimerRef.current = setTimeout(() => {
        setButtonState('holding')
        cycleIntervalRef.current = setInterval(() => {
          setIndicatorColorIdx(i => (i + 1) % INDICATOR_COLORS.length)
        }, INDICATOR_CYCLE_MS)
      }, HOLD_THRESHOLD_MS)
    }

    const handlePointerUp = () => {
      if (pressTimerRef.current) clearTimeout(pressTimerRef.current)
      if (cycleIntervalRef.current) clearInterval(cycleIntervalRef.current)

      if (buttonState === 'pressed') {
        // Short press
        if (answer.action === 'tap') {
          setButtonState('success')
          setTimeout(onComplete, 600)
        } else {
          setButtonState('error')
          onError()
          setTimeout(() => setButtonState('idle'), 600)
        }
      } else if (buttonState === 'holding') {
        // Long press — check released indicator color
        const releasedColor = INDICATOR_COLORS[indicatorColorIdx]
        if (answer.action === 'hold' && releasedColor === answer.releaseOnColor) {
          setButtonState('success')
          setTimeout(onComplete, 600)
        } else {
          setButtonState('error')
          onError()
          setTimeout(() => { setButtonState('idle'); setIndicatorColorIdx(0) }, 600)
        }
      }
    }

    // Cleanup on unmount
    useEffect(() => () => {
      if (pressTimerRef.current) clearTimeout(pressTimerRef.current)
      if (cycleIntervalRef.current) clearInterval(cycleIntervalRef.current)
    }, [])

    // ... render button + indicator + display
  }
  ```

- [ ] **Task 3.10** — Create `packages/game/src/modules/button/ButtonModule.module.css`:

  ```css
  .container {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 20px;
  }

  .big-button {
    width: 140px;
    height: 140px;
    border-radius: 50%;
    border: 4px solid rgba(0, 0, 0, 0.3);
    cursor: pointer;
    font-family: var(--font-mono);
    font-size: 16px;
    font-weight: bold;
    letter-spacing: 2px;
    touch-action: none;
    user-select: none;
    display: flex;
    align-items: center;
    justify-content: center;
    text-transform: uppercase;
    transition: filter 100ms, transform 100ms;
    min-width: var(--touch-target);
    min-height: var(--touch-target);
  }

  .big-button:active,
  .big-button.pressed {
    transform: scale(0.95);
    filter: brightness(0.85);
  }

  .indicator {
    width: 24px;
    height: 24px;
    border-radius: 50%;
    border: 2px solid rgba(255, 255, 255, 0.3);
    transition: background-color 200ms;
  }

  .display {
    font-family: var(--font-mono);
    font-size: 24px;
    color: var(--color-neon-cyan);
    border: 1px solid var(--color-border);
    padding: 8px 16px;
    min-width: 60px;
    text-align: center;
  }
  ```

- [ ] **Task 3.11** — Create `packages/game/src/modules/button/ButtonModule.test.tsx`:

  Use `vi.useFakeTimers()` to test hold threshold. Verify `onComplete` called for tap on tap-answer, `onError` called for wrong action type.

### Module D: Keypad

- [ ] **Task 3.12** — Create `packages/game/src/modules/keypad/KeypadModule.tsx`:

  **Layout:** 2×2 SVG grid. Each cell is a symbol rendered as inline SVG path + a numbered badge that appears when clicked.

  **State:** `clicked: number[]` — list of symbol positions clicked so far (0–3).

  **Key behaviors:**
  - Click a symbol cell → add to `clicked` array
  - Don't allow re-clicking the same symbol
  - After 4th click: check if `clicked === answer.sequence`
  - Correct: `onComplete()` after 600ms
  - Wrong: error flash + reset `clicked = []` + `onError()`
  - Badge shows `clicked.indexOf(position) + 1` for clicked cells

  ```typescript
  import { useState } from 'react'
  import type { KeypadConfig, KeypadAnswer } from '@shared/manual-schema'
  import type { ModuleProps } from '../types'
  import { getSymbol } from '@shared/symbols'
  import styles from './KeypadModule.module.css'

  export default function KeypadModule({
    config, answer, onComplete, onError,
  }: ModuleProps<KeypadConfig, KeypadAnswer>) {
    const [clicked, setClicked] = useState<number[]>([])
    const [flashState, setFlashState] = useState<'idle' | 'success' | 'error'>('idle')

    const handleCellClick = (position: number) => {
      if (clicked.includes(position) || flashState !== 'idle') return
      const next = [...clicked, position]
      setClicked(next)

      if (next.length === 4) {
        const correct = next.every((p, i) => p === answer.sequence[i])
        if (correct) {
          setFlashState('success')
          setTimeout(onComplete, 600)
        } else {
          setFlashState('error')
          onError()
          navigator.vibrate?.(200)
          setTimeout(() => { setClicked([]); setFlashState('idle') }, 600)
        }
      }
    }

    // Render 2×2 grid
    return (
      <div
        className={`${styles.grid} ${flashState === 'error' ? styles.error : ''} ${flashState === 'success' ? styles.success : ''}`}
      >
        {config.symbols.map((symbolId, position) => {
          const sym = getSymbol(symbolId)
          const clickOrder = clicked.indexOf(position)
          return (
            <button
              key={position}
              className={`${styles.cell} ${clicked.includes(position) ? styles.selected : ''}`}
              onClick={() => handleCellClick(position)}
              aria-label={sym.description}
              data-testid={`keypad-cell-${position}`}
            >
              <svg viewBox="0 0 100 100" className={styles.symbol}>
                <path d={sym.path} />
              </svg>
              {clickOrder >= 0 && (
                <span className={styles.badge}>{clickOrder + 1}</span>
              )}
            </button>
          )
        })}
      </div>
    )
  }
  ```

- [ ] **Task 3.13** — Create `packages/game/src/modules/keypad/KeypadModule.module.css`:

  ```css
  .grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
    width: fit-content;
  }

  .grid.error  { animation: error-flash 600ms ease-out, shake 600ms ease-out; }
  .grid.success { animation: success-flash 600ms ease-out; }

  .cell {
    width: 120px;
    height: 120px;
    background: var(--color-surface);
    border: 2px solid var(--color-border);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    position: relative;
    transition: border-color 150ms;
  }

  .cell:hover { border-color: var(--color-neon-cyan); }

  .cell.selected { border-color: var(--color-neon-cyan); }

  .symbol {
    width: 80px;
    height: 80px;
    stroke: var(--color-text-primary);
    fill: none;
    stroke-width: 3;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .cell.selected .symbol { stroke: var(--color-neon-cyan); }

  .badge {
    position: absolute;
    top: 4px;
    right: 4px;
    width: 22px;
    height: 22px;
    border-radius: 50%;
    background: var(--color-neon-cyan);
    color: var(--color-bg);
    font-family: var(--font-mono);
    font-size: 12px;
    font-weight: bold;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  ```

- [ ] **Task 3.14** — Create `packages/game/src/modules/keypad/KeypadModule.test.tsx`:

  Test clicking in correct order calls `onComplete`, wrong order calls `onError` + resets. Test that repeated clicks on the same cell are ignored.

---

## Verification

```bash
pnpm test:run
```

**Expected:** All existing tests still pass + new component tests pass.

**Manual visual check:**
1. `pnpm dev` → navigate to a test page (or create a temporary `/dev` route)
2. Render all 4 modules with sample configs
3. Verify: dark background, neon cyan symbols, touch targets ≥44px
4. Verify: error flash turns screen red briefly, success flash turns green
5. Verify: Button hold vs tap distinction works
6. Verify: Keypad badge numbers appear in click order

**Checklist:**
- [ ] All 4 module component tests pass
- [ ] `WireModule` calls `onComplete` after correct cut, `onError` on wrong cut
- [ ] `DialModule` validates all 3 positions on Confirm
- [ ] `ButtonModule` correctly distinguishes tap (<500ms) vs hold (≥500ms)
- [ ] `KeypadModule` validates 4-symbol click sequence
- [ ] All modules apply `error` CSS class on wrong input
- [ ] All interactive elements have `min-height/width: 44px`
- [ ] `aria-label` present on all icon-only buttons
- [ ] Animations wrapped in `prefers-reduced-motion` media query in `animations.css`
- [ ] No JS animation library imported

---

## Key Files Created in This Phase

| File | Role |
|------|------|
| `packages/game/src/modules/types.ts` | Shared `ModuleProps` interface |
| `packages/game/src/styles/animations.css` | Shared CSS keyframes |
| `packages/game/src/modules/wire/WireModule.tsx` | Wire routing component |
| `packages/game/src/modules/wire/WireModule.module.css` | Wire styles |
| `packages/game/src/modules/wire/WireModule.test.tsx` | Wire component tests |
| `packages/game/src/modules/dial/DialModule.tsx` | Symbol dial component |
| `packages/game/src/modules/dial/DialModule.module.css` | Dial styles |
| `packages/game/src/modules/dial/DialModule.test.tsx` | Dial component tests |
| `packages/game/src/modules/button/ButtonModule.tsx` | Button component |
| `packages/game/src/modules/button/ButtonModule.module.css` | Button styles |
| `packages/game/src/modules/button/ButtonModule.test.tsx` | Button component tests |
| `packages/game/src/modules/keypad/KeypadModule.tsx` | Keypad component |
| `packages/game/src/modules/keypad/KeypadModule.module.css` | Keypad styles |
| `packages/game/src/modules/keypad/KeypadModule.test.tsx` | Keypad component tests |
