import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ConicAvatar, EyebrowTag, GlassCard } from '@amiclaw/ui'
import {
  fetchArcadeCommunityFeed,
  setArcadeCommunityLike,
} from '@amiclaw/arcade-profile/api-client'
import type {
  ArcadeCommunityFeedItem,
  ArcadeCommunityProxyThread,
} from '@amiclaw/arcade-profile/types'
import { useAuth } from '@/hooks/useAuth'
import { sendCompanionProxyReply, type CompanionProxyReplyResult } from '@/lib/proxy-social-api'
import { formatRelativeTime } from '@shared/relative-time'
import { formatMs } from '@shared/format-time'
import styles from './CommunityPage.module.css'

type LoadState = 'loading' | 'ready' | 'error'

interface ItemCopy {
  tag: string
  body: string
  /** Success badge surfacing a real defusal outcome. Uses the platform success
      color (green --positive), never a game accent — the community feed is
      platform chrome (semantic color law / bounded-accent rule). */
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

/** Quiet inline feedback for a reply refusal (a user-initiated action, so every
    refusal gets an explicit, non-alarming line). `ok` / `already-replied` merge
    a fresh thread instead; `out-of-window` becomes a terminal CTA state, not a
    note. */
function replyNoteText(kind: CompanionProxyReplyResult['kind']): string {
  switch (kind) {
    case 'no-companion':
      return '先创建你的伙伴，才能回应。'
    case 'no-public-profile':
      return '暂时无法回应，稍后再试。'
    case 'rate-limited':
      return '太快了，稍等一下再试。'
    case 'not-owner':
      return '只有动态主人可以回应。'
    case 'not-found':
      return '这条留言已经不在了。'
    case 'anon':
      return '登录后，让你的伙伴回应。'
    default:
      return '伙伴没能回上来，稍后再试。'
  }
}

/* Community page — a REAL event stream (audit F4 rework). Every card is
   synthesized from a real play event of a player who joined the public streak
   board: a daily defusal (通关), entering the streak board (上榜), or a streak
   milestone (里程碑). Timestamps render live from the real event time; the one
   interaction is a real, persistent like. When the recent window is quiet the
   page shows the honest empty state — never padded fakes.

   Companion proxy social (spec §UI Integration 屏 A/B): a card carries 0..N
   companion proxy threads under it (one per author companion). Each thread is a
   companion's public line (署名「伙伴名 ✦ 主人昵称 的伙伴」) + an optional single
   reply + a seal when the round is complete. The event owner (乙) sees a corner
   badge and, per unanswered thread, a one-tap「让我的伙伴回一句」— all content is
   server-generated and rendered verbatim; the client never authors text. */
export default function CommunityPage() {
  const auth = useAuth()
  // `?event=<id>` = arrival from the 甲-side dock transparency line, anchored at
  // the just-authored event (spec §Variant 3).
  const [searchParams] = useSearchParams()
  const eventParam = searchParams.get('event')
  const [items, setItems] = useState<ArcadeCommunityFeedItem[]>([])
  const [load, setLoad] = useState<LoadState>('loading')
  // The login-gate hint is anchored to the CARD whose ♥ was tapped, not the page
  // top — an anonymous tap must give feedback where the finger is (re-audit F5:
  // the old page-top hint landed ~200px above the button, so the tap read dead).
  const [loginHintItemId, setLoginHintItemId] = useState<string | null>(null)
  // Proxy-reply flow: the message_id whose reply is in flight (one at a time),
  // the per-thread inline feedback for a refusal, and the set of threads whose
  // anchor aged out (a reply hit 410 → the CTA becomes a terminal「已过期」state).
  const [pendingReply, setPendingReply] = useState<string | null>(null)
  const [replyNote, setReplyNote] = useState<{ messageId: string; text: string } | null>(null)
  const [expiredThreads, setExpiredThreads] = useState<string[]>([])
  const focusedRef = useRef<HTMLDivElement>(null)

  // Load the feed on mount AND on every anchor arrival (`?event=` change) — a
  // dock-line navigation must not land on a stale cached feed missing the
  // just-authored thread (force-refetch-on-anchor). A transient refetch failure
  // leaves an already-ready page ready rather than flashing the error state.
  useEffect(() => {
    let active = true
    fetchArcadeCommunityFeed({ limit: 30 }).then((res) => {
      if (!active) return
      if (res.kind === 'ok') {
        setItems(res.feed.items)
        setLoad('ready')
      } else {
        setLoad((prev) => (prev === 'loading' ? 'error' : prev))
      }
    })
    return () => {
      active = false
    }
  }, [eventParam])

  // Scroll the anchored card into view once it is present (mirrors the memory
  // album's evidence-link focus convention). jsdom stubs scrollIntoView.
  useEffect(() => {
    if (eventParam) focusedRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [eventParam, items])

  // After a reply lands, re-read the feed but merge ONLY the affected event's
  // threads (+ viewer flags) — a wholesale replace would clobber in-flight
  // optimistic like state on other cards.
  const mergeThreadsForEvent = useCallback((eventId: string) => {
    return fetchArcadeCommunityFeed({ limit: 30 }).then((res) => {
      if (res.kind !== 'ok') return
      const fresh = res.feed.items.find((f) => f.id === eventId)
      if (!fresh) return
      setItems((prev) =>
        prev.map((item) =>
          item.id === eventId
            ? {
                ...item,
                threads: fresh.threads,
                viewer_is_owner: fresh.viewer_is_owner,
                viewer_has_companion: fresh.viewer_has_companion,
              }
            : item
        )
      )
    })
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

  const onReply = useCallback(
    (messageId: string, eventId: string) => {
      setPendingReply(messageId)
      setReplyNote(null)
      sendCompanionProxyReply(messageId).then((res) => {
        setPendingReply(null)
        switch (res.kind) {
          case 'ok':
            // The reply is written; merge the affected event's fresh threads so
            // its server-generated body + seal render verbatim (the V2 response
            // carries no reply body) without disturbing other cards.
            void mergeThreadsForEvent(eventId)
            break
          case 'already-replied':
            // A reply already exists server-side — merge reveals it (the thread
            // seals) and the note explains the tap did nothing new.
            setReplyNote({ messageId, text: '这条刚才已经回复过了。' })
            void mergeThreadsForEvent(eventId)
            break
          case 'out-of-window':
            // The anchor slid out of the 14-day window — the CTA becomes a
            // disabled terminal「已过期」state, never a re-tappable no-op.
            setExpiredThreads((prev) => (prev.includes(messageId) ? prev : [...prev, messageId]))
            break
          default:
            setReplyNote({ messageId, text: replyNoteText(res.kind) })
        }
      })
    },
    [mergeThreadsForEvent]
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
            const showBadge = item.viewer_is_owner && item.threads.length > 0
            const focused = eventParam !== null && item.id === eventParam
            return (
              <GlassCard
                key={item.id}
                as="article"
                radius="2xl"
                className={`${styles.post} ${focused ? styles.focused : ''}`}
              >
                {showBadge && (
                  <span className={styles.msgFlag}>
                    <span aria-hidden>✦</span> 伙伴留言 {item.threads.length}
                  </span>
                )}
                <div className={styles.head} ref={focused ? focusedRef : undefined}>
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

                {item.threads.map((thread) => (
                  <ProxyThread
                    key={thread.message_id}
                    item={item}
                    thread={thread}
                    authed={auth.status === 'authed'}
                    pending={pendingReply === thread.message_id}
                    expired={expiredThreads.includes(thread.message_id)}
                    note={replyNote?.messageId === thread.message_id ? replyNote.text : null}
                    onReply={onReply}
                  />
                ))}
              </GlassCard>
            )
          })}
        </div>
      )}
    </div>
  )
}

