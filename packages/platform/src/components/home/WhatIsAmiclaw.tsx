import { GlassCard, SectionHeader, Wordmark, accentClass } from '@amiclaw/ui'
import styles from './WhatIsAmiclaw.module.css'

interface ValueProp {
  number: string
  title: string
  body: string
}

/* The three value props — handoff §6.5. */
const VALUE_PROPS: ValueProp[] = [
  {
    number: '01',
    title: '人 + AI · 同侧',
    body: '你看见、你描述，AI 推理、你拍板，和它并肩搭档。',
  },
  {
    number: '02',
    title: '小局即玩',
    body: '一局 5 到 8 分钟，等地铁、午休、睡前都来得及。',
  },
  {
    number: '03',
    title: '一周一新',
    body: 'BombSquad 公测中，每周上新一款人机协作小游戏。',
  },
]

/* What-is-Amiclaw section — handoff §6.5. Anonymous-only; a three-up
   grid of interactive glass value-prop cards. Platform chrome — no
   cyan; the giant italic numbers are Latin, so ABeeZee italic is fine. */
export default function WhatIsAmiclaw() {
  return (
    <section className={styles.section}>
      <SectionHeader
        eyebrow={
          <>
            关于 · What is <Wordmark className={styles.brandToken} />
          </>
        }
        title={
          <>
            和 AI 一起，<span className={accentClass}>不止是工具</span>。
          </>
        }
      />
      <div className={styles.grid}>
        {VALUE_PROPS.map((prop) => (
          <GlassCard
            key={prop.number}
            as="article"
            radius="2xl"
            interactive
            className={styles.card}
          >
            <div className={styles.number}>{prop.number}</div>
            <h4 className={styles.cardTitle}>{prop.title}</h4>
            <p className={styles.body}>{prop.body}</p>
          </GlassCard>
        ))}
      </div>
    </section>
  )
}
