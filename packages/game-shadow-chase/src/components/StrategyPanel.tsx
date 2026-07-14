import { IconButton } from '@amiclaw/ui'
import {
  STARBURST_DEPLETED_FAREWELL,
  STARBURST_EARN_CTA_LABEL,
  STARBURST_INSUFFICIENT_LEAD,
} from '@shared/reward-types'

import type { CompanionIntent, SimulationState } from '../engine/types'
import type { ShadowVoiceView } from '../voice/useShadowChaseVoice'
import { MicrophoneIcon, StopIcon, StrategyIcon, SwapIcon } from './ShadowChaseIcons'

const STRATEGIES: Array<{ intent: CompanionIntent; label: string; effect: string }> = [
  { intent: 'support', label: '接应', effect: '伙伴保持在你附近，缩短被捕后的救援路线。' },
  { intent: 'scout', label: '探路', effect: '伙伴前往下一枚光核附近，为你的收集路线预先站位。' },
  { intent: 'anchor', label: '架点', effect: '伙伴远离你建立换位落点，但救援赶路更久。' },
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
  const swapDisabled =
    planning ||
    state.swapCharges === 0 ||
    state.actors.player.status === 'captured' ||
    state.actors.companion.status === 'captured'

  return (
    <section className="strategy-panel" aria-label="伙伴策略">
      <div className="companion-presence">
        <span className="companion-dot" aria-hidden="true" />
        <strong>伙伴 · {active.label}</strong>
        <span className="voice-state">{VOICE_STATUS[voice.status]}</span>
        {voice.stop ? (
          <IconButton label="停止伙伴语音" variant="bare" onClick={voice.stop}>
            <StopIcon />
          </IconButton>
        ) : voice.start ? (
          <IconButton label="开启伙伴语音" variant="bare" onClick={voice.start}>
            <MicrophoneIcon />
          </IconButton>
        ) : null}
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
            <StrategyIcon intent={item.intent} />
            <span>{item.label}</span>
          </button>
        ))}
      </div>
      {planning && <p className="strategy-effect">{active.effect}</p>}
      {(state.activeModelLease || voice.playerTranscript || voice.companionText) && (
        <div className="companion-caption" aria-label="伙伴建议与语音字幕">
          <span>{recommendation}</span>
          {voice.playerTranscript && <span>你：{voice.playerTranscript}</span>}
          {voice.companionText && <span>伙伴：{voice.companionText}</span>}
        </div>
      )}
      <div className="voice-feedback" aria-live="polite">
        {voice.commandResult?.kind === 'clarify' && (
          <p className="voice-clarify">请只说一种明确策略：接应、探路或架点。</p>
        )}
        {/* Insufficient-balance intercept (reward-economy §5): the pricing gate
            refused the voice open. A warm narrative line + an earn CTA, not a raw
            server error. The socket closes right after, so this persists on the
            stored errorCode regardless of the mapped status. */}
        {voice.errorCode === 'insufficient-balance' ? (
          <div className="voice-intercept" role="status">
            <p>{STARBURST_INSUFFICIENT_LEAD}策略按钮照常可用。</p>
            <a className="voice-intercept-cta" href="/">
              {STARBURST_EARN_CTA_LABEL}
              <span aria-hidden="true"> →</span>
            </a>
          </div>
        ) : (
          voice.status === 'error' &&
          voice.statusMessage && <p className="voice-status-message">{voice.statusMessage}</p>
        )}
        {/* Mid-session depletion farewell (reward-economy §5 wind-down). */}
        {voice.sessionReason === 'balance-depleted' && (
          <p className="voice-farewell" role="status">
            {STARBURST_DEPLETED_FAREWELL}
          </p>
        )}
      </div>
      <button
        className="swap-button"
        type="button"
        disabled={swapDisabled}
        aria-keyshortcuts="Space"
        aria-describedby="swap-reason"
        onClick={onSwap}
      >
        <SwapIcon />
        交换位置 · {state.swapCharges}
      </button>
      <span id="swap-reason" className="control-reason">
        {planning
          ? '追逃开始后'
          : state.swapCharges === 0
            ? '收集光核获得换位'
            : swapDisabled
              ? '双方都未被捕获时才能交换。'
              : `现在可交换 ${state.swapCharges} 次；按空格可快速交换。`}
      </span>
    </section>
  )
}
