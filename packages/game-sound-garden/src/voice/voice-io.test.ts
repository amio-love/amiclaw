import { afterEach, describe, expect, it, vi } from 'vitest'
import { createVoice, NullVoice } from './voice-io'

const win = window as unknown as Record<string, unknown>
const glob = globalThis as unknown as Record<string, unknown>

class FakeRecognition {
  lang = ''
  continuous = false
  interimResults = false
  onresult: (() => void) | null = null
  onerror: (() => void) | null = null
  onend: (() => void) | null = null
  start(): void {}
  stop(): void {}
  abort(): void {}
}

class FakeUtterance {
  lang = ''
  onend: (() => void) | null = null
  onerror: (() => void) | null = null
  constructor(public text: string) {}
}

afterEach(() => {
  delete win.webkitSpeechRecognition
  delete win.speechSynthesis
  delete glob.SpeechSynthesisUtterance
  vi.unstubAllGlobals()
})

describe('createVoice (anon browser voice)', () => {
  it('returns NullVoice with nothing available (no browser support)', () => {
    const voice = createVoice()
    expect(voice).toBeInstanceOf(NullVoice)
    expect(voice.canListen).toBe(false)
  })

  it('exposes canListen when Web Speech ASR is available', () => {
    win.webkitSpeechRecognition = FakeRecognition
    const voice = createVoice()
    expect(voice.canListen).toBe(true)
  })

  it('speaks via browser speechSynthesis when supported', async () => {
    const synthSpeak = vi.fn((utterance: FakeUtterance) => utterance.onend?.())
    win.speechSynthesis = { speak: synthSpeak, cancel: vi.fn() }
    glob.SpeechSynthesisUtterance = FakeUtterance

    const voice = createVoice()
    await voice.speak('你好')

    expect(synthSpeak).toHaveBeenCalled()
  })

  it('cancels in-flight speech on visibilitychange → hidden (background-tab catch-up guard)', () => {
    const cancel = vi.fn()
    win.speechSynthesis = { speak: vi.fn(), cancel }
    glob.SpeechSynthesisUtterance = FakeUtterance
    createVoice()
    // Simulate backgrounding: document.hidden true + the event fires.
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true })
    document.dispatchEvent(new Event('visibilitychange'))
    expect(cancel).toHaveBeenCalled()
  })
})
