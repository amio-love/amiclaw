# AmiClaw Design System

Visual language, component rules, and brand guidelines for AmiClaw and BombSquad.

---

## Brand Personality

**Three words**: Quirky · Retro · Collaborative

- **Quirky**: Playful, slightly absurd premise — lean into this, don't over-explain
- **Retro**: Vintage terminal / hacker aesthetic; warmth of old CRTs and arcade machines, not cold enterprise software
- **Collaborative**: The AI is your *partner*, not your tool. The UI reinforces a "two-person team" feeling at every point

**Voice and tone**: Direct, a little cheeky. Short burst copy ("GO", "DEFUSED", "BOOM"). Avoid corporate language. A countdown timer should feel exciting, not clinical.

---

## Design Principles

1. **Partnership over tool-use** — Every screen reinforces that the player and AI are a team. Use "you and your AI" framing. The result page celebrates *the run*, not just the score.

2. **Urgency without anxiety** — The timer should feel thrilling. Keep game UI uncluttered so cognitive load comes from the puzzle, not the interface. One module at a time. No visual noise during active play.

3. **Clarity under pressure** — Game state (current module, timer, progress, serial number) must be readable in a glance. Use high-contrast neon against dark backgrounds. Never sacrifice legibility for aesthetic.

4. **Roguelike momentum** — "Play Again" is always one tap away and visually dominant on the results page. Every screen transition should feel fast. Friction is the enemy of "one more run."

5. **Earn the neon** — Visual effects (glitch, flicker, burst animations) are rewards tied to game events, not ambient decoration. Reserve them for moments that deserve them.

---

## Aesthetic Direction

**Visual references**:
- **Cyberpunk 2077 UI** — neon-on-dark color language, scan-line overlays, HUD data density
- **Hacknet terminal** — monospace everything, command-line feel, information rendered as data rather than "UI"

**Anti-references** (do not look like):
- Generic dark SaaS (Notion dark mode, Linear)
- Edgy "gamer" aesthetics with excessive gradients and 3D chrome
- Minimalist white-space design

**Core visual language**: Neon glow on deep indigo-black. Text feels like it's being printed in real time. Success is a burst of green, failure is a red flash. Decorative glitch effects on hero elements only — not on functional UI.

---

## Color Palette

| Token | Value | Usage |
|-------|-------|-------|
| `--color-bg` | `#1a1a2e` | Page / panel background |
| `--color-neon-cyan` | `#00ffff` | Primary accent, interactive elements |
| `--color-neon-green` | `#39ff14` | Success states, "defused" feedback |
| `--color-neon-red` | `#ff073a` | Error states, "explosion" feedback |
| `--color-surface` | `#0d0d1a` | Elevated card backgrounds |
| `--color-border` | `#1e2a4a` | Subtle panel borders |
| `--color-text-primary` | `#e0e0ff` | Main readable text |
| `--color-text-muted` | `#6b7299` | Secondary / helper text |

**Anti-human manual style** (intentional game mechanic — WCAG does not apply):
- Text color: `#888888` on background `#999999`
- Font size: `4px`
- No line breaks, no indentation
- Preceded by a friendly "this is for AI" notice in normal styles

---

## Typography

- **Monospace** (`'Courier New', 'Consolas', monospace`): puzzle UI, timers, serial numbers, manual data, leaderboard scores
- **Sans-serif** (`system-ui, -apple-system, sans-serif`): general UI text, instructions, prompts

---

## Layout & Responsive

- Desktop: puzzle panel centered at **60% max-width**
- Mobile: **full-width**, vertical stacking of modules
- Touch targets: minimum **44px × 44px** on all interactive elements
- Breakpoint: `768px` (mobile below, desktop above)
- Dark mode **only** — no light mode variant

---

## CSS Approach

- **CSS Modules** for component-scoped styles
- **CSS custom properties** (design tokens) defined at `:root` in a global tokens file
- **CSS-only animations** — no JS animation libraries (no Framer Motion, GSAP, etc.)
- Use `@keyframes` for glitch effects, neon flicker, "wire cut" transitions
- `prefers-reduced-motion` media query must wrap all non-essential animations

---

## Accessibility

- **WCAG AA** compliance required across all functional UI
- Exception: the anti-human manual section is an intentional design mechanic — WCAG does not apply to it
- All interactive elements need visible focus rings (neon cyan `outline`)
- Meaningful `aria-label` on icon-only buttons

---

## Animation Guidelines

- Module completion: brief "defused" animation (wire snap, dial lock, etc.)
- Error feedback: screen flash red (`#ff073a`) + CSS `vibrate` keyframe on mobile
- Personal best: celebratory neon burst animation
- UI feedback animations: under **300ms**
- Game event animations: under **600ms**
- Glitch/flicker effects on headers are decorative — wrap in `prefers-reduced-motion`

---

## Target Users

**Primary user**: Tech-curious, 18–35, already uses an AI voice tool (Claude, ChatGPT, Gemini, etc.) and wants a game that pairs them with their AI.

**Context of use**: AI tool open in voice mode on one device, game page on another. Short sessions (5–15 min), competitive, high-replayability mindset.

**Job to be done**: Experience genuine human-AI collaboration under pressure. Improve at communicating with their AI. Climb the global leaderboard.

**Emotional goals**: Excitement and urgency (not frustration), satisfaction from coordinated teamwork, pride at personal bests, motivation for "one more run."
