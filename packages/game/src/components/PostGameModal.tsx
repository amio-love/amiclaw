import { useEffect, useId, useState, type FormEvent } from 'react'
import type { SurveyAnswers } from '@shared/event-types'
import { NICKNAME_MAX_LENGTH, isValidNickname, setStoredNickname } from '@/utils/nickname'
import Button from '@/components/bombsquad/Button'
import styles from './PostGameModal.module.css'

/** Hard caps mirroring the `survey_submit` wire contract (data payload ≤ 1KB). */
const AI_TOOL_MAX_LENGTH = 40
const AI_ISSUE_MAX_LENGTH = 200

/** Q1 — single-select AI tool. `other` reveals a free-text input. */
const AI_TOOL_OPTIONS = [
  { value: 'claude', label: 'Claude' },
  { value: 'chatgpt', label: 'ChatGPT' },
  { value: 'gemini', label: 'Gemini' },
  { value: 'other', label: '其他' },
] as const

/** Q2 — 1-5 fun rating. */
const FUN_RATINGS = [1, 2, 3, 4, 5] as const

/** Q3 — single-select difficulty; values map straight to `SurveyAnswers`. */
const DIFFICULTY_OPTIONS = [
  { value: 'too-hard', label: '太难' },
  { value: 'just-right', label: '刚好' },
  { value: 'too-easy', label: '太易' },
] as const

type DifficultyValue = SurveyAnswers['difficulty']

/**
 * Result emitted on a successful confirm. Each field is present iff the
 * corresponding section was rendered (`showNickname` / `showSurvey`).
 */
export interface PostGameModalResult {
  nickname?: string
  survey?: SurveyAnswers
}

interface PostGameModalProps {
  open: boolean
  /**
   * Render the nickname section. When true the section is required and gates
   * confirm — the modal also becomes non-dismissable (no Esc / backdrop / skip)
   * because a daily score cannot post without a nickname.
   */
  showNickname: boolean
  /** Render the 4-question survey section. */
  showSurvey: boolean
  /**
   * Fired on confirm with whichever sections were filled. The caller runs the
   * nickname-confirm path when `result.nickname` is set and emits the
   * `survey_submit` event when `result.survey` is set.
   */
  onConfirm: (result: PostGameModalResult) => void
  /** Fired when a survey-only modal is dismissed without submitting. */
  onSkip: () => void
}

/**
 * Unified post-game modal — never two stacked dialogs.
 *
 * Composes two optional sections:
 *  - Nickname: required first-submission gate for the daily leaderboard.
 *  - Survey: a 4-question endgame survey, shown once per device.
 *
 * The modal opens when EITHER section is needed. Dismissability is
 * conditional: with the nickname section present the modal is non-dismissable
 * (no close affordance, Esc / backdrop inert); when only the survey shows it
 * is dismissable via the skip button, Esc, or a backdrop click.
 *
 * Styled in the Atlas star-chart visual language — a glass-card dialog on a
 * dimmed cosmic backdrop with the AMIO-yellow accent (docs/DesignSystem.md).
 */
