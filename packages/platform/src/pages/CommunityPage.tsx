import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ConicAvatar, EyebrowTag, GlassCard } from '@amiclaw/ui'
import {
  fetchArcadeCommunityFeed,
  setArcadeCommunityLike,
} from '@amiclaw/arcade-profile/api-client'
import type { ArcadeCommunityFeedItem } from '@amiclaw/arcade-profile/types'
import { useAuth } from '@/hooks/useAuth'
import { formatRelativeTime } from '@shared/relative-time'
import { formatMs } from '@shared/format-time'
import styles from './CommunityPage.module.css'

type LoadState = 'loading' | 'ready' | 'error'

interface ItemCopy {
  tag: string
  body: string
  /** BombSquad sub-brand cyan result badge — the one sanctioned cyan here,
      surfacing a real defusal outcome, not platform chrome. */
  badge?: string
}

/** First grapheme of the public label, upper-cased — the avatar glyph. */
function initialOf(label: string): string {
  const first = Array.from(label.trim())[0] ?? '?'
  return first.toUpperCase()
}

function describeItem(item: ArcadeCommunityFeedItem): ItemCopy {
  if (item.template === 'daily_clear') {
    const time = item.duration_ms !== undefined ? formatMs(item.duration_ms) : ''
    return {
      tag: '通关',
      body: '拆除了每日挑战。',
      badge: time ? `拆弹成功 · ${time}` : undefined,
    }
  }
  if (item.template === 'leaderboard_entry') {
    return { tag: '上榜', body: '登上了连续打卡榜。' }
  }
  return { tag: '里程碑', body: `连续打卡达成 ${item.streak_days ?? 0} 天。` }
}

/* Community page — a REAL event stream (audit F4 rework). Every card is
   synthesized from a real play event of a player who joined the public streak
   board: a daily defusal (通关), entering the streak board (上榜), or a streak
   milestone (里程碑). Timestamps render live from the real event time; the one
   interaction is a real, persistent like. When the recent window is quiet the
   page shows the honest empty state — never padded fakes. */
export default function CommunityPage() {
  const auth = useAuth()
  const [items, setItems] = useState<ArcadeCommunityFeedItem[]>([])
  const [load, setLoad] = useState<LoadState>('loading')
  // The login-gate hint is anchored to the CARD whose ♥ was tapped, not the page
  // top — an anonymous tap must give feedback where the finger is (re-audit F5:
  // the old page-top hint landed ~200px above the button, so the tap read dead).
  const [loginHintItemId, setLoginHintItemId] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    fetchArcadeCommunityFeed({ limit: 30 }).then((res) => {
      if (!active) return
      if (res.kind === 'ok') {
        setItems(res.feed.items)
        setLoad('ready')
      } else {
        setLoad('error')
      }
    })
    return () => {
      active = false
    }
  }, [])

  const applyLike = useCallback((id: string, liked: boolean, likeCount: number) => {
    setItems((prev) =>
      prev.map((item) => (item.id === id ? { ...item, liked, like_count: likeCount } : item))
    )
  }, [])

  const onToggleLike = useCallback(
    (item: ArcadeCommunityFeedItem) => {
      if (auth.status !== 'authed') {
        setLoginHintItemId(item.id)
        return
      }
      setLoginHintItemId(null)
      const nextLiked = !item.liked
      const optimisticCount = Math.max(0, item.like_count + (nextLiked ? 1 : -1))
      applyLike(item.id, nextLiked, optimisticCount)
      setArcadeCommunityLike(item.id, nextLiked).then((res) => {
        if (res.kind === 'ok') {
          applyLike(item.id, res.like.liked, res.like.like_count)
        } else {
          // anon (session expired) / invalid / error — revert to the real state.
          applyLike(item.id, item.liked, item.like_count)
          if (res.kind === 'anon') setLoginHintItemId(item.id)
        }
      })
    },
    [auth.status, applyLike]
  )

  return (
    <div className={styles.page}>
      <EyebrowTag variant="section">社区 · COMMUNITY</EyebrowTag>
      <h2 className={styles.title}>
        大家<span className={styles.accent}>在玩</span>。
      </h2>
      <p className={styles.lead}>真实玩家动态：拆弹通关、上榜、连续打卡，都从真实战绩生成。</p>

      {load === 'loading' && <p className={styles.status}>加载中…</p>}
      {load === 'error' && <p className={styles.status}>社区动态暂不可用，稍后再试。</p>}
      {load === 'ready' && items.length === 0 && (
        <p className={styles.status}>
          今天还很安静。成为第一个拆弹通关、上榜或连续打卡的人，你的动态会出现在这里。
        </p>
      )}

      {load === 'ready' && items.length > 0 && (
        <div className={styles.grid}>
          {items.map((item) => {
            const copy = describeItem(item)
            return (
              <GlassCard key={item.id} as="article" radius="2xl" className={styles.post}>
                <div className={styles.head}>
                  <ConicAvatar size={38} letter={initialOf(item.public_label)} dim ariaHidden />
                  <div className={styles.meta}>
                    <div className={styles.name}>{item.public_label}</div>
                    <div className={styles.time}>{formatRelativeTime(item.at)}</div>
                  </div>
                  <span className={styles.tag}>{copy.tag}</span>
                </div>
                <p className={styles.body}>{copy.body}</p>
                {copy.badge && <div className={styles.badge}>{copy.badge}</div>}
                <div className={styles.foot}>
                  <button
                    type="button"
                    className={`${styles.like} ${item.liked ? styles.liked : ''}`}
                    aria-pressed={item.liked}
                    aria-label={item.liked ? '取消点赞' : '点赞'}
                    onClick={() => onToggleLike(item)}
                  >
                    <span aria-hidden>♥</span> {item.like_count}
                  </button>
                  {loginHintItemId === item.id && (
                    <span className={styles.likeHint} role="status">
                      登录后即可点赞。<Link to="/login">去登录 →</Link>
                    </span>
                  )}
                </div>
              </GlassCard>
            )
          })}
        </div>
      )}
    </div>
  )
}
