import { useEffect, useMemo, useState } from 'react'
import AnonHero from '@/components/home/AnonHero'
import WelcomeStrip from '@/components/home/WelcomeStrip'
import DailyChecklist from '@/components/home/DailyChecklist'
import FeaturedBombSquad from '@/components/home/FeaturedBombSquad'
import WhatIsAmiclaw from '@/components/home/WhatIsAmiclaw'
import UpcomingGames from '@/components/home/UpcomingGames'
import FooterPitch from '@/components/home/FooterPitch'
import type { ArcadeProfileSummary } from '@amiclaw/arcade-profile/types'
import { fetchArcadeProfile } from '@amiclaw/arcade-profile/api-client'
import { readArcadeLocalProfile, summarizeArcadeLocalProfile } from '@amiclaw/arcade-profile/local'
import { useAuth } from '@/hooks/useAuth'
import { useDailyBoard } from '@/hooks/useDailyBoard'
import styles from './GamesPage.module.css'

/* The `/` route — the AMIO Arcade platform homepage. Renders the anonymous
   hero or the signed-in welcome strip per useAuth(), then the homepage
   sections. The homepage carries the anonymous play entry into the BombSquad
   landing page (/bombsquad): the AnonHero primary「开始玩」CTA (the TopNav now
   holds the 登录 / 注册 auth entry, not a play CTA). FeaturedBombSquad is the
   single BombSquad overview block: it
   combines the game pitch and daily countdown without repeating leaderboard
   data. FooterPitch is a pure pitch block. The landing owns the daily/practice
   choice and the connect-AI flow, so the homepage no longer gates the run
   itself. WhatIsAmiclaw and FooterPitch are anonymous-only (handoff §1).

   Every「今日 / 在线 / 日榜」surface is wired to ONE real source: the daily
   leaderboard API fetched once here via useDailyBoard() and threaded down as
   derived stats + real rows. No homepage surface fabricates participation
   counts, leader times, or player rows. */
export default function GamesPage() {
  const { status, user, optimisticAuthed } = useAuth()
  const board = useDailyBoard()
  const [localProfile] = useState(() => readArcadeLocalProfile())
  const localSummary = useMemo(() => summarizeArcadeLocalProfile(localProfile), [localProfile])
  const [accountSummary, setAccountSummary] = useState<{
    userId: string
    profile: ArcadeProfileSummary
  } | null>(null)

  /* The AnonHero primary CTA's target — the BombSquad landing page. Mode is
     chosen on the landing, not here. BombSquad now lives in its own SPA at
     /bombsquad/, so crossing the app boundary is a full-page navigation
     (mirrors the Yijing Oracle's /oracle/ href entry), not a client-side
     router push. */
  const enterBombSquad = () => {
    window.location.assign('/bombsquad/')
  }

  /* The session read is async. `authed` requires a resolved `user`.

     Auth-flash fix (rb-codescan Inv4 option 1): a returning signed-in device
     carries an optimistic localStorage hint. While that device is still
     `loading`, hold a neutral hero-height placeholder instead of flashing the
     anonymous hero, then swap in the resolved WelcomeStrip (or, if the hint was
     stale — logged out elsewhere — the AnonHero). The majority anonymous path
     (no hint) is unchanged: it renders the hero immediately during `loading`. */
  const signedIn = status === 'authed' && user !== null
  const holdingForAuth = status === 'loading' && optimisticAuthed
  const showAnonHero = !signedIn && !holdingForAuth
  const signedInUserId = signedIn ? user.user_id : null

  useEffect(() => {
    if (signedInUserId === null) return
    let active = true
    fetchArcadeProfile().then((result) => {
      if (!active) return
      setAccountSummary(
        result.kind === 'ok' ? { userId: signedInUserId, profile: result.profile } : null
      )
    })
    return () => {
      active = false
    }
  }, [signedInUserId])

  const accountProfile =
    signedInUserId !== null && accountSummary?.userId === signedInUserId
      ? accountSummary.profile
      : null
  const checklistProfile = accountProfile ?? localSummary
  const checklistScope = accountProfile ? 'account' : 'device'

  return (
    <>
      {signedIn ? (
        <WelcomeStrip user={user} />
      ) : holdingForAuth ? (
        <div className={styles.heroPlaceholder} aria-hidden="true" />
      ) : (
        <AnonHero onStart={enterBombSquad} board={board} />
      )}

      <DailyChecklist profile={checklistProfile} scope={checklistScope} />
      <FeaturedBombSquad />
      {showAnonHero && <WhatIsAmiclaw />}
      <UpcomingGames />
      {showAnonHero && <FooterPitch />}
    </>
  )
}
