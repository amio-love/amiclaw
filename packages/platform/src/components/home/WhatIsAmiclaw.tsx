import { GlassCard, SectionHeader, accentClass } from '@amiclaw/ui'
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
    body: '不是被 AI 服务，而是和 AI 搭档：你看见、你描述、AI 推理、你拍板。',
  },
  {
    number: '02',
    title: '小局即玩 · 易上瘾',
    body: '一局 5 到 8 分钟。等地铁、午休、睡前都来得及，每天一次刷新榜单。',
  },
  {
    number: '03',
    title: '社区 · 你和你的朋友',
    body: '把战绩、笑场、出错的瞬间晒给朋友。Amiclaw 是属于人和人的游戏厅。',
  },
]

/* What-is-Amiclaw section — handoff §6.5. Anonymous-only; a three-up
   grid of interactive glass value-prop cards. Platform chrome — no
   cyan; the giant italic numbers are Latin, so ABeeZee italic is fine. */
export default function WhatIsAmiclaw() {
  return (
    <section className={styles.section}>
      <SectionHeader
        eyebrow="关于 · WHAT IS AMICLAW"
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
