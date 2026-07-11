/**
 * The playing screen — orchestrates the GameStore, the AudioEngine, and the
 * presentational components. Owns only transient view state (selected chip,
 * playhead step, transport on/off); all game truth lives in the store.
 *
 * Two partner tiers (PR-2 §3), resolved by voice eligibility BEFORE the store is
 * built (the partner driver is fixed at construction):
 *   - mode② (signed-in + named companion): the platform co_build voice session
 *     (`SoundGardenPartnerChannel`) drives the partner via `applyPartnerActions`.
 *   - anon (everyone else, incl. the standalone dev build with no Worker): the
 *     offline scripted partner + browser voice.
 */

import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import type { PieceType } from '../game/constants'
import { GameStore } from '../game/store'
import type { Archetype, LevelConfig, Side } from '../game/types'
import { AudioEngine } from '../audio/engine'
import { ScriptedPartnerBrain } from '../partner/brain'
import { createVoice } from '../voice/voice-io'
import { useSoundGardenVoiceEligibility } from '../voice/sound-garden-voice-eligibility'
import { buildSoundGardenManualData } from '../voice/sound-garden-manual'
import SoundGardenPartnerChannel from '../voice/SoundGardenPartnerChannel'
import { Garden } from './Garden'
import { Palette } from './Palette'
import { PartnerChat } from './PartnerChat'
import { Transport } from './Transport'
import SoundGardenResults from './SoundGardenResults'

interface GameScreenProps {
  level: LevelConfig
  side: Side
  hasNext: boolean
  onExit: () => void
  onReplay: () => void
  onNext: () => void
}

/** The platform voice gameId (companion partner) in production. */
const VOICE_GAME_ID = 'sound-garden'

/**
 * Outer gate: resolve companion voice eligibility, then mount the run in the right
 * partner tier. The standalone dev build has no platform Worker, so the eligibility
 * fetch fails → `unavailable` → the anon scripted tier (no dev-only branch needed).
 */
export function GameScreen(props: GameScreenProps) {
  const eligibility = useSoundGardenVoiceEligibility(true)

  if (eligibility.status === 'checking') {
    return (
      <main className="sg-app sg-checking">
        <p className="sg-checking-text" role="status">
          正在确认你的 AI 伙伴…
        </p>
      </main>
    )
  }

  const platform = eligibility.status === 'eligible'
  return <GameScreenInner key={platform ? 'platform' : 'anon'} {...props} platform={platform} />
}

