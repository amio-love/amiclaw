import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Button, ConicAvatar, EyebrowTag, GlassCard } from '@amiclaw/ui'
import type { ArcadeLocalProfile, ArcadeProfileSummary } from '@amiclaw/arcade-profile/types'
import {
  ensureArcadeLocalProfile,
  getClaimableArcadeProfileEvents,
  markArcadeProfileEventsClaimed,
  summarizeArcadeLocalProfile,
} from '@amiclaw/arcade-profile/local'
import { claimArcadeProfile, fetchArcadeProfile } from '@amiclaw/arcade-profile/api-client'
import { formatMs } from '@shared/format-time'
import { toChineseDateString } from '@shared/date'
import { useAuth, type DisplayUser } from '@/hooks/useAuth'
import CompanionCard from '@/components/companion/CompanionCard'
import { companionSeedEnabled } from '@/lib/companion-seed'
import styles from './AccountPage.module.css'

/* Account page — handoff §6.11. Reads identity from useAuth():
     - loading → hold the page chrome only (no profile, no guide) so neither
       state flashes before the session resolves.
     - signed-in → the real-identity profile with an honest empty stats state.
     - anonymous → a login-guide empty state routing to /login.

   Platform chrome — every accent is brand yellow; no BombSquad cyan here. */
export default function AccountPage() {
  const { status, user, logout } = useAuth()
  const [localProfile, setLocalProfile] = useState<ArcadeLocalProfile | null>(() =>
    ensureArcadeLocalProfile()
  )
  const localSummary = useMemo(() => summarizeArcadeLocalProfile(localProfile), [localProfile])
  const claimableEvents = useMemo(
    () => getClaimableArcadeProfileEvents(localProfile),
    [localProfile]
  )
  // The dev seed lets a Cloudflare preview feel the companion surfaces without a
  // live session; treat it as enough to show the companion entry here too.
  const seeded = companionSeedEnabled()

  return (
    <div className={styles.page}>
      <EyebrowTag variant="section">我的 · ACCOUNT</EyebrowTag>
      {status === 'loading' && !seeded ? null : status === 'authed' && user ? (
        <SignedInProfile
          key={user.email}
          user={user}
          onLogout={logout}
          localProfile={localProfile}
          localSummary={localSummary}
          claimableEvents={claimableEvents}
          onLocalProfileChange={setLocalProfile}
        />
      ) : seeded ? (
        <SeededCompanionPreview />
      ) : (
        <SignedOutGuide localSummary={localSummary} />
      )}
    </div>
  )
}

type AccountProfileState =
  | { status: 'idle'; profile: null }
  | { status: 'loading'; profile: null }
  | { status: 'ok'; profile: ArcadeProfileSummary }
  | { status: 'error'; profile: null }

function useAccountArcadeProfile(): {
  state: AccountProfileState
  reload: () => void
} {
  const [state, setState] = useState<AccountProfileState>({ status: 'loading', profile: null })
  const [nonce, setNonce] = useState(0)
  const reload = useCallback(() => setNonce((n) => n + 1), [])

  useEffect(() => {
    let active = true
    fetchArcadeProfile().then((result) => {
      if (!active) return
      if (result.kind === 'ok') {
        setState({ status: 'ok', profile: result.profile })
      } else {
        setState({ status: 'error', profile: null })
      }
    })
    return () => {
      active = false
    }
  }, [nonce])

  return { state, reload }
}

/* Dev-seed preview (anonymous + ?companionSeed=1): no real identity, but the
   companion entry is shown so a Cloudflare preview can reach the album /
   profile surfaces. Inert for real users (the seed param is off). */
function SeededCompanionPreview() {
  return (
    <>
      <h2 className={styles.title}>你的星轨。</h2>
      <p className={styles.lead}>预览模式：这里展示的是示例伙伴与回忆。</p>
      <div className={styles.detail}>
        <CompanionCard />
      </div>
    </>
  )
}

