/**
 * Pure decision logic for the daily personal-best record kept in KV.
 *
 * KV value shape evolved from `{ time_ms }` to `{ time_ms, attempt_number }`.
 * Legacy records may be missing `attempt_number`; this helper preserves that
 * absence so the response layer can omit `personal_best_attempt` entirely
 * (rather than emit `undefined`) when the existing best predates the field.
 */
export interface BestRecord {
  time_ms: number
  attempt_number?: number
}

export interface BestSubmission {
  time_ms: number
  attempt_number: number
}

export interface ComputeBestResult {
  record: BestRecord
  isNewBest: boolean
}

/**
 * Decide the canonical best record after a submission.
 *
 * Strict `<` on time_ms: ties keep the existing record, so the older attempt
 * — the canonical "first to achieve this time" — wins. When `currentBest` is
 * `null` (fresh KV), the submission becomes the new best.
 */
export function computeBestRecord(
  currentBest: BestRecord | null,
  submission: BestSubmission
): ComputeBestResult {
  if (!currentBest || submission.time_ms < currentBest.time_ms) {
    return {
      record: {
        time_ms: submission.time_ms,
        attempt_number: submission.attempt_number,
      },
      isNewBest: true,
    }
  }
  return { record: currentBest, isNewBest: false }
}
