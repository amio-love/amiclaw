import { useNavigate } from 'react-router-dom'
import AnonHero from '@/components/home/AnonHero'
import WelcomeStrip from '@/components/home/WelcomeStrip'
import DailyChallenge from '@/components/home/DailyChallenge'
import FeaturedBombSquad from '@/components/home/FeaturedBombSquad'
import WhatIsAmiclaw from '@/components/home/WhatIsAmiclaw'
import UpcomingGames from '@/components/home/UpcomingGames'
import CommunityFeedCarousel from '@/components/home/CommunityFeedCarousel'
import FooterPitch from '@/components/home/FooterPitch'
import { useAuth } from '@/hooks/useAuth'

/* The `/` route — the Amiclaw platform homepage. Renders the anonymous
   hero or the signed-in welcome strip per useAuth(), then the homepage
   sections. Every BombSquad「开始游戏」CTA routes to the BombSquad
   landing page (/bombsquad); the landing owns the daily/practice choice
   and the connect-AI flow, so the homepage no longer gates the run itself.
   WhatIsAmiclaw and FooterPitch are anonymous-only (handoff §1). */
export default function GamesPage() {
  const { signedIn, user } = useAuth()
  const navigate = useNavigate()

  /* All homepage「玩 BombSquad」CTAs share one target — the BombSquad
     landing page. Mode is chosen on the landing, not here. */
  const enterBombSquad = () => navigate('/bombsquad')

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
        <AnonHero onStart={enterBombSquad} onSeeBombSquad={scrollToFeatured} />
      )}

      <DailyChallenge onChallenge={enterBombSquad} />
      <FeaturedBombSquad
        onStartDaily={enterBombSquad}
        onStartPractice={enterBombSquad}
        onOpenGamePage={enterBombSquad}
      />
      {!signedIn && <WhatIsAmiclaw />}
      <UpcomingGames />
      <CommunityFeedCarousel />
      {!signedIn && <FooterPitch onRegister={enterBombSquad} />}
    </>
  )
}
