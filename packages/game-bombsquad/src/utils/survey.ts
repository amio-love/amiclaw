/**
 * Per-device endgame survey gating.
 *
 * The post-game survey is shown once per device. The first time a player
 * reaches ResultPage after any game outcome, the survey section of
 * PostGameModal is shown; once they submit OR skip it, `markSurveyAnswered`
 * writes a flag to localStorage and the survey never shows again on this
 * device. Mirrors the storage-util pattern in `nickname.ts`.
 */

const SURVEY_ANSWERED_KEY = 'bombsquad-survey-answered'

/**
 * Returns true when this device has already answered or skipped the survey.
 *
 * Returns false when the flag is absent or localStorage access throws
 * (private mode / disabled). A read failure errs toward showing the survey
 * once more rather than silently suppressing it forever.
 */
export function hasAnsweredSurvey(): boolean {
  try {
    return localStorage.getItem(SURVEY_ANSWERED_KEY) === 'true'
  } catch {
    return false
  }
}

/**
 * Marks the survey as answered/skipped for this device. Storage failures
 * (quota exceeded / private mode) are swallowed — the only consequence is
 * the survey may show again on a later run, which is acceptable.
 */
export function markSurveyAnswered(): void {
  try {
    localStorage.setItem(SURVEY_ANSWERED_KEY, 'true')
  } catch {
    /* storage full / disabled — survey simply shows again next time */
  }
}
