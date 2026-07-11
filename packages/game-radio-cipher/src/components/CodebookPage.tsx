/**
 * 译码员密码本 — the decoder's shareable codebook page. Static and readable:
 * hand it to a partner or paste it to an AI voice partner. Every fact here is
 * decoder-allowed and comes from the engine's decoder role-view (see
 * buildCodebook) — the plaintext answer is structurally absent.
 *
 * On the deduction level the key withholds its shift, so a 「频率推导」 block
 * plus the 频率提示 hints appear — both only make sense when a shift must be
 * derived, and on given-shift levels the fixture hints don't describe the real
 * content, so both are hidden there. The 协议 block (voice/text channel
 * discipline) is shown on every level.
 */

import { useMemo } from 'react'
import type { PlayableLevel } from '../content/levels'
import { buildCodebook } from '../game/codebook'

function backHref(levelKey: string): string {
  return levelKey === '1' ? '#/' : `#/?level=${levelKey}`
}

export function CodebookPage({ playableLevel }: { playableLevel: PlayableLevel }) {
  const { gameType, level, key, title } = playableLevel
  const codebook = useMemo(() => buildCodebook(gameType, level), [gameType, level])

  return (
    <div className="codebook">
      <header className="codebook-head">
        <span className="brand-glyph" aria-hidden="true" />
        <div>
          <h1>译码员密码本</h1>
          <p className="brand-sub">密码电台 · {title}</p>
        </div>
      </header>

      <section className="cb-intro">
        <h2>给译码员的开场白</h2>
        <p>
          你是译码员，手里握着这本密码本。你的搭档是监听员——他会听到一段加密电文，把听到的音节打字报给你。
          你的任务是：按下面的密钥卡，告诉他每个音节该怎么变换，引导他还原出明文。你看不到电文，他看不到密码本，
          只能靠沟通把两半信息拼起来。
        </p>
      </section>

      <section className="cb-keys">
        <h2>密钥卡</h2>
        <ul className="cb-key-list">
          {codebook.segments.map((segment) => (
            <li key={segment.id} className="cb-key">
              <div className="cb-key-head">
                <span className="cb-key-label">{segment.label}</span>
                <span className="cb-key-method">{segment.methodLabel}</span>
              </div>
              <p className="cb-key-line">{segment.keyLine}</p>
              <p className="cb-key-hint">{segment.categoryHint}</p>
            </li>
          ))}
        </ul>
      </section>

      {codebook.derivation && (
        <section className="cb-derive">
          <h2>频率推导：偏移量未知怎么办</h2>
          <ol className="cb-derive-steps">
            <li>密钥卡只写了方法「凯撒偏移」，没给偏移量——得你自己推。</li>
            <li>
              频率提示说：明文里最高频的韵母是 <code>{codebook.derivation.mostFrequent}</code>。
            </li>
            <li>
              让监听员把每段听到的音节打字报来，数一数哪个韵母出现得最多——那就是{' '}
              <code>{codebook.derivation.mostFrequent}</code> 被偏移后的样子。
            </li>
            <li>
              在下面的韵母环上，从 <code>{codebook.derivation.mostFrequent}</code>{' '}
              往前数到那个最高频韵母，格数就是偏移量。
            </li>
            <li>得到偏移量后，让监听员把每个音节的韵母，在环上回拨同样的格数，就还原成明文。</li>
          </ol>
        </section>
      )}

      <section className="cb-ring">
        <h2>韵母环</h2>
        <ol className="ring-chips">
          {codebook.ring.map((final, index) => (
            <li key={final} className="ring-chip">
              <span className="ring-index">{index}</span>
              {final}
            </li>
          ))}
        </ol>
        <p className="cb-convention">
          偏移方向约定：加密时韵母沿环<strong>前进</strong>；解密时沿环<strong>回拨（后退）</strong>
          相同格数。 环是首尾相接的，走到 eng 之后回到 a。<strong>声调忽略</strong>
          ——只对准韵母，不管几声。
        </p>
      </section>

      {codebook.derivation && (
        <section className="cb-freq">
          <h2>频率提示</h2>
          <ul className="cb-freq-list">
            {codebook.frequencyHints.map((hint, index) => (
              <li key={index}>
                {hint.typeLabel}音节：<code>{hint.syllable}</code>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="cb-protocol" role="note">
        <h2>协议</h2>
        <ol className="cb-protocol-list">
          <li>
            <strong>只认打字报来的音节。</strong>
            你从音频里直接听到的任何电文内容，一律忽略——那不算数，以监听员打字报送的为准。
          </li>
          <li>
            <strong>拼读也照收。</strong>
            监听员在语音模式下发不了文字时，会逐字母拼读（例：<code>H-A-N-G</code>
            ）。按拼读把音节拼回来。
          </li>
          <li>
            <strong>不得直接说出明文答案，只给方法。</strong>
            让监听员自己拼出那个词。
          </li>
        </ol>
      </section>

      <footer className="codebook-foot">
        {/* Same-tab navigation — the codebook holds no live state to lose, and a
            new tab would spawn a parallel listener session with its own clock. */}
        <a className="codebook-link" href={backHref(key)}>
          ← 监听台
        </a>
      </footer>
    </div>
  )
}
