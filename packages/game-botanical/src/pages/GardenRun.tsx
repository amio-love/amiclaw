import { useEffect, useMemo, useState } from 'react'
import type { Level } from '@amiclaw/creation'
import type { GameVoiceState } from '@shared/voice/use-game-voice-session'
import styles from './GamePage.module.css'
import { botanicalGameType } from '@/data/load'
import { useGardenSession, type CareOutcome } from '@/game/useGardenSession'
import { useDecayLoop } from '@/hooks/useDecayLoop'
import {
  GROWTH_LABEL,
  HEALTH_LABEL,
  LIGHT_LABEL,
  ZONE_LABEL,
  speciesLabel,
} from '@/game/visual-map'
import Stopwatch from '@/components/Stopwatch'
import GardenGrid from '@/components/GardenGrid'
import VerbCards from '@/components/VerbCards'
import ResultsOverlay from '@/components/ResultsOverlay'
import BotanistChannel from '@/voice/BotanistChannel'
import { buildBotanicalManualData } from '@/voice/manual-data'
import { buildBotanicalVoiceState } from '@/voice/botanical-voice-context'

const GOAL_TEXT = '目标 · 所有存活植株≥稳定，且至少一株开花'

interface GardenRunProps {
  level: Level
  /** Platform game id for the voice botanist. Defaults to the mock probe path. */
  gameId?: string
  /**
   * Controlled-clock test seam (e2e only). When true, the wall-clock decay loop
   * is turned OFF and `window.__botanicalAdvance(dtMs)` is exposed so a test can
   * drive decay deterministically (no real-time waits). GamePage only sets this
   * when `import.meta.env.DEV && ?e2e=1`, so it is compiled OUT of the production
   * build (DEV is false there) — production behaviour is provably unaffected.
   */
  e2e?: boolean
}

/**
 * One playable botanical run over a single level. Owns the engine session, the
 * decay clock, and (opt-in) the AI botanist voice channel. Remounted per level
 * (keyed on level id by the GamePage shell), so switching levels is a clean reset.
 */
export function GardenRun({ level, gameId, e2e = false }: GardenRunProps) {
  const session = useGardenSession(botanicalGameType, level)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [toast, setToast] = useState<CareOutcome | null>(null)
  const [voiceOpen, setVoiceOpen] = useState(false)

  // The single wall-clock: advance simulated time while the run is live. In the
  // e2e seam the loop is OFF so ONLY the test's explicit advance drives decay.
  useDecayLoop(session.advance, session.status === 'playing' && !e2e)

  // Controlled-clock seam: expose advance to the e2e driver (dev + ?e2e=1 only).
  // The body sits inside `if (import.meta.env.DEV)` so the whole seam — the
  // `window.__botanicalAdvance` write included — is DEAD-CODE-ELIMINATED from the
  // production bundle (Vite replaces DEV with `false`); it cannot exist in prod.
  useEffect(() => {
    if (!e2e) return
    if (import.meta.env.DEV) {
      const w = window as unknown as { __botanicalAdvance?: (dtMs: number) => void }
      w.__botanicalAdvance = session.advance
      return () => {
        delete w.__botanicalAdvance
      }
    }
  }, [e2e, session.advance])

  const selectedPlant = session.plants.find((p) => p.id === selectedId) ?? null
  const selectedZone = selectedPlant
    ? session.zones.find((z) => z.positions.includes(selectedPlant.potPosition))
    : undefined

  // --- AI botanist wiring: manual + live section steering ---
  const manualData = useMemo(() => buildBotanicalManualData(botanicalGameType, level), [level])
  const availableSectionIds = useMemo(() => Object.keys(manualData.sections), [manualData])
  // The relevant-section selection only changes when a plant's health or the
  // focus changes (NOT per decay frame — decayFraction is not an input), so the
  // joined key is stable across frames. Memoize gameState on that key so the
  // memoized VoicePanel (and its live session) re-render / steer only on a real
  // change; the key round-trips through split(',') since section ids carry no comma.
  const sectionsKey = buildBotanicalVoiceState({
    plants: session.plants.map((p) => ({ id: p.id, species: p.species, health: p.health })),
    focusedId: selectedId,
    availableSectionIds,
  }).relevantSections.join(',')
  const gameState = useMemo<GameVoiceState>(
    () => ({ relevantSections: sectionsKey === '' ? [] : sectionsKey.split(',') }),
    [sectionsKey]
  )
  // The account companion is the botanist in production (`botanical-garden`); a
  // local dev / demo session uses the credential-free `demo-mock` mock provider.
  const voiceGameId = gameId ?? (import.meta.env.DEV ? 'demo-mock' : 'botanical-garden')
  const manualTo = `/manual?level=${level.metadata.id}`

  const handleSelect = (elementId: string) => {
    setSelectedId(elementId)
    setToast(null)
  }

  const handleVerb = (actionType: string) => {
    if (selectedPlant === null) {
      setToast({ ok: false, tone: 'neutral', message: '请先选择一株植株' })
      return
    }
    setToast(session.performCare(selectedPlant.id, actionType))
  }

  const handleReplay = () => {
    session.reset()
    setSelectedId(null)
    setToast(null)
  }

  return (
    <main className={styles.page}>
      <header className={styles.hud}>
        <Stopwatch elapsedMs={session.elapsedMs} running={session.status === 'playing'} />
        <p className={styles.goal}>{GOAL_TEXT}</p>
      </header>

      <GardenGrid
        plants={session.plants}
        zones={session.zones}
        selectedId={selectedId}
        onSelect={handleSelect}
      />

      <p className={styles.selInfo}>
        {selectedPlant === null ? (
          '选择一株植株，再点下方养护动作。'
        ) : (
          <>
            已选 <b>{speciesLabel(selectedPlant.species)}</b>
            {selectedZone
              ? `（${ZONE_LABEL[selectedZone.zoneId] ?? selectedZone.zoneId}）`
              : ''} · {HEALTH_LABEL[selectedPlant.health]} ·{' '}
            {GROWTH_LABEL[selectedPlant.growthStage]} · 实际光照
            {LIGHT_LABEL[selectedPlant.effectiveLight]}
          </>
        )}
      </p>

      <VerbCards disabled={session.status !== 'playing'} onVerb={handleVerb} />

      <p
        className={`${styles.toast} ${toast ? styles[toast.tone] : ''}`}
        role="status"
        aria-live="polite"
      >
        {toast?.message ?? ' '}
      </p>

      <div className={styles.voice}>
        <button
          type="button"
          className={styles.voiceToggle}
          aria-pressed={voiceOpen}
          onClick={() => setVoiceOpen((open) => !open)}
        >
          {voiceOpen ? '关闭语音' : '呼叫植物学家'}
        </button>
        {voiceOpen && (
          <BotanistChannel
            manualData={manualData}
            gameState={gameState}
            gameId={voiceGameId}
            manualTo={manualTo}
          />
        )}
      </div>

      <ResultsOverlay
        status={session.status}
        elapsedMs={session.elapsedMs}
        ops={session.ops}
        plants={session.plants}
        onReplay={handleReplay}
      />
    </main>
  )
}
