import type { PlayerInputFeedback } from '../engine/types'

const REASON_COPY: Record<PlayerInputFeedback['reason'], string> = {
  wall: '前方是墙，无法移动。',
  edge: '已经到达地图边缘。',
  companion: '伙伴挡住了这一步，路径会继续尝试。',
  unreachable: '当前位置无法到达目标。',
  captured: '你已被追兵抓住，等待伙伴救援。',
  'queue-full': '方向输入已排满，请稍等。',
}

export function InputFeedback({
  feedback,
  currentTick,
}: {
  feedback?: PlayerInputFeedback
  currentTick: number
}) {
  const visible = feedback && currentTick - feedback.tick <= 4
  return (
    <p
      className={visible ? 'input-feedback' : 'input-feedback sr-only'}
      role="status"
      aria-live="polite"
    >
      {visible ? REASON_COPY[feedback.reason] : ''}
    </p>
  )
}
