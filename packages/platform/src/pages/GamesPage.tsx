import AnonHero from '@/components/home/AnonHero'
import WelcomeStrip from '@/components/home/WelcomeStrip'
import FeaturedBombSquad from '@/components/home/FeaturedBombSquad'
import WhatIsAmiclaw from '@/components/home/WhatIsAmiclaw'
import UpcomingGames from '@/components/home/UpcomingGames'
import FooterPitch from '@/components/home/FooterPitch'
import { useAuth } from '@/hooks/useAuth'
import { useDailyBoard } from '@/hooks/useDailyBoard'

/* The `/` route — the Amiclaw platform homepage. Renders the anonymous
   hero or the signed-in welcome strip per useAuth(), then the homepage
   sections. The homepage has exactly two play entries into the BombSquad
   landing page (/bombsquad): the TopNav「开始玩」and the AnonHero primary
   「开始玩」CTA. FeaturedBombSquad is the single BombSquad overview block: it
   combines the game pitch and daily countdown without repeating leaderboard
   data. FooterPitch is a pure pitch block. The landing owns the daily/practice
   choice and the connect-AI flow, so the homepage no longer gates the run
   itself. WhatIsAmiclaw and FooterPitch are anonymous-only (handoff §1).

   Every「今日 / 在线 / 日榜」surface is wired to ONE real source: the daily
   leaderboard API fetched once here via useDailyBoard() and threaded down as
   derived stats + real rows. No homepage surface fabricates participation
   counts, leader times, or player rows. */
export default function GamesPage() {
  const { status, user } = useAuth()
  const board = useDailyBoard()

  /* The AnonHero primary CTA's target — the BombSquad landing page. Mode is
     chosen on the landing, not here. BombSquad now lives in its own SPA at
     /bombsquad/, so crossing the app boundary is a full-page navigation
     (mirrors the Yijing Oracle's /oracle/ href entry), not a client-side
     router push. */
  const enterBombSquad = () => {
    window.location.assign('/bombsquad/')
  }

  /* The session read is async. While `loading`, show the anonymous hero's
     shell-neutral default rather than flashing the signed-in welcome strip:
     the hero is the safe default since most visitors are anonymous, and a
     loading→authed transition swaps it in without a jarring signed-in flash.
     `authed` requires a resolved `user`. */
  const signedIn = status === 'authed' && user !== null

  return (
    <>
      {signedIn ? (
        <WelcomeStrip user={user} />
      ) : (
        <AnonHero onStart={enterBombSquad} board={board} />
      )}

      <FeaturedBombSquad />
      {!signedIn && <WhatIsAmiclaw />}
      <UpcomingGames />
      {!signedIn && <FooterPitch />}
    </>
  )
}
