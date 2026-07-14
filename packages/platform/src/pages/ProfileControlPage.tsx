import { useEffect, useState } from 'react'
import { Button, GlassCard, Modal, Toggle } from '@amiclaw/ui'
import type { ProfileClaimView } from '@shared/companion-types'
import {
  fetchProfile,
  fetchProxySocial,
  correctClaim,
  deleteClaim,
  deleteAllClaims,
  setProfileEnabled,
  setProxySocialEnabled,
} from '@/lib/companion-api'
import {
  useCompanionAccess,
  CompanionLoginGate,
  CompanionSetupGate,
} from '@/components/companion/CompanionAccess'
import CompanionPageHeader from '@/components/companion/CompanionPageHeader'
import CompanionEmptyState from '@/components/companion/CompanionEmptyState'
import ClaimCard from '@/components/companion/ClaimCard'
import styles from './ProfileControlPage.module.css'

const CORRECTION_MAX = 280

// 'setup' = signed in but no companion yet: there is no profile to control, so
// gate to companion setup rather than showing the (inert) profile switch.
type LoadStatus = 'loading' | 'setup' | 'ready' | 'error'

type ModalState =
  | { type: 'none' }
  | { type: 'correct'; claim: ProfileClaimView }
  | { type: 'delete'; claim: ProfileClaimView }
  | { type: 'deleteAll' }

/* /me/profile — the understanding-layer control panel: the four player-sovereign
   operations (view claims + evidence / correct / delete one or all / switch
   off). "不做黑箱养成" — every claim shows the memories it came from, and the
   player is always in control. Honest empty state. */