/* The signed-in profile — identity is the real session's derived display name.

   Per-user stats (recent runs / badges / rank / streak) are NOT shown: real
   per-user stats need the leaderboard user_id migration (not yet built), and
   showing mock numbers to a real logged-in user would re-introduce the exact
   fake-data problem PR #133 fixed for the signed-out state. So the detail
   column is an honest empty state — "还没有成绩，去玩一局" with a play CTA —
   not mock numbers and not a「即将推出」placeholder. */
function SignedInProfile({
  user,
  onLogout,
  localProfile,
  localSummary,
  claimableEvents,
  onLocalProfileChange,
}: {
  user: DisplayUser
  onLogout: () => void
  localProfile: ArcadeLocalProfile | null
  localSummary: ArcadeProfileSummary
  claimableEvents: ReturnType<typeof getClaimableArcadeProfileEvents>
  onLocalProfileChange: (profile: ArcadeLocalProfile | null) => void
}) {
  const { state: accountProfile, reload: reloadAccountProfile } = useAccountArcadeProfile()

  return (
    <>
      <h2 className={styles.title}>
        <span className={styles.accent}>{user.displayName}</span> 的星轨。
      </h2>
      <p className={styles.lead}>这里显示这个账号已经保存的真实记录。</p>

      <div className={styles.grid}>
        <GlassCard radius="2xl" className={styles.profile}>
          <div className={styles.avatar}>
            <ConicAvatar size={96} letter={user.avatarLetter} ariaHidden />
          </div>
          <div className={styles.name}>{user.displayName}</div>
          <div className={styles.rank}>{user.email}</div>
          <Button variant="ghost" size="sm" className={styles.logout} onClick={onLogout}>
            退出登录
          </Button>
        </GlassCard>

        <div className={styles.detail}>
          <section className={styles.section}>
            <h3 className={styles.sectionTitle}>账号记录</h3>
            {accountProfile.status === 'loading' || accountProfile.status === 'idle' ? (
              <div className={styles.skeleton} aria-hidden="true" />
            ) : accountProfile.status === 'ok' ? (
              <ArcadeStatsCard profile={accountProfile.profile} emptyCtaHref="/bombsquad/" />
            ) : (
              <GlassCard radius="2xl" className={styles.emptyCard}>
                <p className={styles.emptyText}>账号记录暂时读不出来，稍后再试。</p>
              </GlassCard>
            )}
          </section>

          <ClaimLocalProfileCard
            localProfile={localProfile}
            localSummary={localSummary}
            claimableEvents={claimableEvents}
            onLocalProfileChange={onLocalProfileChange}
            onClaimed={reloadAccountProfile}
          />

          <CompanionCard />
        </div>
      </div>
    </>
  )
}

/* The anonymous state reads the current device's local profile. It still routes
   to login, but the page is no longer a promise card: it shows actual local
   records or an honest empty state. */
function SignedOutGuide({ localSummary }: { localSummary: ArcadeProfileSummary }) {
  return (
    <>
      <h2 className={styles.title}>本设备的星轨。</h2>
      <p className={styles.lead}>不登录也会先保存在这台设备上；登录后可以保存到账号。</p>

      <div className={styles.signedOutGrid}>
        <ArcadeStatsCard profile={localSummary} emptyCtaHref="/bombsquad/" />
        <GlassCard radius="2xl" className={styles.guideCard}>
          <h3 className={styles.guideTitle}>保存到账号</h3>
          <p className={styles.guideText}>
            登录后可以把这台设备上的 BombSquad 和卦签记录保存到账号。
          </p>
          <Link to="/login" className={styles.guideCta}>
            登录
          </Link>
        </GlassCard>
      </div>
    </>
  )
}

