import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Button, ConicAvatar, Disclosure, EyebrowTag, GlassCard } from '@amiclaw/ui'
import type {
  ArcadeLocalProfile,
  ArcadeProfileHistoryDay,
  ArcadeProfileSummary,
  ArcadePublicProfileStatus,
} from '@amiclaw/arcade-profile/types'
import {
  ensureArcadeLocalProfile,
  getClaimableArcadeProfileEvents,
  markArcadeProfileEventsClaimed,
  summarizeArcadeLocalProfile,
} from '@amiclaw/arcade-profile/local'
import { claimArcadeProfile, fetchArcadeProfile } from '@amiclaw/arcade-profile/api-client'
import {
  isValidArcadeNickname,
  readChosenArcadeNickname,
  writeChosenArcadeNickname,
} from '@/lib/arcade-nickname'
import { formatMs } from '@shared/format-time'
import { getDailyResetHint, toChineseDateString } from '@shared/date'
import { useAuth, type DisplayUser } from '@/hooks/useAuth'
import { boardDayLabel } from '@/lib/board-dates'
import CompanionCard from '@/components/companion/CompanionCard'
import { companionSeedEnabled } from '@/lib/companion-seed'
import styles from './AccountPage.module.css'

/* B12 断签后果说明 — the honest streak-break line. Verified against
   computeArcadeStreak (arcade-profile/summary): a missed product day breaks the
   current run so `current_days` restarts from zero on the next qualifying day,
   while `longest_days` and every stored record persist untouched (the companion
   memory in COMPANION_DB is a separate store the streak never touches). Register
   matches the presence design's「伙伴会想你，但不会惩罚你」— no punishment framing. */
const STREAK_BREAK_NOTE =
  '断一天，连续天数会从头算起。最长记录和已保存的成绩都还在，错过一天不会有惩罚。'

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
  | {
      status: 'ok'
      profile: ArcadeProfileSummary
      publicProfile: ArcadePublicProfileStatus
    }
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
        setState({
          status: 'ok',
          profile: result.profile,
          publicProfile: result.publicProfile,
        })
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

  // The unified username — the public leaderboard handle (ruling A), editable
  // here in /me. Seeded from the shared board-nickname key and kept in local
  // state so an edit updates the title + card live. Never the account email
  // (audit F19); the email stays as the explicit account-id line below.
  const [username, setUsername] = useState<string | null>(() => readChosenArcadeNickname() ?? null)
  const profileId = accountProfile.status === 'ok' ? accountProfile.profile.profile_id : undefined

  return (
    <>
      <h2 className={styles.title}>
        {username ? (
          <>
            <span className={styles.accent}>{username}</span> 的星轨。
          </>
        ) : (
          '你的星轨。'
        )}
      </h2>
      <p className={styles.lead}>这里显示这个账号已经保存的真实记录。</p>

      <div className={styles.grid}>
        <GlassCard radius="2xl" className={styles.profile}>
          <div className={styles.avatar}>
            <ConicAvatar size={96} letter={user.avatarLetter} ariaHidden />
          </div>
          <UsernameEditor
            username={username}
            profileId={profileId}
            onSaved={(name) => {
              setUsername(name)
              reloadAccountProfile()
            }}
          />
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
              <>
                <ArcadeStatsCard profile={accountProfile.profile} emptyCtaHref="/bombsquad/" />
                <PublicProfileCard
                  profile={accountProfile.profile}
                  publicProfile={accountProfile.publicProfile}
                  onEnabled={reloadAccountProfile}
                />
              </>
            ) : (
              <GlassCard radius="2xl" className={styles.emptyCard}>
                <p className={styles.emptyText}>账号记录暂时读不出来，稍后再试。</p>
              </GlassCard>
            )}
          </section>

          {accountProfile.status === 'ok' && (
            <ArcadeHistorySection history={accountProfile.profile.history} />
          )}

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

/* The unified-username editor (ruling A). Writes the shared board-nickname key
   (the public leaderboard handle) and, for a signed-in account, syncs the D1
   `public_label` via a label-only claim so both boards show one name. */