function GameScreenInner(props: GameScreenProps & { platform: boolean }) {
  const [store] = useState(() => {
    if (props.platform) {
      // mode②: no internal scripted brain / bus turn; the platform session drives.
      return new GameStore(props.level, props.side, { partnerMode: 'platform' })
    }
    const partnerArchetype: Archetype = props.side === 'melody' ? 'rhythm_piece' : 'melody_piece'
    const brain = new ScriptedPartnerBrain(props.level.matrix, partnerArchetype)
    const voice = createVoice()
    return new GameStore(props.level, props.side, { brain, voice })
  })
  const [audio] = useState(() => new AudioEngine())
  const manualData = useMemo(() => buildSoundGardenManualData(props.level), [props.level])

  const state = useSyncExternalStore(store.subscribe, store.getSnapshot)
  const [selected, setSelected] = useState<PieceType | null>(null)
  const [activeStep, setActiveStep] = useState(-1)
  const [playing, setPlaying] = useState(false)
  const [audioBlocked, setAudioBlocked] = useState(false)
  const [listening, setListening] = useState(false)
  // Settlement overlay is dismissible: shown on the first bloom, then closed for
  // good this run (the `settled` latch stays true, so it never auto-reopens). The
  // dismiss state is per-run, reset by the keyed remount on replay / next level.
  const [resultsDismissed, setResultsDismissed] = useState(false)

  useEffect(() => {
    return () => {
      audio.dispose()
      store.dispose()
    }
  }, [audio, store])

  const petals = useMemo(() => buildPetals(), [])

  function afterGesture() {
    if (audio.unavailable) setAudioBlocked(true)
  }

  function handleSelect(type: PieceType) {
    setSelected((prev) => (prev === type ? null : type))
    audio.preview(type)
    afterGesture()
  }

  function handlePreview(type: PieceType) {
    audio.preview(type)
    afterGesture()
  }

  function handleSlotTap(slot: number) {
    const owned =
      state.playerArchetype === 'melody_piece' ? state.melody[slot - 1] : state.rhythm[slot - 1]
    if (selected) {
      store.plantPlayer(selected, slot)
      audio.preview(selected)
      setSelected(null)
    } else if (owned) {
      store.removePlayer(slot)
    }
    afterGesture()
  }

  function handleTogglePlay() {
    if (playing) {
      audio.stop()
      setPlaying(false)
      setActiveStep(-1)
      return
    }
    audio.start({
      getStep: (step) => {
        const s = store.getSnapshot()
        return { rhythm: s.rhythm[step], melody: s.melody[step] }
      },
      onStep: (step) => setActiveStep(step),
    })
    setPlaying(true)
    afterGesture()
  }

  async function handleMic() {
    if (listening) {
      store.stopListening()
      return
    }
    setListening(true)
    try {
      const text = await store.captureUtterance()
      if (text) store.submitUtterance(text)
    } finally {
      setListening(false)
    }
  }

  return (
    <main className="sg-app">
      <header className="sg-header">
        <button type="button" className="sg-icon-btn" aria-label="返回选关" onClick={props.onExit}>
          ‹
        </button>
        <div className="sg-titlewrap">
          <div className="sg-title">
            第 {state.levelIndex} 关 · {state.levelName}
          </div>
          <div className="sg-subtitle">{state.levelSubtitle}</div>
        </div>
        <button
          type="button"
          className="sg-icon-btn"
          aria-label="重来本关"
          onClick={props.onReplay}
        >
          ↻
        </button>
      </header>

      <div className="sg-gardenwrap">
        <div className="sg-lanetags">
          <span>🌼 旋律花{state.playerArchetype === 'melody_piece' ? '（你）' : '（伙伴）'}</span>
          <span>{state.playerArchetype === 'rhythm_piece' ? '（你）' : '（伙伴）'}节奏根 🌱</span>
        </div>
        <Garden
          slots={state.slots}
          melody={state.melody}
          rhythm={state.rhythm}
          relations={state.relations}
          activeStep={activeStep}
          playerArchetype={state.playerArchetype}
          onSlotTap={handleSlotTap}
          onPartnerHint={() => undefined}
        />
        {state.toast && (
          <div className={`sg-toast tone-${state.toast.tone}`} key={state.toast.seq}>
            {state.toast.text}
          </div>
        )}
        <div className={`sg-bloomlayer ${state.bloomed ? 'on' : ''}`} aria-hidden="true">
          {petals.map((p, i) => (
            <span
              className="sg-petal"
              key={i}
              style={{ left: p.left, animationDuration: p.dur, animationDelay: p.delay }}
            >
              {p.emoji}
            </span>
          ))}
        </div>
      </div>

      <p className="sg-guide">
        点一株{state.playerArchetype === 'melody_piece' ? '旋律花' : '节奏根'}
        选中，再点上方空土种下；点 🔊 试听
      </p>
      <Palette
        palette={state.palette}
        selected={selected}
        onSelect={handleSelect}
        onPreview={handlePreview}
      />

      <Transport
        playing={playing}
        score={state.score}
        target={state.target}
        bloomed={state.bloomed}
        onTogglePlay={handleTogglePlay}
      />

      {props.platform ? (
        <SoundGardenPartnerChannel store={store} gameId={VOICE_GAME_ID} manualData={manualData} />
      ) : (
        <>
          {store.micAvailable && (
            <div className="sg-voicebar">
              <button
                type="button"
                className={`sg-mic ${listening ? 'listening' : ''}`}
                aria-label={listening ? '停止说话' : '按住说话'}
                onClick={handleMic}
              >
                {listening ? '🎙 聆听中…（点此结束）' : '🎤 对伙伴说话'}
              </button>
            </div>
          )}
          <PartnerChat chat={state.chat} offline />
        </>
      )}

      <SoundGardenResults
        open={state.settled && !resultsDismissed}
        score={state.score}
        target={state.target}
        hasNext={props.hasNext}
        onReplay={props.onReplay}
        onNext={props.onNext}
        onExit={props.onExit}
        onDismiss={() => setResultsDismissed(true)}
      />

      {audioBlocked && (
        <div className="sg-audionotice">
          此环境音频被禁用——请在本机浏览器打开听声。视觉与玩法仍可正常体验。
        </div>
      )}
    </main>
  )
}

function buildPetals() {
  const emojis = ['🌸', '🌼', '✨', '🌷', '💮']
  return Array.from({ length: 14 }, (_, i) => ({
    emoji: emojis[i % emojis.length],
    left: `${Math.round(Math.random() * 92)}%`,
    dur: `${(3 + Math.random() * 3).toFixed(2)}s`,
    delay: `${(Math.random() * 3).toFixed(2)}s`,
  }))
}
