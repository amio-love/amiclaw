import { BackLink, Button, Chip, PageHeader } from '@amiclaw/ui'
import { STARBURST_GLYPH, STARBURST_LABEL, type WinReward } from '@shared/reward-types'

import type { SimulationState } from '../engine/types'

function causalBeat(state: SimulationState): string {
  const event = [...state.eventLog]
    .reverse()
    .find((candidate) => ['rescue', 'swap', 'core-collected'].includes(candidate.type))
  if (!event) return '即使模型没有连接，确定性伙伴也始终在行动。'
  if (event.type === 'rescue') return '这次救援让两道影子都留在了追逃中。'
  if (event.type === 'swap') return '有限换位把你送到了伙伴预先建立的落点。'
  return '两条路线配合收集了最后一枚光核。'
}

export function ResultScreen({
  state,
  reward,
  onRestart,
}: {
  state: SimulationState
  reward?: WinReward | null
  onRestart(): void
}) {
  const won = state.phase === 'win'
  return (
    <main className="result-shell">
      <PageHeader
        className="result-header"
        back={<BackLink variant="inline" label="AMIO Arcade" href="/" />}
        eyebrow={<Chip variant={won ? 'live' : 'dev'}>{won ? '成功撤离' : '本局结束'}</Chip>}
        title={<span className="sr-only">双影追逃结算</span>}
      />
      <section className={won ? 'result-card won' : 'result-card'}>
        <div className="result-mark" aria-hidden="true">
          <span />
          <span />
        </div>
        <h1>{won ? '两道影子一起回家了。' : '这一次，月路关闭了。'}</h1>
        <p>{causalBeat(state)}</p>
        <dl className="result-stats">
          <div>
            <dt>结果</dt>
            <dd>{won ? '成功撤离' : state.phase === 'timeout' ? '时间结束' : '追逃失败'}</dd>
          </div>
          <div>
            <dt>光核</dt>
            <dd>{state.objectives.filter((objective) => objective.collected).length} / 3</dd>
          </div>
          <div>
            <dt>时间</dt>
            <dd>{(state.tick / 4).toFixed(1)} 秒</dd>
          </div>
        </dl>
        {/* Win reward drop (reward-economy §3): a credited撤离 lands a +5 ✦ 星芒
            beat; a capped daily quota reads a muted note; duplicate / absent =
            nothing. Star mark rides brand yellow, not the moon-blue accent. */}
        {won && reward?.status === 'credited' && (
          <div className="result-reward" role="status" aria-label="撤离奖励">
            <span className="result-reward-amount">
              +{reward.amount} {STARBURST_GLYPH}
            </span>
            <span className="result-reward-label">{STARBURST_LABEL}</span>
          </div>
        )}
        {won && reward?.status === 'capped' && (
          <p className="result-reward-capped">今日过关奖励已满</p>
        )}
        <Button variant="primary" full onClick={onRestart}>
          再玩一次
        </Button>
      </section>
    </main>
  )
}
