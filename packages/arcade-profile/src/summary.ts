import { getProductDaysEndingAt } from '../../../shared/date'
import type {
  ArcadeDailyLoopSummary,
  ArcadeProfileHistoryDay,
  ArcadeProfileSummary,
  ArcadeStreakSummary,
  BombSquadProfileRun,
  OracleProfileSign,
} from './types'

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

export interface QualifiedActivityDate {
  date: string
  completed_at: string | null
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function isIsoDate(value: string): boolean {
  return ISO_DATE_RE.test(value)
}

function shiftDate(date: string, deltaDays: number): string | null {
  if (!isIsoDate(date)) return null
  const [year, month, day] = date.split('-').map(Number)
  const time = Date.UTC(year, month - 1, day) + deltaDays * 86_400_000
  return new Date(time).toISOString().slice(0, 10)
}

function normalizeQualifiedDates(dates: QualifiedActivityDate[], today: string): string[] {
  return [
    ...new Set(dates.map((item) => item.date).filter((date) => isIsoDate(date) && date <= today)),
  ].sort()
}

function latestCompletedAt(items: QualifiedActivityDate[], today: string): string | null {
  return (
    items
      .filter((item) => item.date === today && item.completed_at !== null)
      .map((item) => item.completed_at as string)
      .sort()
      .at(-1) ?? null
  )
}

export function qualifiedBombSquadRunDate(run: BombSquadProfileRun): QualifiedActivityDate | null {
  if (run.mode !== 'daily' || run.outcome !== 'defused') return null
  const date = run.finished_at.slice(0, 10)
  return isIsoDate(date) ? { date, completed_at: run.finished_at } : null
}

export function qualifiedOracleSignDate(sign: OracleProfileSign): QualifiedActivityDate | null {
  if (!isIsoDate(sign.sign_date) || sign.created_at.slice(0, 10) !== sign.sign_date) return null
  return { date: sign.sign_date, completed_at: sign.created_at }
}

export function computeArcadeStreak(
  dates: QualifiedActivityDate[],
  today: string
): ArcadeStreakSummary {
  const sortedDates = normalizeQualifiedDates(dates, today)
  const dateSet = new Set(sortedDates)
  let longestDays = 0
  let runLength = 0
  let previous: string | null = null

  for (const date of sortedDates) {
    runLength = previous && shiftDate(previous, 1) === date ? runLength + 1 : 1
    longestDays = Math.max(longestDays, runLength)
    previous = date
  }

  const todayCompleted = dateSet.has(today)
  const anchor = todayCompleted ? today : (shiftDate(today, -1) ?? today)
  let currentDays = 0
  let cursor: string | null = anchor
  while (cursor !== null && dateSet.has(cursor)) {
    currentDays += 1
    cursor = shiftDate(cursor, -1)
  }

  return {
    today_completed: todayCompleted,
    current_days: currentDays,
    longest_days: longestDays,
    last_active_date: sortedDates.at(-1) ?? null,
  }
}

export function summarizeDailyLoop(input: {
  bombsquadRuns: BombSquadProfileRun[]
  oracleSigns: OracleProfileSign[]
  today: string
  qualifiedBombSquadDates?: QualifiedActivityDate[]
  qualifiedOracleDates?: QualifiedActivityDate[]
}): ArcadeDailyLoopSummary {
  const bombsquadDates =
    input.qualifiedBombSquadDates ??
    input.bombsquadRuns
      .map(qualifiedBombSquadRunDate)
      .filter((item): item is QualifiedActivityDate => item !== null)
  const oracleDates =
    input.qualifiedOracleDates ??
    input.oracleSigns
      .map(qualifiedOracleSignDate)
      .filter((item): item is QualifiedActivityDate => item !== null)
  const allDates = [...bombsquadDates, ...oracleDates]
  const streak = computeArcadeStreak(allDates, input.today)

  return {
    date: input.today,
    checklist: {
      bombsquad_daily: {
        completed: bombsquadDates.some((item) => item.date === input.today),
        completed_at: latestCompletedAt(bombsquadDates, input.today),
      },
      oracle_sign: {
        completed: oracleDates.some((item) => item.date === input.today),
        completed_at: latestCompletedAt(oracleDates, input.today),
      },
    },
    streak,
  }
}

export const HISTORY_WINDOW_DAYS = 7

/* Per-day record view over the last `HISTORY_WINDOW_DAYS` product days (today
   first; the day window comes from the shared getProductDaysEndingAt so every
   history surface derives its days from one source). Checklist booleans come
   from the qualified activity dates — the same rules the streak uses — while
   the showable records (best daily run, the day's sign) come from the run /
   sign arrays. Callers with authoritative qualified dates beyond the capped
   arrays (the D1 store) pass them in. */
export function summarizeArcadeHistory(input: {
  bombsquadRuns: BombSquadProfileRun[]
  oracleSigns: OracleProfileSign[]
  today: string
  qualifiedBombSquadDates: QualifiedActivityDate[]
  qualifiedOracleDates: QualifiedActivityDate[]
}): ArcadeProfileHistoryDay[] {
  const bombsquadDays = new Set(input.qualifiedBombSquadDates.map((item) => item.date))
  const oracleDays = new Set(input.qualifiedOracleDates.map((item) => item.date))

  return getProductDaysEndingAt(input.today, HISTORY_WINDOW_DAYS).map((date) => {
    const dayRuns = input.bombsquadRuns.filter((run) => run.finished_at.slice(0, 10) === date)
    return {
      date,
      bombsquad_daily_completed: bombsquadDays.has(date),
      oracle_signed: oracleDays.has(date),
      runs: dayRuns.length,
      best_daily: bestRun(
        dayRuns.filter((run) => run.mode === 'daily' && run.outcome === 'defused')
      ),
      // Signs key on sign_date (the day the sign is FOR); the newest created_at
      // wins when a day was re-cast.
      sign:
        [...input.oracleSigns]
          .filter((sign) => sign.sign_date === date)
          .sort((a, b) => b.created_at.localeCompare(a.created_at))[0] ?? null,
    }
  })
}

export function summarizeArcadeProfile(input: {
  profileId?: string
  bombsquadRuns: BombSquadProfileRun[]
  oracleSigns: OracleProfileSign[]
  today: string
  counts?: {
    bombsquad_runs: number
    oracle_signs: number
  }
  qualifiedBombSquadDates?: QualifiedActivityDate[]
  qualifiedOracleDates?: QualifiedActivityDate[]
}): ArcadeProfileSummary {
  const bombsquadRuns = newerFirst(input.bombsquadRuns, (run) => run.finished_at)
  const oracleSigns = newerFirst(input.oracleSigns, (sign) => sign.created_at)
  const qualifiedBombSquadDates =
    input.qualifiedBombSquadDates ??
    bombsquadRuns
      .map(qualifiedBombSquadRunDate)
      .filter((item): item is QualifiedActivityDate => item !== null)
  const qualifiedOracleDates =
    input.qualifiedOracleDates ??
    oracleSigns
      .map(qualifiedOracleSignDate)
      .filter((item): item is QualifiedActivityDate => item !== null)
  const dailyLoop = summarizeDailyLoop({
    bombsquadRuns,
    oracleSigns,
    today: input.today,
    qualifiedBombSquadDates,
    qualifiedOracleDates,
  })
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
      oracleSigns.some((sign) => qualifiedOracleSignDate(sign)?.date === input.today),
    counts: {
      bombsquad_runs: input.counts?.bombsquad_runs ?? bombsquadRuns.length,
      oracle_signs: input.counts?.oracle_signs ?? oracleSigns.length,
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
    daily_loop: dailyLoop,
    history: summarizeArcadeHistory({
      bombsquadRuns,
      oracleSigns,
      today: input.today,
      qualifiedBombSquadDates,
      qualifiedOracleDates,
    }),
  }
}