function UsernameEditor({
  username,
  profileId,
  onSaved,
}: {
  username: string | null
  profileId: string | undefined
  onSaved: (name: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(username ?? '')
  const [status, setStatus] = useState<'idle' | 'saving' | 'error'>('idle')

  const startEdit = () => {
    setDraft(username ?? '')
    setStatus('idle')
    setEditing(true)
  }

  const handleSave = async () => {
    const trimmed = draft.trim()
    if (!isValidArcadeNickname(trimmed)) {
      setStatus('error')
      return
    }
    setStatus('saving')
    if (!writeChosenArcadeNickname(trimmed)) {
      setStatus('error')
      return
    }
    // Keep the account-side public label unified with the local handle. A
    // failed sync still keeps the local write — the streak board picks it up on
    // the next claim — so a network blip never blocks the rename.
    if (profileId) {
      await claimArcadeProfile({ profile_id: profileId, events: [], public_label: trimmed })
    }
    onSaved(trimmed)
    setEditing(false)
    setStatus('idle')
  }

  if (!editing) {
    return (
      <div className={styles.usernameRow}>
        <span className={styles.name}>{username ?? '还没有上榜名'}</span>
        <button type="button" className={styles.usernameEdit} onClick={startEdit}>
          {username ? '改名' : '起个上榜名'}
        </button>
      </div>
    )
  }

  return (
    <div className={styles.usernameEditor}>
      <input
        className={styles.usernameInput}
        value={draft}
        maxLength={20}
        autoFocus
        aria-label="上榜名"
        placeholder="上榜名"
        onChange={(e) => {
          setDraft(e.target.value)
          if (status === 'error') setStatus('idle')
        }}
      />
      <div className={styles.usernameActions}>
        <Button
          variant="primary"
          size="sm"
          onClick={handleSave}
          disabled={status === 'saving' || !isValidArcadeNickname(draft)}
        >
          {status === 'saving' ? '保存中' : '保存'}
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setEditing(false)}>
          取消
        </Button>
      </div>
      {status === 'error' && <span className={styles.usernameError}>名字需要 1–20 个字符。</span>}
    </div>
  )
}

/* The anonymous state reads the current device's local profile. It still routes
   to login, but the page is no longer a promise card: it shows actual local
   records or an honest empty state. */
function SignedOutGuide({ localSummary }: { localSummary: ArcadeProfileSummary }) {
  return (
    <>
      <h2 className={styles.title}>你的星轨。</h2>
      <p className={styles.lead}>
        这里显示你玩过的真实记录。
        <Disclosure label="记录保存说明">
          不登录也会先保存在这台设备上；登录后可以把这台设备上的记录保存到账号，跨设备同步。
        </Disclosure>
      </p>

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

      <ArcadeHistorySection history={localSummary.history} />
    </>
  )
}

/* Per-day record view over the last 7 product days — the「昨天可见」surface.
   Reads the summary's `history` (same product-day source as the checklist),
   so yesterday's 打卡 / 成绩 / 卦签 stay visible after the daily rollover.
   Hidden while the whole window is empty: the stats card already carries the
   honest empty state and play CTA. */
function ArcadeHistorySection({ history }: { history?: ArcadeProfileHistoryDay[] }) {
  const days = history ?? []
  const hasAnyRecord = days.some(
    (day) => day.runs > 0 || day.sign !== null || day.bombsquad_daily_completed || day.oracle_signed
  )
  if (!hasAnyRecord) return null

  return (
    <section className={styles.section}>
      <h3 className={styles.sectionTitle}>最近 7 天</h3>
      <GlassCard radius="2xl" className={styles.historyCard}>
        <div className={styles.historyList} role="table" aria-label="最近 7 天记录">
          <div className={styles.historyHeadRow} role="row">
            <span role="columnheader">日期</span>
            <span role="columnheader">每日拆弹</span>
            <span role="columnheader">卦签</span>
          </div>
          {days.map((day, offset) => (
            <div key={day.date} className={styles.historyRow} role="row">
              <span className={styles.historyDate} role="cell">
                {boardDayLabel(day.date, offset)}
              </span>
              <span className={styles.historyCell} role="cell">
                {bombsquadDayText(day)}
              </span>
              <span className={styles.historyCell} role="cell">
                {day.sign ? `${day.sign.ben} → ${day.sign.bian}` : '—'}
              </span>
            </div>
          ))}
        </div>
      </GlassCard>
    </section>
  )
}

function bombsquadDayText(day: ArcadeProfileHistoryDay): string {
  if (day.best_daily) return `✓ ${formatMs(day.best_daily.duration_ms)}`
  // Qualified beyond the capped recent-run window (account records past 100).
  if (day.bombsquad_daily_completed) return '✓ 已拆除'
  if (day.runs > 0) return `${day.runs} 局`
  return '—'
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

  const handleClaim = useCallback(async () => {
    if (!localProfile) return
    setStatus('claiming')
    // Adopt the player's chosen daily nickname as the public streak-board label
    // so a logged-in player surfaces their name, not a generated placeholder.
    // Omitted when unset — the server then derives from the account email.
    const chosenLabel = readChosenArcadeNickname()
    const result = await claimArcadeProfile({
      profile_id: localProfile.profile_id,
      events: claimableEvents,
      ...(chosenLabel ? { public_label: chosenLabel } : {}),
    })
    if (result.kind !== 'ok') {
      setStatus('error')
      return
    }
    onLocalProfileChange(markArcadeProfileEventsClaimed(result.sourceKeys ?? []))
    onClaimed()
    setStatus('claimed')
  }, [localProfile, claimableEvents, onLocalProfileChange, onClaimed])

  // No auto-claim on load: opening /me is a read, and a write the user did not
  // ask for (product ethos: no silent writes a player wouldn't expect). This
  // device's unsaved records surface below with an explicit「保存到账号」tap — the
  // claim fires only when the player asks for it, so /me stays read-only until
  // then. The card copy names the pending count so nothing is hidden.
  if (!localProfile || (claimableEvents.length === 0 && status !== 'claimed')) return null

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
          value={profile.daily_loop.streak.today_completed ? '已打卡' : '未打卡'}
          detail={
            profile.last_activity_at
              ? `最近 ${toChineseDateString(profile.last_activity_at.slice(0, 10))}`
              : '还没有记录'
          }
        />
        <StatBlock
          label="连续"
          value={`${profile.daily_loop.streak.current_days} 天`}
          detail={`最长 ${profile.daily_loop.streak.longest_days} 天`}
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
      {/* rc §3 progressive disclosure — the default surface shows only the
          stats above; the operational caveats (UTC reset + the B12 断签说明,
          honest that a break restarts the count while the longest record and
          every saved result stay, no penalty) relocate behind the ⓘ. Honesty
          content is not deleted, only moved off the default position. */}
      <p className={styles.statsHint}>
        <Disclosure label="连续打卡与刷新说明">{`${STREAK_BREAK_NOTE} ${getDailyResetHint()}`}</Disclosure>
      </p>
      {!hasAnyRecord && (
        <a className={styles.emptyCta} href={emptyCtaHref}>
          开始玩
        </a>
      )}
    </GlassCard>
  )
}

