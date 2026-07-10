import { useId, useState, type FormEvent } from 'react'
import { AI_TOOLS, Button, Modal } from '@amiclaw/ui'
import type { SurveyAnswers } from '@shared/event-types'
import { LEADERBOARD_AI_TOOL_MAX_LENGTH } from '@/utils/leaderboard-player-metadata'
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

interface PostGameModalProps {
  open: boolean
  /** Fired on a completed submit with the 4-question survey answers. */
  onSubmit: (survey: SurveyAnswers) => void
  /** Fired when the survey is dismissed without submitting (跳过 / × / Esc / backdrop). */
  onSkip: () => void
}

/**
 * Post-game survey dialog — a once-per-device 4-question endgame survey, built
 * on the shared `Modal` primitive (portal + dimmed cosmic backdrop + Esc /
 * backdrop / × dismissal + scroll-lock). It is opened from the result page's
 * calm fold-in「聊聊这一局」entry AFTER the settlement has settled, so it can
 * never stack over the celebration / consolation moment (audit U13).
 *
 * The nickname gate and the leaderboard AI-tool gate this modal used to host are
 * both retired: a signed-in run auto-submits under the account username and the
 * leaderboard tool is inferred (companion run) or asked once inline on the
 * result surface. This dialog is now the survey alone.
 */
export default function PostGameModal({ open, onSubmit, onSkip }: PostGameModalProps) {
  const [aiTool, setAiTool] = useState<string>('')
  const [aiToolOther, setAiToolOther] = useState('')
  const [fun, setFun] = useState(0)
  const [difficulty, setDifficulty] = useState<DifficultyValue | null>(null)
  const [aiIssue, setAiIssue] = useState('')

  const baseId = useId()
  const q1Id = `${baseId}-q1`
  const q2Id = `${baseId}-q2`
  const q3Id = `${baseId}-q3`
  const q4Id = `${baseId}-q4`

  const resolvedAiTool = (aiTool === 'other' ? aiToolOther.trim() : aiTool).slice(
    0,
    LEADERBOARD_AI_TOOL_MAX_LENGTH
  )
  // The survey is "complete" only when the three required questions (Q1/Q2/Q3)
  // are answered; Q4 is always optional.
  const surveyComplete = resolvedAiTool.length > 0 && fun >= 1 && difficulty !== null

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault()
    if (!surveyComplete) return
    const survey: SurveyAnswers = {
      ai_tool: resolvedAiTool,
      fun,
      difficulty: difficulty as DifficultyValue,
    }
    const trimmedIssue = aiIssue.trim().slice(0, AI_ISSUE_MAX_LENGTH)
    if (trimmedIssue.length > 0) survey.ai_issue = trimmedIssue
    onSubmit(survey)
  }

  return (
    <Modal open={open} onClose={onSkip} title="聊聊这一局">
      <form className={styles.form} onSubmit={handleSubmit}>
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
                className={`${styles.optionBtn} ${aiTool === opt.value ? styles.optionSelected : ''}`}
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
                className={`${styles.ratingBtn} ${fun === rating ? styles.optionSelected : ''}`}
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

        <div className={styles.actions}>
          <Button variant="primary" type="submit" full disabled={!surveyComplete}>
            提交
          </Button>
          <Button variant="ghost" full onClick={onSkip}>
            跳过
          </Button>
        </div>
      </form>
    </Modal>
  )
}
