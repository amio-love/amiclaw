import { Link } from 'react-router-dom'
import type { GameVoiceManualData, GameVoiceState } from '@shared/voice/use-game-voice-session'
import { useBotanicalVoiceEligibility } from './voice-eligibility'
import VoicePanel from './VoicePanel'
import styles from './BotanistChannel.module.css'

interface BotanistChannelProps {
  manualData: GameVoiceManualData | null
  gameState: GameVoiceState
  /** Effective voice gameId — `'botanical-garden'` (companion) or `'demo-mock'` (dev). */
  gameId: string
  /** react-router path to the manual page for the anonymous solo path. */
  manualTo: string
}

const REASON_COPY: Record<'anonymous' | 'no-companion' | 'unavailable', string> = {
  anonymous: '登录并领取你的 AI 伙伴后，就能让它当你的植物学家。现在可以先打开养护手册自助照料。',
  'no-companion': '领取一个 AI 伙伴后，就能让它当你的植物学家。现在可以先打开养护手册自助照料。',
  unavailable: '暂时无法确认语音资格。可以先打开养护手册自助照料。',
}

/**
 * Gates the botanist channel on companion eligibility (§3): a signed-in player
 * with a named account companion gets that companion as the botanist (VoicePanel);
 * everyone else gets the solo manual path (the sanctioned anonymous / BYO-AI
 * surface). A dev/demo session (gameId `'demo-mock'`) skips the gate entirely.
 */
export default function BotanistChannel({
  manualData,
  gameState,
  gameId,
  manualTo,
}: BotanistChannelProps) {
  const requiresCompanion = gameId === 'botanical-garden'
  const eligibility = useBotanicalVoiceEligibility(requiresCompanion)

  if (!requiresCompanion || eligibility.status === 'eligible') {
    return <VoicePanel manualData={manualData} gameState={gameState} gameId={gameId} />
  }

  if (eligibility.status === 'checking') {
    return (
      <section className={styles.card} aria-label="AI 植物学家">
        <p className={styles.checking} role="status">
          正在确认你的 AI 伙伴…
        </p>
      </section>
    )
  }

  // Anonymous / no-companion / unavailable → the solo manual path (BYO-AI).
  return (
    <section className={styles.card} aria-label="AI 植物学家">
      <p className={styles.reason}>{REASON_COPY[eligibility.reason]}</p>
      <Link className={styles.manualLink} to={manualTo}>
        打开养护手册
      </Link>
      <p className={styles.byoNote}>手册也可以复制给你自己的 AI 当参谋（自助模式）。</p>
    </section>
  )
}