function PublicProfileCard({
  profile,
  publicProfile,
  onEnabled,
}: {
  profile: ArcadeProfileSummary
  publicProfile: ArcadePublicProfileStatus
  onEnabled: () => void
}) {
  const [status, setStatus] = useState<'idle' | 'saving' | 'error'>('idle')
  const canEnable =
    !publicProfile.claimed &&
    profile.profile_id !== undefined &&
    (profile.counts.bombsquad_runs > 0 || profile.counts.oracle_signs > 0)

  const handleEnable = async () => {
    if (!profile.profile_id) return
    setStatus('saving')
    // Adopt the chosen daily nickname as the public label (server falls back to
    // the account email when it is unset) — never the generated placeholder.
    const chosenLabel = readChosenArcadeNickname()
    const result = await claimArcadeProfile({
      profile_id: profile.profile_id,
      events: [],
      ...(chosenLabel ? { public_label: chosenLabel } : {}),
    })
    if (result.kind !== 'ok') {
      setStatus('error')
      return
    }
    setStatus('idle')
    onEnabled()
  }

  return (
    <GlassCard radius="2xl" className={styles.publicCard}>
      <div>
        <h3 className={styles.publicTitle}>公开连续榜</h3>
        <p className={styles.publicText}>
          {publicProfile.claimed
            ? `上榜名：${publicProfile.public_label}`
            : canEnable
              ? '账号已有记录；启用公开上榜名后，会进入连续打卡榜。'
              : '保存本设备记录到账号后，会生成公开上榜名。'}
        </p>
        {status === 'error' && <p className={styles.publicError}>启用失败，请稍后再试。</p>}
      </div>
      {canEnable ? (
        <Button variant="ghost" size="sm" onClick={handleEnable} disabled={status === 'saving'}>
          {status === 'saving' ? '启用中' : '启用公开上榜'}
        </Button>
      ) : (
        <Link to="/leaderboard" className={styles.publicLink}>
          查看排行榜
        </Link>
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
