import type { ReactNode } from 'react'
import { ConicAvatar, GlassCard, SectionHeader } from '@amiclaw/ui'
import { type FeedItemBody, feedItems } from '@/mocks/community'
import styles from './CommunityFeedCarousel.module.css'

/* Renders a feed-card body, wrapping the optional highlight fragment in
   a yellow `.high` span. Mock bodies stay plain text; the span is
   applied here so no JSX leaks into the mock data. */
function renderBody(body: FeedItemBody): ReactNode {
  if (typeof body === 'string') {
    return body
  }
  const start = body.text.indexOf(body.highlight)
  if (start === -1) {
    return body.text
  }
  return (
    <>
      {body.text.slice(0, start)}
      <span className={styles.high}>{body.highlight}</span>
      {body.text.slice(start + body.highlight.length)}
    </>
  )
}

/* Community feed carousel — handoff §6.7. A horizontally scrolling,
   scroll-snapped track of fixed-width feed cards. Platform chrome — the
   only accent is the yellow `.high` highlight inside a card body. */
export default function CommunityFeedCarousel() {
  return (
    <section className={styles.section}>
      <SectionHeader
        eyebrow="社区 · 最近的玩家"
        title="大家在玩。"
        action={{ label: '全部动态 →', to: '/community' }}
      />
      <div className={styles.track}>
        {feedItems.map((item) => (
          <GlassCard key={item.id} as="article" radius="xl" className={styles.card}>
            <div className={styles.head}>
              <ConicAvatar size={34} letter={item.initial} dim ariaHidden />
              <div className={styles.meta}>
                <div className={styles.name}>{item.who}</div>
                <div className={styles.time}>{item.when}</div>
              </div>
            </div>
            <div className={styles.body}>{renderBody(item.body)}</div>
            <div className={styles.stats}>
              <span>
                <span className={styles.ico} />
                {item.likes}
              </span>
              <span>
                <span className={styles.ico} />
                {item.comments}
              </span>
            </div>
          </GlassCard>
        ))}
      </div>
    </section>
  )
}
