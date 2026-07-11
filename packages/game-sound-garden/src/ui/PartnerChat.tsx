/**
 * The partner chat strip. Renders the 园丁 partner's lines plus the player's
 * spoken utterances (push-to-talk). When `offline` the source is the scripted
 * brain; otherwise it is the real DeepSeek partner — the component is the same
 * either way (the store swaps the brain behind it).
 */

import type { ChatLine } from '../game/types'

interface PartnerChatProps {
  chat: ChatLine[]
  /** True → scripted fallback (no DeepSeek key). False → real AI partner. */
  offline: boolean
}

export function PartnerChat(props: PartnerChatProps) {
  const recent = props.chat.slice(-3)
  return (
    <section className="sg-chat">
      <div className="sg-chat-head">
        <span className="sg-chat-avatar">🤖</span>
        <span className="sg-chat-name">园丁伙伴</span>
        <span className="sg-chat-tag">{props.offline ? '脚本兜底 · 未接 AI' : 'AI 伙伴'}</span>
      </div>
      <div className="sg-chat-lines">
        {recent.map((line) => (
          <div className={`sg-chat-line ${line.speaker}`} key={line.seq}>
            {line.speaker === 'player' && <span className="sg-chat-who">你</span>}
            {line.text}
          </div>
        ))}
      </div>
    </section>
  )
}
