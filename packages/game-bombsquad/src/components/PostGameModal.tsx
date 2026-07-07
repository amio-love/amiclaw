import { useEffect, useId, useState, type FormEvent } from 'react'
import { AI_TOOLS } from '@amiclaw/ui'
import type { SurveyAnswers } from '@shared/event-types'
import { NICKNAME_MAX_LENGTH, isValidNickname, setStoredNickname } from '@/utils/nickname'
import {
  LEADERBOARD_AI_MODEL_MAX_LENGTH,
  LEADERBOARD_AI_TOOL_MAX_LENGTH,
  type LeaderboardPlayerMetadata,
  isValidLeaderboardAiTool,
  normalizeLeaderboardAiModel,
  setStoredLeaderboardPlayerMetadata,
} from '@/utils/leaderboard-player-metadata'
import Button from '@/components/bombsquad/Button'
import styles from './PostGameModal.module.css'

/** Hard caps mirroring the `survey_submit` wire contract (data payload ≤ 1KB). */
const AI_ISSUE_MAX_LENGTH = 200

/** Q1 — single-select AI tool. The first options derive from the shared
 *  `AI_TOOLS` source (lowercased ids); `other` reveals a free-text input. */
const AI_TOOL_OPTIONS = [
  ...AI_TOOLS.map((name) => ({ value: name.toLowerCase(), label: name })),
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
  leaderboardMetadata?: LeaderboardPlayerMetadata
  survey?: SurveyAnswers
}

interface PostGameModalProps {
  open: boolean
  /**
   * Render the nickname section. When true the section is required and gates
   * confirm — but the modal stays dismissable: skipping defers the leaderboard
   * submission (the run is simply not on the board yet) rather than blocking
   * the result screen.
   */
  showNickname: boolean
  /**
   * Render the leaderboard AI metadata section. When true, AI tool is required
   * and gates confirm; model is optional and omitted when blank.
   */
  showLeaderboardMetadata?: boolean
  /** Render the 4-question survey section. */
  showSurvey: boolean
  /**
   * Fired on confirm with whichever sections were filled. The caller runs the
   * nickname-confirm path when `result.nickname` is set and emits the
   * `survey_submit` event when `result.survey` is set.
   */
  onConfirm: (result: PostGameModalResult) => void
  /** Fired when the modal is dismissed without submitting (skip / Esc / backdrop). */
  onSkip: () => void
}

/**
 * Unified post-game modal — never two stacked dialogs.
 *
 * Composes two optional sections:
 *  - Nickname / AI metadata: the leaderboard submission gate for a first
 *    daily win. Deferrable — skipping keeps the run off the board and the
 *    caller re-offers the gate later (the result page's 上榜 CTA).
 *  - Survey: a 4-question endgame survey, shown once per device.
 *
 * Every shape is dismissable via the skip button, Esc, or a backdrop click;
 * only the skip semantics differ (the caller retires a skipped survey but
 * keeps a skipped leaderboard gate re-openable).
 *
 * Styled in the Atlas star-chart visual language — a glass-card dialog on a
 * dimmed cosmic backdrop with the AMIO-yellow accent (docs/DesignSystem.md).
 */