export default function PostGameModal({
  open,
  showNickname,
  showSurvey,
  onConfirm,
  onSkip,
}: PostGameModalProps) {
  // Nickname section state.
  const [nickname, setNickname] = useState('')
  const [nicknameError, setNicknameError] = useState<string | null>(null)

  // Survey section state. Empty string / 0 / null mean "not yet answered".
  const [aiTool, setAiTool] = useState<string>('')
  const [aiToolOther, setAiToolOther] = useState('')
  const [fun, setFun] = useState(0)
  const [difficulty, setDifficulty] = useState<DifficultyValue | null>(null)
  const [aiIssue, setAiIssue] = useState('')

  const baseId = useId()
  const titleId = `${baseId}-title`
  const nicknameTipId = `${baseId}-nickname-tip`
  const q1Id = `${baseId}-q1`
  const q2Id = `${baseId}-q2`
  const q3Id = `${baseId}-q3`
  const q4Id = `${baseId}-q4`

  // Non-dismissable whenever the nickname gate is present.
  const dismissable = showSurvey && !showNickname

  // Esc closes a survey-only modal. Registered before the early return so the
  // hook order stays stable across renders.
  useEffect(() => {
    if (!open || !dismissable) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onSkip()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, dismissable, onSkip])

  if (!open) return null

  const trimmedNickname = nickname.trim()
  const nicknameOk = !showNickname || isValidNickname(nickname)

  const aiToolOk = aiTool !== '' && (aiTool !== 'other' || aiToolOther.trim().length > 0)
  // The survey is "complete" only when all three required questions (Q1/Q2/Q3)
  // are answered; Q4 is always optional.
  const surveyComplete = aiToolOk && fun >= 1 && difficulty !== null

  // The survey is best-effort and never a hard gate. It only gates confirm in
  // the survey-only modal — which always offers a separate skip affordance
  // anyway. Whenever the nickname section is present, confirm needs only a
  // valid nickname; a partially-filled survey is dropped silently on confirm.
  const canConfirm = nicknameOk && (dismissable ? surveyComplete : true)

  const handleConfirm = () => {
    if (!canConfirm) return

    const result: PostGameModalResult = {}

    if (showNickname) {
      const ok = setStoredNickname(nickname)
      if (!ok) {
        setNicknameError('保存失败，请重试。')
        return
      }
      result.nickname = trimmedNickname
    }

    // Emit survey answers only when the survey section was shown AND fully
    // answered. Confirming a merged modal with an untouched/partial survey
    // simply omits `result.survey` — no `survey_submit` fires for it.
    if (showSurvey && surveyComplete) {
      const resolvedAiTool = (aiTool === 'other' ? aiToolOther.trim() : aiTool).slice(
        0,
        AI_TOOL_MAX_LENGTH
      )
      const survey: SurveyAnswers = {
        ai_tool: resolvedAiTool,
        fun,
        difficulty: difficulty as DifficultyValue,
      }
      const trimmedIssue = aiIssue.trim().slice(0, AI_ISSUE_MAX_LENGTH)
      if (trimmedIssue.length > 0) survey.ai_issue = trimmedIssue
      result.survey = survey
    }

    setNicknameError(null)
    onConfirm(result)
  }

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault()
    handleConfirm()
  }

  return (
    <div className={styles.overlay} role="presentation" onClick={dismissable ? onSkip : undefined}>
      <div
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={showNickname ? nicknameTipId : undefined}
        onClick={(event) => event.stopPropagation()}
      >
        {dismissable && (
          <button type="button" className={styles.closeBtn} onClick={onSkip} aria-label="跳过问卷">
            ✕
          </button>
        )}

        <h2 id={titleId} className={styles.title}>
          {showNickname ? '给自己起个名字' : '聊聊这一局'}
        </h2>

        <form className={styles.form} onSubmit={handleSubmit}>
          {showNickname && (
            <section className={styles.section}>
              <p id={nicknameTipId} className={styles.tip}>
                排行榜上需要一个能让朋友找到你的名字。最多 {NICKNAME_MAX_LENGTH} 字。
              </p>
              <label className={styles.label}>
                <span className={styles.labelText}>昵称</span>
                <input
                  className={styles.input}
                  type="text"
                  value={nickname}
                  onChange={(e) => {
                    setNickname(e.target.value)
                    if (nicknameError) setNicknameError(null)
                  }}
                  maxLength={NICKNAME_MAX_LENGTH}
                  autoFocus
                />
              </label>
              <div className={styles.meta}>
                <span className={styles.counter} aria-live="polite">
                  {trimmedNickname.length} / {NICKNAME_MAX_LENGTH}
                </span>
                {nicknameError && (
                  <span className={styles.error} role="alert">
                    {nicknameError}
                  </span>
                )}
              </div>
            </section>
          )}

          {showNickname && showSurvey && <hr className={styles.divider} />}

          {showSurvey && (
            <section className={styles.section}>
              {showNickname && (
                <p className={styles.surveyIntro}>
                  顺便聊聊这一局 —— 以下问卷选填，想跳过直接点「确认」即可。
                </p>
              )}

              {/* Q1 — AI tool */}
              <fieldset className={styles.question}>
                <legend id={q1Id} className={styles.questionLabel}>
                  你这局用的是哪个 AI 工具？
                </legend>
                <div className={styles.options}>
                  {AI_TOOL_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      className={`${styles.optionBtn} ${
                        aiTool === opt.value ? styles.optionSelected : ''
                      }`}
                      aria-pressed={aiTool === opt.value}
                      onClick={() => setAiTool(opt.value)}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
                {aiTool === 'other' && (
                  <input
                    className={styles.input}
                    type="text"
                    value={aiToolOther}
                    onChange={(e) => setAiToolOther(e.target.value)}
                    maxLength={AI_TOOL_MAX_LENGTH}
                    placeholder="请填写工具名称"
                    aria-label="其他 AI 工具名称"
                  />
                )}
              </fieldset>

              {/* Q2 — fun rating */}
              <fieldset className={styles.question}>
                <legend id={q2Id} className={styles.questionLabel}>
                  整体好玩程度
                </legend>
                <div className={styles.options}>
                  {FUN_RATINGS.map((rating) => (
                    <button
                      key={rating}
                      type="button"
                      className={`${styles.ratingBtn} ${
                        fun === rating ? styles.optionSelected : ''
                      }`}
                      aria-pressed={fun === rating}
                      aria-label={`好玩程度 ${rating} 分`}
                      onClick={() => setFun(rating)}
                    >
                      {rating}
                    </button>
                  ))}
                </div>
              </fieldset>

              {/* Q3 — difficulty */}
              <fieldset className={styles.question}>
                <legend id={q3Id} className={styles.questionLabel}>
                  难度感受
                </legend>
                <div className={styles.options}>
                  {DIFFICULTY_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      className={`${styles.optionBtn} ${
                        difficulty === opt.value ? styles.optionSelected : ''
                      }`}
                      aria-pressed={difficulty === opt.value}
                      onClick={() => setDifficulty(opt.value)}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </fieldset>

              {/* Q4 — optional AI issue free text */}
              <fieldset className={`${styles.question} ${styles.questionHighlight}`}>
                <legend id={q4Id} className={styles.questionLabel}>
                  和 AI 协作时，AI 最大的问题是什么？
                </legend>
                <p className={styles.questionHint}>选填，但你的一句话对我们最有用</p>
                <textarea
                  className={styles.textarea}
                  value={aiIssue}
                  onChange={(e) => setAiIssue(e.target.value)}
                  maxLength={AI_ISSUE_MAX_LENGTH}
                  rows={3}
                  placeholder="例如：经常听不懂我描述的线路颜色"
                  aria-labelledby={q4Id}
                />
                <span className={styles.counter} aria-live="polite">
                  {aiIssue.trim().length} / {AI_ISSUE_MAX_LENGTH}
                </span>
              </fieldset>
            </section>
          )}

          <div className={styles.actions}>
            <Button variant="primary" type="submit" full disabled={!canConfirm}>
              {showNickname ? '确认' : '提交'}
            </Button>
            {dismissable && (
              <Button variant="ghost" full onClick={onSkip}>
                跳过
              </Button>
            )}
          </div>
        </form>
      </div>
    </div>
  )
}
