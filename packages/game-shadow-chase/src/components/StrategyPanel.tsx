import type { CompanionIntent, SimulationState } from '../engine/types'
import type { ShadowVoiceView } from '../voice/useShadowChaseVoice'

const STRATEGIES: Array<{ intent: CompanionIntent; label: string; effect: string }> = [
  { intent: 'follow', label: '跟随', effect: '伙伴保持在你附近，优先协助救援和共同撤离。' },
  { intent: 'split', label: '分头', effect: '伙伴选择另一条路线收集光核，扩大行动范围。' },
  { intent: 'decoy', label: '诱敌', effect: '伙伴主动吸引追兵，为你腾出移动空间。' },
]

const VOICE_STATUS: Record<ShadowVoiceView['status'], string> = {
  unavailable: '按钮模式',
  checking: '正在确认语音资格',
  available: '可以开启语音',
  ready: '语音已就绪',
  connecting: '语音连接中',
  listening: '正在聆听',
  thinking: '伙伴思考中',
  speaking: '伙伴说话中',
  error: '语音不可用，已切换按钮',
  closed: '语音已结束，按钮仍可用',
}

function strategy(intent: CompanionIntent) {
  return STRATEGIES.find((candidate) => candidate.intent === intent) ?? STRATEGIES[0]
}

export function StrategyPanel({
  state,
  activeIntent,
  planning,
  voice,
  onStrategy,
  onSwap,
}: {
  state: SimulationState
  activeIntent: CompanionIntent
  planning: boolean
  voice: ShadowVoiceView
  onStrategy(intent: CompanionIntent): void
  onSwap(): void
}) {
  const active = strategy(activeIntent)
  const recommendation = state.activeModelLease
    ? strategy(state.activeModelLease.intent).label
    : '确定性伙伴会根据追兵与救援状态自行判断'
  const swapTicks = Math.max(0, state.cooldowns.swapReadyTick - state.tick)
  const swapDisabled =
    planning ||
    swapTicks > 0 ||
    state.actors.player.status === 'captured' ||
    state.actors.companion.status === 'captured'

  return (
    <section className="strategy-panel" aria-label="伙伴策略">
      <div>
        <span className="strategy-label">当前策略</span>
        <strong className="strategy-current">{active.label}</strong>
        <p className="strategy-effect">{active.effect}</p>
      </div>
      <div className="command-row" aria-label="选择伙伴策略">
        {STRATEGIES.map((item) => (
          <button
            key={item.intent}
            className="command-button"
            type="button"
            aria-pressed={activeIntent === item.intent}
            onClick={() => onStrategy(item.intent)}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div className="strategy-recommendation">
        <span className="strategy-label">伙伴建议 / 回应</span>
        <p>{recommendation}</p>
      </div>
      <div className="voice-strategy" aria-label="伙伴语音">
        <span className="strategy-label">语音 · {VOICE_STATUS[voice.status]}</span>
        {voice.stop ? (
          <button type="button" className="voice-control" onClick={voice.stop}>
            停止伙伴语音
          </button>
        ) : voice.start ? (
          <button type="button" className="voice-control" onClick={voice.start}>
            开启伙伴语音
          </button>
        ) : null}
        <p>
          <strong>你说的话：</strong>
          {voice.playerTranscript || '可使用“跟着我”“分头行动”“去诱敌”明确下令。'}
        </p>
        <p>
          <strong>伙伴字幕：</strong>
          {voice.companionText || '语音不可用时，策略按钮仍然完整可用。'}
        </p>
        {voice.commandResult?.kind === 'clarify' && (
          <p className="voice-clarify">请只说一种明确策略：跟随、分头或诱敌。</p>
        )}
        {voice.statusMessage && <p className="voice-status-message">{voice.statusMessage}</p>}
      </div>
      <button
        className="swap-button"
        type="button"
        disabled={swapDisabled}
        aria-describedby="swap-reason"
        onClick={onSwap}
      >
        交换位置
      </button>
      <span id="swap-reason" className="control-reason">
        {planning
          ? '追逃开始后才能交换。'
          : swapTicks > 0
            ? `交换冷却还剩 ${(swapTicks / 4).toFixed(1)} 秒。`
            : swapDisabled
              ? '双方都未被捕获时才能交换。'
              : '现在可以交换位置。'}
      </span>
    </section>
  )
}
