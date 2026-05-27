import { Button } from '@amiclaw/ui'
import styles from './FooterPitch.module.css'

interface FooterPitchProps {
  /* Routes to the BombSquad landing page (/game) — the「注册 · 30 秒」CTA.
     There is no real auth yet, so registration routes into BombSquad,
     consistent with the other anonymous-homepage CTAs. */
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
      <p className={styles.subtitle}>
        Amiclaw 一周一次新游戏 · 永久免费 · 不卖你的对话也不存档你的对话。
      </p>
      <Button variant="primary" onClick={onRegister}>
        注册 · 30 秒
      </Button>
    </section>
  )
}
