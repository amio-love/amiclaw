import { useSearchParams } from 'react-router-dom'
import styles from './GamePage.module.css'
import { levels, levelById } from '@/data/load'
import { GardenRun } from './GardenRun'

/**
 * Level-select shell. Reads `?level=<id>` (default bg-demo-001) and `?ai=<gameId>`
 * (default demo-mock inside the voice hook), renders a minimal level picker when
 * more than one level exists, and mounts GardenRun keyed on the level id so a
 * level switch is a clean reset.
 */
export function GamePage() {
  const [params, setParams] = useSearchParams()
  const entry = levelById(params.get('level'))
  const aiParam = params.get('ai') ?? undefined
  // Controlled-clock test seam — dev-only (compiled out of production: DEV is
  // false in the prod build, so this is always false there regardless of the URL).
  const e2e = import.meta.env.DEV && params.get('e2e') === '1'

  const pickLevel = (id: string) => {
    const next: Record<string, string> = { level: id }
    if (aiParam) next.ai = aiParam
    if (params.get('e2e') === '1') next.e2e = '1'
    setParams(next)
  }

  return (
    <>
      {levels.length > 1 && (
        <nav className={styles.levelPicker} aria-label="关卡选择">
          {levels.map((lvl) => (
            <button
              key={lvl.id}
              type="button"
              className={styles.levelChip}
              aria-current={lvl.id === entry.id}
              onClick={() => pickLevel(lvl.id)}
            >
              {lvl.title}
            </button>
          ))}
        </nav>
      )}
      <GardenRun key={entry.id} level={entry.level} gameId={aiParam} e2e={e2e} />
    </>
  )
}
