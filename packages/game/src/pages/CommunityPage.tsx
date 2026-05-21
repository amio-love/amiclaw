import ConicAvatar from '@/components/ui/ConicAvatar'
import EyebrowTag from '@/components/ui/EyebrowTag'
import GlassCard from '@/components/ui/GlassCard'
import { communityPosts } from '@/mocks/community'
import styles from './CommunityPage.module.css'

/* Community page — handoff §6.10. A 2-column grid of player posts:
   avatar + name + time, a text body, an optional cyan game-result
   img-block (BombSquad sub-brand content — the one sanctioned cyan on
   this surface), and a like / comment / share footer. */
export default function CommunityPage() {
  return (
    <div className={styles.page}>
      <EyebrowTag variant="section">社区 · COMMUNITY</EyebrowTag>
      <h2 className={styles.title}>
        大家<span className={styles.accent}>在玩</span>。
      </h2>
      <p className={styles.lead}>玩家的赛后分享、技巧、出错瞬间。每天有数百条新内容。</p>

      <div className={styles.grid}>
        {communityPosts.map((post) => (
          <GlassCard key={post.id} as="article" radius="2xl" className={styles.post}>
            <div className={styles.head}>
              <ConicAvatar size={38} letter={post.initial} dim ariaHidden />
              <div className={styles.meta}>
                <div className={styles.name}>{post.who}</div>
                <div className={styles.time}>{post.when}</div>
              </div>
            </div>
            <p className={styles.body}>{post.body}</p>
            {post.image && <div className={styles.image}>{post.image}</div>}
            <div className={styles.foot}>
              <span>♥ {post.likes}</span>
              <span>💬 {post.comments}</span>
              <span>↗ 转发</span>
            </div>
          </GlassCard>
        ))}
      </div>
    </div>
  )
}
