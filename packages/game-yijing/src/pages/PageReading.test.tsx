import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SessionProvider } from '../session'
import { PageReading } from './PageReading'

/* PageReading 解卦 — staged classical-text reveal.

   The former cold-reading screen fabricated an AI guess and, after the player
   tapped「不太对」, a user-voice line the player never spoke. The rework
   replaced that with a paced reveal of manual data only:
     stage 0 — 本卦 卦辞 + 卦象
     stage 1 — + 变爻 爻辞 (demo cast: 九三)
     stage 2 — + 变卦 卦辞 + sign CTA
   The demo fallback cast is 同人 #13 → 无妄 #25 with 九三 changing. */

// The fabricated user-voice line that the ✗ branch used to inject — must
// never render anywhere in the flow again.
const FABRICATED_USER_LINE = '「不是关系本身，而是『要不要继续往前走』。」'

function renderPage() {
  return render(
    <SessionProvider>
      <MemoryRouter>
        <PageReading />
      </MemoryRouter>
    </SessionProvider>
  )
}

const advance = () => fireEvent.click(screen.getByRole('button', { name: '继续 · 往下读 →' }))

describe('PageReading staged reveal', () => {
  beforeEach(() => sessionStorage.clear())
  afterEach(cleanup)

  it('stage 0 shows the 本卦 judgment and image, nothing beyond', () => {
    renderPage()

    expect(screen.getByText('同人于野，亨。利涉大川，利君子贞。')).toBeTruthy()
    expect(screen.getByText('天与火，同人；君子以类族辨物。')).toBeTruthy()
    expect(screen.queryByText(/伏戎于莽/)).toBeNull()
    expect(screen.queryByText(/无妄，元亨/)).toBeNull()
    expect(screen.queryByRole('button', { name: '生成今日卦签 →' })).toBeNull()
  })

  it('offers no fake-dialogue confirm buttons and never renders a fabricated user line', () => {
    renderPage()

    expect(screen.queryByRole('button', { name: /不太对/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /差不多/ })).toBeNull()
    expect(screen.queryByText(FABRICATED_USER_LINE)).toBeNull()

    advance()
    advance()

    expect(screen.queryByText(FABRICATED_USER_LINE)).toBeNull()
  })

  it('reveals the changing-line text on the first 继续', () => {
    renderPage()
    advance()

    expect(screen.getByText('变爻 · 九三')).toBeTruthy()
    expect(screen.getByText('伏戎于莽，升其高陵，三岁不兴。')).toBeTruthy()
    expect(screen.queryByText(/无妄，元亨/)).toBeNull()
  })

  it('reveals the 变卦 judgment on the second 继续 and offers the sign CTA', () => {
    renderPage()
    advance()
    advance()

    expect(screen.getByText('无妄，元亨，利贞。其匪正有眚，不利有攸往。')).toBeTruthy()
    expect(screen.getByRole('button', { name: '生成今日卦签 →' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: '继续 · 往下读 →' })).toBeNull()
  })
})
