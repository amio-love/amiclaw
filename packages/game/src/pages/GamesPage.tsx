import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import PromptModal, { type PromptMode } from '@/components/PromptModal'
import AnonHero from '@/components/home/AnonHero'
import WelcomeStrip from '@/components/home/WelcomeStrip'
import DailyChallenge from '@/components/home/DailyChallenge'
import FeaturedBombSquad from '@/components/home/FeaturedBombSquad'
import WhatIsAmiclaw from '@/components/home/WhatIsAmiclaw'
import UpcomingGames from '@/components/home/UpcomingGames'
import CommunityFeedCarousel from '@/components/home/CommunityFeedCarousel'
import FooterPitch from '@/components/home/FooterPitch'
import { useAuth } from '@/hooks/useAuth'
import { useDailyChallenge } from '@/hooks/useDailyChallenge'

/* Pre-game modal state — mirrors the pattern from the removed HomePage:
   a CTA stages a manual URL plus a deferred navigation, and PromptModal
   gates the actual route change behind 确认开始游戏. */
interface ModalState {
  mode: PromptMode
  manualUrl: string
  onConfirmNavigate: () => void
}

/* The `/` route — the Amiclaw platform homepage. Renders the anonymous
   hero or the signed-in welcome strip per useAuth(), then the homepage
   sections, and owns the PromptModal CTA gate. WhatIsAmiclaw and
   FooterPitch are anonymous-only (handoff §1). */
export default function GamesPage() {
  const { signedIn, user } = useAuth()
  const navigate = useNavigate()
  const { practiceUrl, dailyUrl } = useDailyChallenge()
  const [modal, setModal] = useState<ModalState | null>(null)

  const openDaily = () =>
    setModal({
      mode: 'daily',
      manualUrl: dailyUrl,
      onConfirmNavigate: () => navigate(`/game?mode=daily&url=${encodeURIComponent(dailyUrl)}`),
    })

  const openPractice = () =>
    setModal({
      mode: 'practice',
      manualUrl: practiceUrl,
      onConfirmNavigate: () => navigate('/game?mode=practice'),
    })

  const closeModal = () => setModal(null)

  const confirmModal = () => {
    const navigateToGame = modal?.onConfirmNavigate
    setModal(null)
    navigateToGame?.()
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
        <AnonHero onStart={openDaily} onSeeBombSquad={scrollToFeatured} />
      )}

      <DailyChallenge onChallenge={openDaily} />
      <FeaturedBombSquad
        onStartDaily={openDaily}
        onStartPractice={openPractice}
        onOpenGamePage={openDaily}
      />
      {!signedIn && <WhatIsAmiclaw />}
      <UpcomingGames />
      <CommunityFeedCarousel />
      {!signedIn && <FooterPitch onRegister={openDaily} />}

      <PromptModal
        key={modal?.manualUrl}
        open={modal !== null}
        mode={modal?.mode ?? 'daily'}
        manualUrl={modal?.manualUrl ?? ''}
        onConfirm={confirmModal}
        onClose={closeModal}
      />
    </>
  )
}
