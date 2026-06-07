import AnonHero from '@/components/home/AnonHero'
import WelcomeStrip from '@/components/home/WelcomeStrip'
import DailyChallenge from '@/components/home/DailyChallenge'
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
   「开始玩」CTA. The DailyChallenge and FeaturedBombSquad sections are now
   pure info cards, and FooterPitch is a pure pitch block — none carry a
   play CTA. The landing owns the daily/practice choice and the connect-AI
   flow, so the homepage no longer gates the run itself. WhatIsAmiclaw and
   FooterPitch are anonymous-only (handoff §1).

   Every「今日 / 在线 / 日榜」surface is wired to ONE real source: the daily
   leaderboard API fetched once here via useDailyBoard() and threaded down as
   derived stats + real rows. No homepage surface fabricates participation
   counts, leader times, or player rows. */
export default function GamesPage() {
  const { signedIn, user } = useAuth()
  const board = useDailyBoard()

  /* The AnonHero primary CTA's target — the BombSquad landing page. Mode is
     chosen on the landing, not here. BombSquad now lives in its own SPA at
     /bombsquad/, so crossing the app boundary is a full-page navigation
     (mirrors the Yijing Oracle's /oracle/ href entry), not a client-side
     router push. */
  const enterBombSquad = () => {
    window.location.assign('/bombsquad/')
  }

  /* The ghost「看看 BombSquad」CTA scrolls to the FeaturedBombSquad
     section, which carries id="featured". */
  const scrollToFeatured = () => {
    document.getElementById('featured')?.scrollIntoView({ behavior: 'smooth' })
  }

  return (
    <>
      {signedIn && user ? (
        <WelcomeStrip user={user} />
      ) : (
        <AnonHero onStart={enterBombSquad} onSeeBombSquad={scrollToFeatured} board={board} />
      )}

      <DailyChallenge board={board} />
      <FeaturedBombSquad board={board} />
      {!signedIn && <WhatIsAmiclaw />}
      <UpcomingGames />
      {!signedIn && <FooterPitch />}
    </>
  )
}
