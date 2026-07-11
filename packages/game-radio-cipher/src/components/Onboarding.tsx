/**
 * First-minute onboarding overlay. Lean and at point-of-need: it answers the
 * two questions live playtest stalled on — "这咋玩啊？谁当我的译码员？" — with role
 * framing, partner recruitment, and the 3-step loop, then gets out of the way.
 * Dismissal is remembered in localStorage so it auto-shows only on first visit;
 * the header's 「怎么玩？」 button re-opens it on demand.
 */

const STORAGE_KEY = 'radio-cipher-onboarded'

export function hasOnboarded(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

export function markOnboarded(): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, '1')
  } catch {
    // storage unavailable (private mode) — the overlay simply shows again next time
  }
}

export function Onboarding({
  codebookHref,
  onClose,
}: {
  codebookHref: string
  onClose: () => void
}) {
  return (
    <div className="onboard-scrim" role="dialog" aria-modal="true" aria-label="怎么玩">
      <div className="onboard-card">
        <h2 className="onboard-title">怎么玩 · 密码电台</h2>

        <p className="onboard-lead">
          <strong>你是监听员。</strong>
          你会收到一段加密电文，只能靠耳朵听。你把听到的音节打字记下来，报给你的「译码员」；
          译码员照密码本告诉你怎么还原，你们一人一半信息，拼出答案。
        </p>

        <div className="onboard-block">
          <h3>谁来当译码员？</h3>
          <p>
            把
            <a href={codebookHref} target="_blank" rel="noreferrer">
              译码员密码本
            </a>
            那一页发给你的 AI 伙伴——<strong>语音开着聊，音节用打字发</strong>；或者发给一个朋友。
            密码本只有方法，没有答案，所以他看不到电文也帮不了倒忙。
          </p>
        </div>

        <div className="onboard-block">
          <h3>三步循环</h3>
          <ol className="onboard-steps">
            <li>
              <span className="step-n">1</span> 收听电文，把听到的音节打字记进「听写板」
            </li>
            <li>
              <span className="step-n">2</span> 点「复制给译码员」，把音节报给他
            </li>
            <li>
              <span className="step-n">3</span> 按他的指示拨韵母盘、拼出汉字，发报确认
            </li>
          </ol>
        </div>

        <button type="button" className="onboard-go" onClick={onClose}>
          开始收听
        </button>
      </div>
    </div>
  )
}