export default function ProfileControlPage() {
  const access = useCompanionAccess()
  const [status, setStatus] = useState<LoadStatus>('loading')
  const [enabled, setEnabled] = useState(true)
  const [proxyEnabled, setProxyEnabled] = useState(true)
  // The proxy-social switch has its OWN read state: a read failure must never
  // silently paint an "enabled" switch — it disables the control and shows a retry.
  const [proxyStatus, setProxyStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [claims, setClaims] = useState<ProfileClaimView[]>([])
  const [toggleBusy, setToggleBusy] = useState(false)
  const [proxyToggleBusy, setProxyToggleBusy] = useState(false)
  const [modal, setModal] = useState<ModalState>({ type: 'none' })
  const [busy, setBusy] = useState(false)
  const [actionFailed, setActionFailed] = useState(false)

  useEffect(() => {
    if (access !== 'ready') return
    let active = true
    // Profile drives the page status (companion existence); the proxy-social
    // switch is read alongside it and only applied once a companion is present.
    Promise.all([fetchProfile(), fetchProxySocial()]).then(([profileResult, proxyResult]) => {
      if (!active) return
      if (profileResult.kind === 'ok') {
        setEnabled(profileResult.profileEnabled)
        setClaims(profileResult.claims)
        setStatus('ready')
      } else if (profileResult.kind === 'none') {
        // No companion yet — there is no profile to control. Gate to setup
        // (distinct from the has-companion-but-zero-claims empty state).
        setStatus('setup')
      } else {
        setStatus('error')
      }
      // Proxy-social read state is tracked independently: 'ready' only on a
      // clean read; any failure lands 'error' so the switch renders disabled
      // with a retry rather than a misleading enabled position.
      if (proxyResult.kind === 'ok') {
        setProxyEnabled(proxyResult.proxySocialEnabled)
        setProxyStatus('ready')
      } else {
        setProxyStatus('error')
      }
    })
    return () => {
      active = false
    }
  }, [access])

  async function onToggle(next: boolean) {
    if (toggleBusy) return
    setToggleBusy(true)
    setEnabled(next) // optimistic
    const result = await setProfileEnabled(next)
    if (result.kind !== 'ok') setEnabled(!next) // revert on failure
    setToggleBusy(false)
  }

  async function onProxyToggle(next: boolean) {
    if (proxyToggleBusy) return
    setProxyToggleBusy(true)
    setProxyEnabled(next) // optimistic
    const result = await setProxySocialEnabled(next)
    if (result.kind !== 'ok') setProxyEnabled(!next) // revert on failure
    setProxyToggleBusy(false)
  }

  // Retry handler for the proxy-social read (event-driven → the synchronous
  // setState here is intentional and outside any effect body).
  async function retryProxySocial() {
    setProxyStatus('loading')
    const result = await fetchProxySocial()
    if (result.kind === 'ok') {
      setProxyEnabled(result.proxySocialEnabled)
      setProxyStatus('ready')
    } else {
      setProxyStatus('error')
    }
  }

  function closeModal() {
    if (busy) return
    setModal({ type: 'none' })
    setActionFailed(false)
  }

  function applyCorrection(correctedId: string, newClaim: ProfileClaimView) {
    // The original turns 'corrected' (drops out of the active list); the
    // correction takes its place as the new active claim.
    setClaims((prev) => prev.map((c) => (c.id === correctedId ? newClaim : c)))
    setModal({ type: 'none' })
  }

  async function confirmDeleteClaim() {
    if (modal.type !== 'delete') return
    setBusy(true)
    setActionFailed(false)
    const result = await deleteClaim(modal.claim.id)
    setBusy(false)
    if (result.kind === 'ok') {
      setClaims((prev) => prev.filter((c) => c.id !== modal.claim.id))
      setModal({ type: 'none' })
    } else {
      setActionFailed(true)
    }
  }

  async function confirmDeleteAll() {
    setBusy(true)
    setActionFailed(false)
    const result = await deleteAllClaims()
    setBusy(false)
    if (result.kind === 'ok') {
      setClaims([])
      setModal({ type: 'none' })
    } else {
      setActionFailed(true)
    }
  }

  return (
    <div className={styles.page}>
      <CompanionPageHeader
        eyebrow="画像 · PROFILE"
        title="画像控制面"
        lead="伙伴对你的每条理解，都能回溯到真实发生过的一局。这里随时由你查看、纠正、删除或关闭。"
      />

      {access === 'loading' ? null : access === 'gate' ? (
        <CompanionLoginGate />
      ) : status === 'loading' ? null : status === 'setup' ? (
        <CompanionSetupGate text="画像是伙伴在相处中对你的理解。先认识你的伙伴，才有画像可以查看和管理。" />
      ) : status === 'error' ? (
        <GlassCard radius="2xl" className={styles.note}>
          <p className={styles.noteText}>画像暂时读不出来，稍后再试。</p>
        </GlassCard>
      ) : (
        <>
          <GlassCard radius="2xl" className={styles.switchCard}>
            <div className={styles.switchText}>
              <span className={styles.switchTitle}>记住对我的理解</span>
              <span className={styles.switchSub}>
                关闭后，伙伴不再固化新的理解，已有的理解也会暂停被用到对话里——你的回忆不受影响。
              </span>
            </div>
            <Toggle checked={enabled} onChange={onToggle} disabled={toggleBusy} label="画像开关" />
          </GlassCard>

          {!enabled && (
            <p className={styles.disabledBanner} role="status">
              画像已关闭。下面的理解暂停生效，但仍由你保管。
            </p>
          )}

          <GlassCard radius="2xl" className={styles.switchCard}>
            <div className={styles.switchText}>
              <span className={styles.switchTitle}>让伙伴替我在社区留言</span>
              <span className={styles.switchSub}>
                关闭后，伙伴不再替你到别人的社区动态下留新的话；已经发出的留言不受影响，仍然保留。
              </span>
              {proxyStatus === 'error' && (
                <span className={styles.switchError} role="alert">
                  开关状态暂时读不出来。
                  <button type="button" className={styles.switchRetry} onClick={retryProxySocial}>
                    重试
                  </button>
                </span>
              )}
            </div>
            <Toggle
              checked={proxyEnabled}
              onChange={onProxyToggle}
              disabled={proxyToggleBusy || proxyStatus !== 'ready'}
              label="代言社交开关"
            />
          </GlassCard>

          {claims.length === 0 ? (
            <CompanionEmptyState
              title="还没有形成任何理解"
              text="多和伙伴拆几局，它会慢慢读懂你的节奏与习惯——每条理解都会附上来由。"
              ctaLabel="开始玩"
              ctaHref="/bombsquad/"
            />
          ) : (
            <>
              <div className={styles.list}>
                {claims.map((claim) => (
                  <ClaimCard
                    key={claim.id}
                    claim={claim}
                    onCorrect={(c) => setModal({ type: 'correct', claim: c })}
                    onDelete={(c) => setModal({ type: 'delete', claim: c })}
                  />
                ))}
              </div>
              <div className={styles.deleteAll}>
                <button
                  type="button"
                  className={styles.deleteAllBtn}
                  onClick={() => setModal({ type: 'deleteAll' })}
                >
                  清空全部画像
                </button>
              </div>
            </>
          )}
        </>
      )}

      {/* Correction */}
      {modal.type === 'correct' && (
        <CorrectionDialog claim={modal.claim} onClose={closeModal} onCorrected={applyCorrection} />
      )}

      {/* Single delete */}
      <Modal open={modal.type === 'delete'} onClose={closeModal} title="删除这条理解？">
        <p className={styles.modalText}>
          删除后这条理解会被永久移除。你的回忆不受影响，这一步无法撤销。
        </p>
        {actionFailed && (
          <p className={styles.modalError} role="alert">
            删除失败，请稍后重试。
          </p>
        )}
        <div className={styles.modalActions}>
          <Button variant="ghost" onClick={closeModal} disabled={busy}>
            取消
          </Button>
          <button
            type="button"
            className={styles.danger}
            onClick={confirmDeleteClaim}
            disabled={busy}
          >
            {busy ? '删除中…' : '删除'}
          </button>
        </div>
      </Modal>

      {/* Delete all */}
      <Modal open={modal.type === 'deleteAll'} onClose={closeModal} title="清空全部画像？">
        <p className={styles.modalText}>
          这会删除伙伴对你的所有理解，并停止从已有回忆里重新得出它们。你的回忆本身会保留。这一步无法撤销。
        </p>
        {actionFailed && (
          <p className={styles.modalError} role="alert">
            操作失败，请稍后重试。
          </p>
        )}
        <div className={styles.modalActions}>
          <Button variant="ghost" onClick={closeModal} disabled={busy}>
            取消
          </Button>
          <button
            type="button"
            className={styles.danger}
            onClick={confirmDeleteAll}
            disabled={busy}
          >
            {busy ? '清空中…' : '清空全部'}
          </button>
        </div>
      </Modal>
    </div>
  )
}

/* Correction dialog — the player re-words one understanding. On success the
   original turns 'corrected' (history) and the correction becomes a new active
   claim inheriting the same evidence. Owns its own text / busy / error state. */
function CorrectionDialog({
  claim,
  onClose,
  onCorrected,
}: {
  claim: ProfileClaimView
  onClose: () => void
  onCorrected: (correctedId: string, newClaim: ProfileClaimView) => void
}) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const trimmed = text.trim()

  async function submit() {
    if (trimmed.length === 0 || busy) return
    setBusy(true)
    setError('')
    const result = await correctClaim(claim, trimmed)
    setBusy(false)
    if (result.kind === 'ok') {
      onCorrected(result.correctedClaimId, result.newClaim)
    } else if (result.kind === 'invalid') {
      setError(result.error ?? '内容不符合要求，请调整后重试。')
    } else {
      setError('提交失败，请稍后重试。')
    }
  }

  return (
    <Modal open onClose={busy ? () => {} : onClose} title="纠正这条理解">
      <p className={styles.correctLabel}>原来的理解</p>
      <p className={styles.correctOriginal}>{claim.claim}</p>
      <label className={styles.correctLabel} htmlFor="claim-correction">
        改成
      </label>
      <textarea
        id="claim-correction"
        className={styles.textarea}
        maxLength={CORRECTION_MAX}
        rows={3}
        placeholder="用你自己的话，说说更准确的理解。"
        value={text}
        onChange={(e) => setText(e.target.value)}
        disabled={busy}
      />
      {error && (
        <p className={styles.modalError} role="alert">
          {error}
        </p>
      )}
      <div className={styles.modalActions}>
        <Button variant="ghost" onClick={onClose} disabled={busy}>
          取消
        </Button>
        <Button variant="primary" onClick={submit} disabled={busy || trimmed.length === 0}>
          {busy ? '保存中…' : '保存'}
        </Button>
      </div>
    </Modal>
  )
}
