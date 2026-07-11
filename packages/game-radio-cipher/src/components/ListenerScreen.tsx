/**
 * 监听台 — the listener's radio-receiver screen. The player hears ciphered
 * syllables (▶ 收听), types what they heard into the 听写板 and reports it to the
 * decoder, works the 韵母拨盘, and types the decrypted 汉字. No method/key
 * knowledge lives here — that is the decoder's codebook. State progression and
 * win are driven by the real engine (see useGameSession).
 */

import { useEffect, useRef, useState } from 'react'
import { RadioAudio } from '../audio'
import { PLAYABLE_LEVELS, type PlayableLevel } from '../content/levels'
import type { PlayableSegment } from '../content/tutorial-level'
import { useGameSession, type SegmentProgress, type SubmitResult } from '../game/useGameSession'
import { FinalsDial } from './FinalsDial'
import { hasOnboarded, markOnboarded, Onboarding } from './Onboarding'
import { TranscriptionPad } from './TranscriptionPad'

const PROGRESS_LABEL: Record<string, string> = {
  encrypted: '加密中',
  partial: '解密中',
  decrypted: '已解密',
}

function formatTime(totalSeconds: number): string {
  const whole = Math.floor(totalSeconds)
  const minutes = Math.floor(whole / 60)
  const seconds = whole % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

function codebookHref(levelKey: string): string {
  return levelKey === '1' ? '#/codebook' : `#/codebook?level=${levelKey}`
}

export function ListenerScreen({ playableLevel }: { playableLevel: PlayableLevel }) {
  const game = useGameSession(playableLevel)
  const audioRef = useRef<RadioAudio | null>(null)
  const audio = (): RadioAudio => (audioRef.current ??= new RadioAudio())
  const [showOnboard, setShowOnboard] = useState(() => !hasOnboarded())
  const href = codebookHref(playableLevel.key)
  const { start } = game

  useEffect(() => () => audioRef.current?.stop(), [])

  // Hold the stopwatch until the onboarding overlay is gone: start on mount for
  // returning players (no overlay) and on dismissal for first-run players, so
  // reading the overlay never counts into the score. Re-opening 「怎么玩？」
  // mid-run does not restart the clock (start is idempotent).
  useEffect(() => {
    if (!showOnboard) start()
  }, [showOnboard, start])

  const closeOnboard = () => {
    markOnboarded()
    setShowOnboard(false)
  }

  return (
    <div className="listener">
      {showOnboard && <Onboarding codebookHref={href} onClose={closeOnboard} />}

      <header className="listener-head">
        <div className="brand">
          <span className="brand-glyph" aria-hidden="true" />
          <div>
            <h1>密码电台 · 监听台</h1>
            <p className="brand-sub">
              {playableLevel.title} — {playableLevel.tagline}
            </p>
          </div>
        </div>
        <div className="head-right">
          <button type="button" className="howto-btn" onClick={() => setShowOnboard(true)}>
            怎么玩？
          </button>
          <div className={`stopwatch${game.won ? ' stopwatch-final' : ''}`} role="timer">
            <span className="stopwatch-time">{formatTime(game.totalSeconds)}</span>
            {game.penaltySeconds > 0 && (
              <span className="stopwatch-penalty">含 +{game.penaltySeconds}s 惩罚</span>
            )}
          </div>
        </div>
      </header>

      <nav className="level-tabs" aria-label="关卡选择">
        {PLAYABLE_LEVELS.map((entry) => (
          <a
            key={entry.key}
            className={`level-tab${entry.key === playableLevel.key ? ' level-tab-active' : ''}`}
            href={entry.key === '1' ? '#/' : `#/?level=${entry.key}`}
            aria-current={entry.key === playableLevel.key ? 'page' : undefined}
          >
            {entry.tab}
          </a>
        ))}
      </nav>

      {game.won && (
        <div className="win-banner" role="status">
          <span className="win-title">解密完成 · 胜利</span>
          <span className="win-level">{playableLevel.title}</span>
          <span className="win-time">最终用时 {formatTime(game.totalSeconds)}</span>
          {game.penaltySeconds > 0 && (
            <span className="win-detail">（含 {game.penaltySeconds}s 惩罚）</span>
          )}
          <button type="button" className="replay" onClick={game.reset}>
            再来一局
          </button>
        </div>
      )}

      <div className="segments">
        {playableLevel.segments.map((segment) => (
          <SegmentCard
            key={`${segment.id}-${game.resetToken}`}
            segment={segment}
            progress={game.segments.find((entry) => entry.id === segment.id)}
            onListen={() => void audio().playCiphered(segment.ciphered.map((s) => s.hanzi))}
            onSubmit={(guess) => {
              const result = game.submitAnswer(segment.id, guess)
              if (!result.ok && result.reason === 'wrong') audio().burst()
              return result
            }}
          />
        ))}
      </div>

      <FinalsDial key={game.resetToken} />

      <footer className="listener-foot">
        <a className="codebook-link" href={href} target="_blank" rel="noreferrer">
          译码员密码本 →
        </a>
        <span className="foot-note">把这一页交给你的搭档（译码员）或发给 AI 语音伙伴</span>
      </footer>
    </div>
  )
}

export function SegmentCard({
  segment,
  progress,
  onListen,
  onSubmit,
}: {
  segment: PlayableSegment
  progress: SegmentProgress | undefined
  onListen: () => void
  onSubmit: (guess: string) => SubmitResult
}) {
  const [guess, setGuess] = useState('')
  const [shake, setShake] = useState(false)
  const [error, setError] = useState('')
  // Synchronous single-fire lock: a fast double-click / Enter+click both reach
  // submit() before React re-renders, so a state flag can't gate them. The ref
  // is set before onSubmit runs, so the second gesture returns without charging
  // a second +30s penalty. `locked` mirrors it to disable the button visually.
  const busyRef = useRef(false)
  const [locked, setLocked] = useState(false)
  const decrypted = progress?.decrypted ?? false
  const state = progress?.progress ?? 'encrypted'
  const syllableCount = segment.ciphered.length

  const submit = () => {
    if (busyRef.current) return
    if (!guess.trim()) return
    busyRef.current = true
    const result = onSubmit(guess)
    if (result.ok) {
      setError('')
      busyRef.current = false
      return
    }
    if (result.reason === 'wrong') {
      setError('')
      setShake(true)
      setLocked(true)
      window.setTimeout(() => {
        setShake(false)
        setLocked(false)
        busyRef.current = false
      }, 420)
    } else if (result.reason === 'error') {
      setError('解密器未响应，请稍后再试。')
      busyRef.current = false
    }
  }

  return (
    <section
      className={`segment${decrypted ? ' segment-done' : ''}${shake ? ' segment-shake' : ''}`}
      aria-label={segment.label}
    >
      <div className="segment-top">
        <span className="segment-label">{segment.label}</span>
        <span className="segment-meta">{syllableCount} 个音节</span>
        <span className={`segment-status status-${state}`}>{PROGRESS_LABEL[state] ?? state}</span>
      </div>

      <button type="button" className="listen-btn" onClick={onListen}>
        <span className="listen-icon" aria-hidden="true">
          ▶
        </span>
        收听电文
      </button>

      {decrypted ? (
        <p className="segment-solved">已解密 · 电文确认</p>
      ) : (
        <>
          <TranscriptionPad label={segment.label} syllableCount={syllableCount} />
          <div className="answer-row">
            <input
              className="answer-input"
              value={guess}
              placeholder="输入解密后的汉字"
              aria-label={`${segment.label} 解密答案`}
              onChange={(event) => setGuess(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') submit()
              }}
            />
            <button type="button" className="confirm-btn" onClick={submit} disabled={locked}>
              发报确认
            </button>
          </div>
          {error && (
            <p className="answer-error" role="alert">
              {error}
            </p>
          )}
        </>
      )}
    </section>
  )
}