export default function PostGameModal({
  open,
  showNickname,
  showLeaderboardMetadata = false,
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
  const [aiModel, setAiModel] = useState('')
  const [leaderboardMetadataError, setLeaderboardMetadataError] = useState<string | null>(null)
  const [fun, setFun] = useState(0)
  const [difficulty, setDifficulty] = useState<DifficultyValue | null>(null)
  const [aiIssue, setAiIssue] = useState('')

  const baseId = useId()
  const titleId = `${baseId}-title`
  const nicknameTipId = `${baseId}-nickname-tip`
  const leaderboardMetadataTipId = `${baseId}-leaderboard-metadata-tip`
  const q1Id = `${baseId}-q1`
  const q2Id = `${baseId}-q2`
  const q3Id = `${baseId}-q3`
  const q4Id = `${baseId}-q4`

  // The survey-only shape keeps its stricter submit gating and its 跳过
  // wording; leaderboard shapes defer with 稍后再说 instead.
  const surveyOnly = showSurvey && !showNickname && !showLeaderboardMetadata

  // Esc dismisses every shape. Registered before the early return so the
  // hook order stays stable across renders.
  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onSkip()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onSkip])

  if (!open) return null

  const trimmedNickname = nickname.trim()
  const nicknameOk = !showNickname || isValidNickname(nickname)

  const resolvedAiTool = (aiTool === 'other' ? aiToolOther.trim() : aiTool).slice(
    0,
    LEADERBOARD_AI_TOOL_MAX_LENGTH
  )
  const aiToolOk = isValidLeaderboardAiTool(resolvedAiTool)
  const leaderboardMetadataOk = !showLeaderboardMetadata || aiToolOk
  // The survey is "complete" only when all three required questions (Q1/Q2/Q3)
  // are answered; Q4 is always optional.
  const surveyComplete = aiToolOk && fun >= 1 && difficulty !== null

  // The survey is best-effort and never a hard gate. It only gates confirm in
  // the survey-only modal — which always offers a separate skip affordance
  // anyway. Whenever the nickname section is present, confirm needs only a
  // valid nickname; a partially-filled survey is dropped silently on confirm.
  const canConfirm = nicknameOk && leaderboardMetadataOk && (surveyOnly ? surveyComplete : true)

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

    if (showLeaderboardMetadata) {
      const metadata: LeaderboardPlayerMetadata = {
        aiTool: resolvedAiTool,
      }
      const resolvedAiModel = normalizeLeaderboardAiModel(aiModel)
      if (resolvedAiModel) metadata.aiModel = resolvedAiModel
      const ok = setStoredLeaderboardPlayerMetadata(metadata)
      if (!ok) {
        setLeaderboardMetadataError('保存失败，请重试。')
        return
      }
      result.leaderboardMetadata = metadata
    }

    // Emit survey answers only when the survey section was shown AND fully
    // answered. Confirming a merged modal with an untouched/partial survey
    // simply omits `result.survey` — no `survey_submit` fires for it.
    if (showSurvey && surveyComplete) {
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
    setLeaderboardMetadataError(null)
    onConfirm(result)
  }

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault()
    handleConfirm()
  }

  return (
    <div className={styles.overlay} role="presentation" onClick={onSkip}>
      <div
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={showNickname ? nicknameTipId : undefined}
        onClick={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          className={styles.closeBtn}
          onClick={onSkip}
          aria-label={surveyOnly ? '跳过问卷' : '关闭'}
        >
          ✕
        </button>

        <h2 id={titleId} className={styles.title}>
          {showNickname
            ? '给自己起个名字'
            : showLeaderboardMetadata
              ? '记录你的 AI 搭档'
              : '聊聊这一局'}
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

          {showNickname && (showLeaderboardMetadata || showSurvey) && (
            <hr className={styles.divider} />
          )}

          {showLeaderboardMetadata && (
            <section className={styles.section}>
              <p id={leaderboardMetadataTipId} className={styles.tip}>
                排行榜需要记录你这局使用的 AI 助手；具体模型选填。
              </p>
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
                      onClick={() => {
                        setAiTool(opt.value)
                        if (leaderboardMetadataError) setLeaderboardMetadataError(null)
                      }}
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
                    onChange={(e) => {
                      setAiToolOther(e.target.value)
                      if (leaderboardMetadataError) setLeaderboardMetadataError(null)
                    }}
                    maxLength={LEADERBOARD_AI_TOOL_MAX_LENGTH}
                    placeholder="请填写工具名称"
                    aria-label="其他 AI 工具名称"
                  />
                )}
              </fieldset>
              <label className={styles.label}>
                <span className={styles.labelText}>具体模型（选填）</span>
                <input
                  className={styles.input}
                  type="text"
                  value={aiModel}
                  onChange={(e) => setAiModel(e.target.value)}
                  maxLength={LEADERBOARD_AI_MODEL_MAX_LENGTH}
                  placeholder="例如：Claude Sonnet 4.5"
                />
              </label>
              <div className={styles.meta}>
                <span className={styles.counter} aria-live="polite">
                  {aiModel.trim().length} / {LEADERBOARD_AI_MODEL_MAX_LENGTH}
                </span>
                {leaderboardMetadataError && (
                  <span className={styles.error} role="alert">
                    {leaderboardMetadataError}
                  </span>
                )}
              </div>
            </section>
          )}

          {showLeaderboardMetadata && showSurvey && <hr className={styles.divider} />}

          {showSurvey && (
            <section className={styles.section}>
              {showNickname && (
                <p className={styles.surveyIntro}>
                  顺便聊聊这一局 —— 以下问卷选填，想跳过直接点「确认」即可。
                </p>
              )}

              {!showLeaderboardMetadata && (
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
                      maxLength={LEADERBOARD_AI_TOOL_MAX_LENGTH}
                      placeholder="请填写工具名称"
                      aria-label="其他 AI 工具名称"
                    />
                  )}
                </fieldset>
              )}

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

          {!surveyOnly && (
            // Honest deferral note for the leaderboard gate: skipping keeps
            // the run off the board, and the result page re-offers the fill.
            <p className={styles.tip}>现在跳过也可以 —— 成绩暂不上榜，稍后可在结果页补填。</p>
          )}

          <div className={styles.actions}>
            <Button variant="primary" type="submit" full disabled={!canConfirm}>
              {showNickname ? '确认' : '提交'}
            </Button>
            <Button variant="ghost" full onClick={onSkip}>
              {surveyOnly ? '跳过' : '稍后再说'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}