function ClaimLocalProfileCard({
  localProfile,
  localSummary,
  claimableEvents,
  onLocalProfileChange,
  onClaimed,
}: {
  localProfile: ArcadeLocalProfile | null
  localSummary: ArcadeProfileSummary
  claimableEvents: ReturnType<typeof getClaimableArcadeProfileEvents>
  onLocalProfileChange: (profile: ArcadeLocalProfile | null) => void
  onClaimed: () => void
}) {
  const [status, setStatus] = useState<'idle' | 'claiming' | 'claimed' | 'error'>('idle')
  if (!localProfile || (claimableEvents.length === 0 && status !== 'claimed')) return null

  const handleClaim = async () => {
    setStatus('claiming')
    const result = await claimArcadeProfile({
      profile_id: localProfile.profile_id,
      events: claimableEvents,
    })
    if (result.kind !== 'ok') {
      setStatus('error')
      return
    }
    onLocalProfileChange(markArcadeProfileEventsClaimed(result.sourceKeys ?? []))
    onClaimed()
    setStatus('claimed')
  }

  return (
    <section className={styles.section}>
      <h3 className={styles.sectionTitle}>本设备记录</h3>
      <GlassCard radius="2xl" className={styles.claimCard}>
        <p className={styles.claimText}>
          {status === 'claimed'
            ? '本设备记录已保存到账号。'
            : `这台设备还有 ${claimableEvents.length} 条未保存到账号的记录。${
                localSummary.last_activity_at
                  ? ` 最近一次是 ${toChineseDateString(localSummary.last_activity_at.slice(0, 10))}。`
                  : ''
              }`}
        </p>
        {status !== 'claimed' && (
          <Button
            variant="primary"
            size="sm"
            onClick={handleClaim}
            disabled={status === 'claiming'}
          >
            {status === 'claiming' ? '保存中' : '保存到账号'}
          </Button>
        )}
        {status === 'claimed' && <span className={styles.claimStatus}>已保存</span>}
        {status === 'error' && <span className={styles.claimStatus}>保存失败</span>}
      </GlassCard>
    </section>
  )
}

function ArcadeStatsCard({
  profile,
  emptyCtaHref,
}: {
  profile: ArcadeProfileSummary
  emptyCtaHref: string
}) {
  const hasAnyRecord = profile.counts.bombsquad_runs > 0 || profile.counts.oracle_signs > 0
  return (
    <GlassCard radius="2xl" className={styles.statsCard}>
      <div className={styles.statGrid}>
        <StatBlock
          label="今日"
          value={profile.today_played ? '已开始' : '未开始'}
          detail={
            profile.last_activity_at
              ? `最近 ${toChineseDateString(profile.last_activity_at.slice(0, 10))}`
              : '还没有记录'
          }
        />
        <StatBlock
          label="BombSquad"
          value={
            profile.bombsquad.recent ? outcomeLabel(profile.bombsquad.recent.outcome) : '无记录'
          }
          detail={bombsquadDetail(profile)}
        />
        <StatBlock
          label="卦签"
          value={
            profile.oracle.recent
              ? `${profile.oracle.recent.ben} → ${profile.oracle.recent.bian}`
              : '无记录'
          }
          detail={
            profile.oracle.recent
              ? toChineseDateString(profile.oracle.recent.sign_date)
              : '完成一次卦签后会出现在这里'
          }
        />
      </div>
      {!hasAnyRecord && (
        <a className={styles.emptyCta} href={emptyCtaHref}>
          开始玩
        </a>
      )}
    </GlassCard>
  )
}

function StatBlock({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className={styles.statBlock}>
      <div className={styles.statLabel}>{label}</div>
      <div className={styles.statValue}>{value}</div>
      <div className={styles.statDetail}>{detail}</div>
    </div>
  )
}

function outcomeLabel(outcome: string): string {
  switch (outcome) {
    case 'defused':
    case 'practice-cleared':
      return '完成'
    case 'exploded':
      return '三振出局'
    case 'practice-timeout':
    case 'daily-timeout':
      return '到达上限'
    default:
      return outcome
  }
}

function bombsquadDetail(profile: ArcadeProfileSummary): string {
  const recent = profile.bombsquad.recent
  if (!recent) return '完成一局后会出现在这里'
  const mode = recent.mode === 'daily' ? '每日挑战' : '练习'
  const best = profile.bombsquad.best_daily ?? profile.bombsquad.best_practice
  const bestText = best ? ` · 最快 ${formatMs(best.duration_ms)}` : ''
  return `${mode} · ${formatMs(recent.duration_ms)}${bestText}`
}
