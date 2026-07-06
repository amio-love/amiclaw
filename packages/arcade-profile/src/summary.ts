import type { ArcadeProfileSummary, BombSquadProfileRun, OracleProfileSign } from './types'

function newerFirst<T extends { source_key: string }>(
  items: T[],
  getDate: (item: T) => string
): T[] {
  return [...items].sort((a, b) => {
    const byDate = getDate(b).localeCompare(getDate(a))
    return byDate !== 0 ? byDate : b.source_key.localeCompare(a.source_key)
  })
}

function bestRun(runs: BombSquadProfileRun[]): BombSquadProfileRun | null {
  const winners = runs.filter((run) => run.duration_ms >= 0)
  if (winners.length === 0) return null
  return [...winners].sort((a, b) => a.duration_ms - b.duration_ms)[0] ?? null
}

export function summarizeArcadeProfile(input: {
  profileId?: string
  bombsquadRuns: BombSquadProfileRun[]
  oracleSigns: OracleProfileSign[]
  today: string
}): ArcadeProfileSummary {
  const bombsquadRuns = newerFirst(input.bombsquadRuns, (run) => run.finished_at)
  const oracleSigns = newerFirst(input.oracleSigns, (sign) => sign.created_at)
  const recentRun = bombsquadRuns[0] ?? null
  const recentSign = oracleSigns[0] ?? null
  const lastActivityAt =
    [recentRun?.finished_at, recentSign?.created_at]
      .filter((value): value is string => value !== undefined)
      .sort()
      .at(-1) ?? null

  return {
    ...(input.profileId ? { profile_id: input.profileId } : {}),
    last_activity_at: lastActivityAt,
    today_played:
      bombsquadRuns.some((run) => run.finished_at.slice(0, 10) === input.today) ||
      oracleSigns.some((sign) => sign.sign_date === input.today),
    counts: {
      bombsquad_runs: bombsquadRuns.length,
      oracle_signs: oracleSigns.length,
    },
    bombsquad: {
      recent: recentRun,
      best_daily: bestRun(
        bombsquadRuns.filter((run) => run.mode === 'daily' && run.outcome === 'defused')
      ),
      best_practice: bestRun(
        bombsquadRuns.filter((run) => run.mode === 'practice' && run.outcome === 'practice-cleared')
      ),
    },
    oracle: {
      recent: recentSign,
    },
  }
}
