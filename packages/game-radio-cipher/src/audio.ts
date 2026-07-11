/**
 * Radio transmission audio: a WebAudio static-noise bed running in PARALLEL
 * with speechSynthesis speaking the ciphered syllables' anchor 汉字.
 *
 * Two hard constraints from the platform probe (both verified upstream):
 *  - speechSynthesis cannot pronounce pinyin, so the caller passes anchor 汉字.
 *  - speechSynthesis output cannot be routed through WebAudio, so the static
 *    bed is an independent track (started with playback, stopped after), NOT a
 *    filter over the voice.
 *
 * Everything is created lazily on the first user gesture (the 收听 click), so
 * the AudioContext starts un-suspended and no autoplay policy is tripped.
 */

const NOISE_LEVEL = 0.05
const BURST_LEVEL = 0.16
/** Gap between spoken syllables — the transmission cadence. */
const SYLLABLE_GAP_MS = 320

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export class RadioAudio {
  private ctx: AudioContext | null = null
  private noiseBuffer: AudioBuffer | null = null
  private noiseSource: AudioBufferSourceNode | null = null
  private noiseGain: GainNode | null = null
  private token = 0

  private context(): AudioContext {
    if (!this.ctx) {
      const Ctor: typeof AudioContext =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      this.ctx = new Ctor()
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume()
    return this.ctx
  }

  /** A one-second looping white-noise buffer, built once and reused. */
  private buffer(ctx: AudioContext): AudioBuffer {
    if (!this.noiseBuffer) {
      const frames = ctx.sampleRate
      const buffer = ctx.createBuffer(1, frames, ctx.sampleRate)
      const data = buffer.getChannelData(0)
      for (let i = 0; i < frames; i += 1) data[i] = Math.random() * 2 - 1
      this.noiseBuffer = buffer
    }
    return this.noiseBuffer
  }

  private startStatic(): void {
    const ctx = this.context()
    this.stopStatic()
    const source = ctx.createBufferSource()
    source.buffer = this.buffer(ctx)
    source.loop = true
    // A lowpass softens the white noise into a warmer radio hiss.
    const filter = ctx.createBiquadFilter()
    filter.type = 'lowpass'
    filter.frequency.value = 2200
    const gain = ctx.createGain()
    gain.gain.setValueAtTime(0, ctx.currentTime)
    gain.gain.linearRampToValueAtTime(NOISE_LEVEL, ctx.currentTime + 0.08)
    source.connect(filter).connect(gain).connect(ctx.destination)
    source.start()
    this.noiseSource = source
    this.noiseGain = gain
  }

  private stopStatic(): void {
    if (this.noiseGain && this.ctx) {
      this.noiseGain.gain.cancelScheduledValues(this.ctx.currentTime)
      this.noiseGain.gain.linearRampToValueAtTime(0, this.ctx.currentTime + 0.12)
    }
    const source = this.noiseSource
    if (source) {
      try {
        source.stop((this.ctx?.currentTime ?? 0) + 0.14)
      } catch {
        // already stopped
      }
    }
    this.noiseSource = null
    this.noiseGain = null
  }

  private speakOne(hanzi: string): Promise<void> {
    return new Promise((resolve) => {
      if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
        // No TTS available: hold the cadence so the static bed still reads.
        setTimeout(resolve, 500)
        return
      }
      const utterance = new SpeechSynthesisUtterance(hanzi)
      utterance.lang = 'zh-CN'
      utterance.rate = 0.85
      utterance.pitch = 0.9
      let settled = false
      const done = () => {
        if (settled) return
        settled = true
        resolve()
      }
      utterance.onend = done
      utterance.onerror = done
      // Safety net if neither event fires.
      setTimeout(done, 4000)
      window.speechSynthesis.speak(utterance)
    })
  }

  /** Speak each anchor 汉字 in order over the static bed, then stop the bed. */
  async playCiphered(anchors: string[]): Promise<void> {
    this.stop()
    const myToken = (this.token += 1)
    this.startStatic()
    for (let i = 0; i < anchors.length; i += 1) {
      if (this.token !== myToken) return
      await this.speakOne(anchors[i])
      if (this.token !== myToken) return
      if (i < anchors.length - 1) await delay(SYLLABLE_GAP_MS)
    }
    if (this.token === myToken) this.stopStatic()
  }

  /** A short, louder static burst — the wrong-answer feedback cue. */
  burst(): void {
    const ctx = this.context()
    const source = ctx.createBufferSource()
    source.buffer = this.buffer(ctx)
    source.loop = true
    const gain = ctx.createGain()
    gain.gain.setValueAtTime(BURST_LEVEL, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.28)
    source.connect(gain).connect(ctx.destination)
    source.start()
    source.stop(ctx.currentTime + 0.3)
  }

  /** Cancel any in-flight speech + static (invalidates the current playback). */
  stop(): void {
    this.token += 1
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel()
    }
    this.stopStatic()
  }
}