interface ProxyThreadProps {
  item: ArcadeCommunityFeedItem
  thread: ArcadeCommunityProxyThread
  authed: boolean
  pending: boolean
  /** The anchor aged out (a reply hit 410) → terminal「已过期」CTA state. */
  expired: boolean
  note: string | null
  onReply: (messageId: string, eventId: string) => void
}

/** One companion proxy thread under an event card (spec §UI Integration 屏 A/B):
    the companion's public line, its optional single reply, and a seal when the
    round is complete — or, on an unanswered thread, the viewer-appropriate reply
    affordance. All rendered text is server-generated snapshot data. */
function ProxyThread({ item, thread, authed, pending, expired, note, onReply }: ProxyThreadProps) {
  return (
    <div className={styles.thread}>
      <ProxyLine
        who={thread.author_companion_name}
        ownerLabel={thread.author_public_label}
        body={thread.body}
        at={thread.created_at}
      />

      {thread.reply ? (
        <>
          <ProxyLine
            reply
            who={thread.reply.responder_companion_name}
            ownerLabel={thread.reply.responder_public_label}
            body={thread.reply.body}
            at={thread.reply.created_at}
          />
          <div className={styles.seal}>
            <span className={styles.sealSpark}>✦</span>一轮对话已完成
          </div>
        </>
      ) : (
        <ReplyAffordance
          item={item}
          messageId={thread.message_id}
          canReply={thread.can_reply}
          authed={authed}
          pending={pending}
          expired={expired}
          onReply={onReply}
        />
      )}

      {note && (
        <p className={styles.replyNote} role="status">
          {note}
        </p>
      )}
    </div>
  )
}

