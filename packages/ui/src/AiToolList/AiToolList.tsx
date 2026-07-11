import { Fragment, type ReactNode } from 'react'
import Chip from '../Chip'
import styles from './AiToolList.module.css'

/* The single ordered source of the supported voice-AI tools. Official
   title-case; consumed everywhere — no surface re-declares this list. See
   DesignSystem.md §Brand → AI-Tools List. */
export const AI_TOOLS = [
  'Claude',
  'ChatGPT',
  'Gemini',
  'Openclaw',
  'Hermes',
  '豆包',
  '千问',
  'DeepSeek',
] as const

/* The platform's own voice companion, tagged on a leaderboard entry when a run
   was played with the companion's voice connected (mode②). It is NOT a BYO tool
   the player picks — it never appears in `AI_TOOLS` (the chips / ticker), only as
   a resolvable id → label so an inferred companion run reads honestly on the
   board. Stable id kept out of the human-typeable space so it can never collide
   with a free-text "其他" tool. */
export const COMPANION_TOOL_ID = 'companion'
const COMPANION_TOOL_LABEL = 'AMIO 语音伙伴'

/* id → display label, derived from the single AI_TOOLS source (+ the companion
   id above). Leaderboard entries / survey answers store a lowercased tool id
   (`claude`); this resolves it back to the canonical display name so no surface
   hand-maintains a second id→name map. Unknown ids pass through unchanged. */
const LABEL_BY_ID = new Map<string, string>([
  ...AI_TOOLS.map((name) => [name.toLowerCase(), name] as const),
  [COMPANION_TOOL_ID, COMPANION_TOOL_LABEL],
])
export function toolLabel(id: string): string {
  return LABEL_BY_ID.get(id.toLowerCase()) ?? id
}

interface AiToolListProps {
  /* Optional leading label supplied by the consumer (e.g. `支持`). */
  prefix?: ReactNode
  /* `inline` → names emphasized and ` · ` joined.
     `chips` → brand-yellow pills. */
  variant?: 'inline' | 'chips'
  className?: string
}

/* Renders the canonical AI-tools list from the single `AI_TOOLS` source. The
   inline separator is always ` · ` (U+00B7); tool names carry weight 500. */
export default function AiToolList({ prefix, variant = 'inline', className }: AiToolListProps) {
  if (variant === 'chips') {
    const classes = [styles.chips, className].filter(Boolean).join(' ')
    return (
      <span className={classes}>
        {prefix !== undefined && <span className={styles.prefix}>{prefix}</span>}
        {AI_TOOLS.map((tool) => (
          <Chip key={tool} variant="brand">
            {tool}
          </Chip>
        ))}
      </span>
    )
  }

  const classes = [styles.inline, className].filter(Boolean).join(' ')
  return (
    <span className={classes}>
      {prefix !== undefined && (
        <>
          <span className={styles.prefix}>{prefix}</span>{' '}
        </>
      )}
      {AI_TOOLS.map((tool, index) => (
        <Fragment key={tool}>
          {index > 0 && ' · '}
          <span className={styles.tool}>{tool}</span>
        </Fragment>
      ))}
    </span>
  )
}
