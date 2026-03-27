# Plan: Write Design Context to CLAUDE.md

> Historical note: this plan predates the current implementation and design-system docs. It should be read as archival planning context, not as a statement of current repository status.

## Context
AmiClaw was a greenfield human-AI collaborative gaming platform with no code yet when this plan was written. The repository now contains code and design-system docs.

## What to Do
1. Create `/Users/yubai/amiclaw/CLAUDE.md` with a `## Design Context` section
2. Synthesize findings from docs + user answers into actionable design guidelines

### Key Design Decisions (from user)
- **Personality**: Quirky + Retro + Collaborative (warm, fun, human-AI teamwork focus)
- **Visual references**: Cyberpunk 2077 / Hacknet UI (neon terminals, glitch effects, HUD overlays)
- **Theme**: Dark mode only
- **Accessibility**: WCAG AA standard

### Design Context to Write

**Color Palette** (from docs):
- Dark background: `#1a1a2e`
- Neon cyan: `#0ff`
- Neon green: `#39ff14`
- Neon red: `#ff073a`
- Anti-human manual: `#888` on `#999`

**Typography**: Monospace (console/puzzle UI) + Sans-serif (general UI text)

**CSS Approach**: CSS Modules + CSS custom properties, CSS-only animations (no JS animation libs)

**Layout**: Responsive — desktop 60% centered, mobile full-width with 44px+ touch targets

## Verification
- Confirm CLAUDE.md exists at project root with Design Context section
- Ensure all design principles align with docs and user preferences
