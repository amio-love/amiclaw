import { Button } from '@amiclaw/ui'
import styles from './FooterPitch.module.css'

interface FooterPitchProps {
  /* Routes to the BombSquad landing page (window.location.assign('/bombsquad/'))
     — the play CTA. Anonymous-by-design: there is no registration (roadmap:
     nickname + device fingerprint, no login or registration), so the CTA is an
     honest entry straight into play, consistent with the other anonymous-
     homepage CTAs. The prop name is kept for call-site stability. */
  onRegister: () => void
}

/* Footer registration pitch — handoff §6.8. Anonymous-only; rendered as
   the last homepage section before the platform footer. */
export default function FooterPitch({ onRegister }: FooterPitchProps) {
  return (
    <section className={styles.pitch}>
      <h2 className={styles.title}>
        找个人，找一只 AI，<span className={styles.accent}>一起玩。</span>
      </h2>
      <p className={styles.subtitle}>永久免费，不存档也不出售你的对话。</p>
      <Button variant="primary" onClick={onRegister}>
        免注册，直接开始玩
      </Button>
    </section>
  )
}
