import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { Button, ConicAvatar, GlassCard } from '@amiclaw/ui'
import type { PlatformVoiceId } from '@shared/companion-types'
import type { CompanionIdentity } from '@shared/companion-types'
import { useCompanion } from '@/hooks/useCompanion'
import { setupCompanion } from '@/lib/companion-api'
import { voiceName } from '@/lib/companion-voices'
import { useCompanionAccess, CompanionLoginGate } from '@/components/companion/CompanionAccess'
import CompanionPageHeader from '@/components/companion/CompanionPageHeader'
import VoicePicker from '@/components/companion/VoicePicker'
import styles from './CompanionOnboardingPage.module.css'

const NAME_MAX = 30
const ADDRESS_STYLE_MAX = 30

/* /me/companion — "认识你的伙伴". A signed-in player with no companion names it
   and picks one of three platform voices; on success the identity is read back
   (GET /api/companion) and shown as "你的伙伴 X". A player who already has a
   companion skips the form and sees their identity (one companion per account,
   continuity over everything). */
export default function CompanionOnboardingPage() {
  const access = useCompanionAccess()
  const { state, reload } = useCompanion(access === 'ready')

  // Once the companion exists, the header must stop inviting a first-time setup
  // (「给它取个名字」) — that copy contradicted the identity panel shown right
  // below it after creation (audit F20). It switches to a present-tense line.
  const hasCompanion = access === 'ready' && state.status === 'exists'

  return (
    <div className={styles.page}>
      <CompanionPageHeader
        eyebrow="伙伴 · COMPANION"
        title={hasCompanion ? '你的伙伴' : '认识你的伙伴'}
        lead={
          hasCompanion
            ? '它已经在这了。你们一起玩得越多，它越懂你。'
            : '给它取个名字，挑一种声音。它的性格不预设，由你们一起的回忆慢慢长成。'
        }
      />

      {access === 'loading' ? null : access === 'gate' ? (
        <CompanionLoginGate />
      ) : state.status === 'loading' ? null : state.status === 'exists' ? (
        <CompanionIdentityPanel companion={state.companion} />
      ) : state.status === 'error' ? (
        <GlassCard radius="2xl" className={styles.note}>
          <p className={styles.noteText}>暂时读不出伙伴信息，稍后再试。</p>
        </GlassCard>
      ) : (
        // status === 'none' — first-time setup.
        <SetupForm onSettled={reload} />
      )}
    </div>
  )
}

/* The already-created identity — no rename / re-voice control (setup is
   one-time). Links forward into the album + profile surfaces. */
function CompanionIdentityPanel({ companion }: { companion: CompanionIdentity }) {
  return (
    <GlassCard radius="2xl" className={styles.identityCard}>
      <div className={styles.identityHead}>
        <ConicAvatar size={72} letter={companion.name.charAt(0)} ariaHidden />
        <div>
          <div className={styles.identityName}>
            你的伙伴 <span className={styles.accent}>{companion.name}</span>
          </div>
          <div className={styles.identityVoice}>{voiceName(companion.voice_id)}</div>
          {companion.address_style ? (
            <div className={styles.identityAddress}>它叫你「{companion.address_style}」</div>
          ) : null}
        </div>
      </div>
      <p className={styles.identityNote}>一人一伙伴。它会记得你们一起拆过的每一局。</p>
      <div className={styles.identityLinks}>
        <Link to="/me/memories" className={styles.identityLink}>
          回忆相册
        </Link>
        <Link to="/me/profile" className={styles.identityLink}>
          画像控制面
        </Link>
      </div>
    </GlassCard>
  )
}

type Phase = 'idle' | 'submitting' | 'error'

function SetupForm({ onSettled }: { onSettled: () => void }) {
  const [name, setName] = useState('')
  const [addressStyle, setAddressStyle] = useState('')
  const [voiceId, setVoiceId] = useState<PlatformVoiceId | null>(null)
  const [phase, setPhase] = useState<Phase>('idle')
  const [error, setError] = useState('')

  const trimmedName = name.trim()
  const canSubmit = trimmedName.length > 0 && voiceId !== null && phase !== 'submitting'

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (voiceId === null || trimmedName.length === 0 || phase === 'submitting') return
    setPhase('submitting')
    setError('')

    const result = await setupCompanion({
      name: trimmedName,
      voice_id: voiceId,
      ...(addressStyle.trim() ? { address_style: addressStyle.trim() } : {}),
    })

    // Created → read the identity back. Conflict (already has one) is handled
    // gracefully: re-read shows the existing companion rather than an error.
    if (result.kind === 'created' || result.kind === 'conflict') {
      onSettled()
      return
    }
    if (result.kind === 'invalid') {
      setPhase('error')
      setError(result.error ?? '名字或音色不符合要求，请调整后重试。')
      return
    }
    setPhase('error')
    setError('创建失败，请检查网络后重试。')
  }

  return (
    <GlassCard radius="2xl" className={styles.formCard}>
      <form className={styles.form} onSubmit={onSubmit}>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="companion-name">
            名字
          </label>
          <input
            id="companion-name"
            className={styles.input}
            type="text"
            maxLength={NAME_MAX}
            required
            placeholder="给它取个名字"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={phase === 'submitting'}
          />
        </div>

        <div className={styles.field}>
          <label className={styles.label} htmlFor="companion-address">
            它怎么称呼你<span className={styles.optional}>（可选）</span>
          </label>
          <input
            id="companion-address"
            className={styles.input}
            type="text"
            maxLength={ADDRESS_STYLE_MAX}
            placeholder="队长 / 你的名字 / 随它"
            value={addressStyle}
            onChange={(e) => setAddressStyle(e.target.value)}
            disabled={phase === 'submitting'}
          />
        </div>

        <div className={styles.field}>
          <span className={styles.label}>声音</span>
          <VoicePicker value={voiceId} onChange={setVoiceId} />
        </div>

        {phase === 'error' && (
          <p className={styles.errorText} role="alert">
            {error}
          </p>
        )}

        <Button type="submit" variant="primary" disabled={!canSubmit}>
          {phase === 'submitting' ? '创建中…' : '认识你的伙伴'}
        </Button>
      </form>
    </GlassCard>
  )
}