interface ProxyLineProps {
  who: string
  ownerLabel: string
  body: string
  at: string
  reply?: boolean
}

/** A single companion line — signature「伙伴名 ✦ 主人昵称 的伙伴」+ live relative
    time + the AI-authored body + the "非模板" honesty hint. The reply variant is
    indented with a cool-toned orb (mockup 屏 A). */
function ProxyLine({ who, ownerLabel, body, at, reply }: ProxyLineProps) {
  return (
    <div className={`${styles.msg} ${reply ? styles.replyMsg : ''}`}>
      <span className={`${styles.orb} ${reply ? styles.orbCool : ''}`} aria-hidden />
      <div className={styles.msgBody}>
        <div className={styles.msgAuthor}>
          <span className={styles.who}>{who}</span>
          <span className={styles.sep}>✦</span>
          <span className={styles.role}>{ownerLabel} 的伙伴</span>
          <span className={styles.when}>{formatRelativeTime(at)}</span>
        </div>
        <p className={styles.msgText}>{body}</p>
        <p className={styles.hint}>真实内容由伙伴 AI 生成，非模板</p>
      </div>
    </div>
  )
}

interface ReplyAffordanceProps {
  item: ArcadeCommunityFeedItem
  messageId: string
  canReply: boolean
  authed: boolean
  pending: boolean
  expired: boolean
  onReply: (messageId: string, eventId: string) => void
}

/** The per-thread reply affordance for an unanswered thread (spec §UI 屏 B):
    a terminal「已过期」state when the anchor aged out, else the one-tap reply CTA
    when the owner can reply, the companion-onboarding guide when the owner has
    no companion yet, or the login invite for an anonymous passer-by. A signed-in
    non-owner sees nothing (read-only). */
function ReplyAffordance({
  item,
  messageId,
  canReply,
  authed,
  pending,
  expired,
  onReply,
}: ReplyAffordanceProps) {
  if (canReply && expired) {
    // The anchor aged out mid-session — a disabled terminal state, never a
    // re-tappable no-op that would just 410 again.
    return (
      <button type="button" className={styles.replyCta} disabled aria-disabled="true">
        已过期
      </button>
    )
  }
  if (canReply) {
    return (
      <button
        type="button"
        className={styles.replyCta}
        disabled={pending}
        onClick={() => onReply(messageId, item.id)}
      >
        <span aria-hidden>◗</span> {pending ? '伙伴正在回复…' : '让我的伙伴回一句'}
      </button>
    )
  }
  if (item.viewer_is_owner && !item.viewer_has_companion) {
    return (
      <Link to="/me/companion" className={styles.replyGuide}>
        创建你的伙伴来回应 →
      </Link>
    )
  }
  if (!authed) {
    return (
      <p className={styles.loginInvite} role="status">
        登录，让你的伙伴回应。<Link to="/login">去登录 →</Link>
      </p>
    )
  }
  return null
}
