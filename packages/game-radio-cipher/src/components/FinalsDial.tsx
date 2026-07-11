/**
 * 韵母拨盘 — the finals dial. A standalone helper tool: the player types the
 * 声母 (initial) they heard, clicks the 韵母 (final) they heard on the ring,
 * then rotates the dial +/- N steps. The recombined syllable (initial +
 * shifted final) is shown live. It deliberately does NOT auto-solve — the
 * player rotates by the amount the decoder instructs.
 *
 * The needle sweep is a CSS transform transition (no JS animation library).
 */

import { useState } from 'react'
import { FINALS_RING, shiftFinal, type Final } from '../codec/finals-ring'

const STEP_ANGLE = 360 / FINALS_RING.length
const RADIUS = 104

export function FinalsDial() {
  const [initial, setInitial] = useState('')
  const [heardIndex, setHeardIndex] = useState(0)
  const [shift, setShift] = useState(0)

  const heardFinal = FINALS_RING[heardIndex]
  const resultIndex =
    (((heardIndex + shift) % FINALS_RING.length) + FINALS_RING.length) % FINALS_RING.length
  const resultFinal: Final = shiftFinal(heardFinal, shift)
  const recombined = `${initial}${resultFinal}`

  const selectFinal = (index: number) => {
    setHeardIndex(index)
    setShift(0)
  }

  return (
    <section className="dial" aria-label="韵母拨盘">
      <header className="dial-head">
        <h3>韵母拨盘</h3>
        <label className="dial-initial">
          声母
          <input
            value={initial}
            maxLength={2}
            placeholder="如 h"
            onChange={(event) => setInitial(event.target.value.trim().toLowerCase())}
          />
        </label>
      </header>

      <div className="dial-ring" role="group" aria-label="韵母环">
        <div
          className="dial-needle"
          style={{ transform: `rotate(${resultIndex * STEP_ANGLE}deg)` }}
          aria-hidden="true"
        />
        <div className="dial-hub">
          <span className="dial-recombined">{recombined || '—'}</span>
          <span className="dial-sub">
            {heardFinal} → {resultFinal}
          </span>
        </div>
        {FINALS_RING.map((final, index) => {
          const angle = index * STEP_ANGLE
          const state = index === resultIndex ? 'result' : index === heardIndex ? 'heard' : 'idle'
          return (
            <button
              key={final}
              type="button"
              className={`dial-final dial-final-${state}`}
              style={{
                transform: `translate(-50%, -50%) rotate(${angle}deg) translateY(-${RADIUS}px) rotate(${-angle}deg)`,
              }}
              aria-pressed={index === heardIndex}
              onClick={() => selectFinal(index)}
            >
              {final}
            </button>
          )
        })}
      </div>

      <div className="dial-controls">
        <button type="button" onClick={() => setShift((value) => value - 1)}>
          −1 回拨
        </button>
        <button type="button" onClick={() => setShift((value) => value - 3)}>
          −3
        </button>
        <span className="dial-shift">
          {shift === 0 ? '未偏移' : `${shift > 0 ? '前进' : '回拨'} ${Math.abs(shift)} 格`}
        </span>
        <button type="button" onClick={() => setShift((value) => value + 3)}>
          +3
        </button>
        <button type="button" onClick={() => setShift((value) => value + 1)}>
          +1 前进
        </button>
      </div>
      <p className="dial-hint">
        点选你听到的韵母，输入声母，再按译码员的指示拨动。拨盘只是工具，不会替你解密。
      </p>
    </section>
  )
}
