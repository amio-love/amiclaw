/**
 * Web Audio engine — 8 synthesized voices + an 8-step lookahead scheduler,
 * lifted from the validated rough-cut recipe (distinctness beats realism;
 * fixed pentatonic melody pitches so any combination sounds musical).
 *
 * The AudioContext is created lazily on the first user gesture (iOS unlock).
 * When Web Audio is unavailable the loop degrades gracefully to a visual-only
 * playhead so placement + scoring stay fully playable.
 */

import { PIECE_META } from '../game/constants'
import type { MelodyType, PieceType, RhythmType } from '../game/constants'

interface AudioNodes {
  ctx: AudioContext
  master: GainNode
  noise: AudioBuffer
}

const STEP_SEC = 60 / 96 / 2 // ~96 BPM eighth-note grid → 0.3125s/step, 2.5s loop
const LOOKAHEAD = 0.1
const SCHED_MS = 25

function noiseSource(n: AudioNodes): AudioBufferSourceNode {
  const s = n.ctx.createBufferSource()
  s.buffer = n.noise
  return s
}

// ---- rhythm voices ---------------------------------------------------------

function playKick(n: AudioNodes, t: number): void {
  const o = n.ctx.createOscillator()
  const g = n.ctx.createGain()
  o.type = 'sine'
  o.frequency.setValueAtTime(160, t)
  o.frequency.exponentialRampToValueAtTime(48, t + 0.13)
  g.gain.setValueAtTime(0.0001, t)
  g.gain.exponentialRampToValueAtTime(1.0, t + 0.006)
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.28)
  o.connect(g)
  g.connect(n.master)
  o.start(t)
  o.stop(t + 0.3)
}

function playSnare(n: AudioNodes, t: number): void {
  const s = noiseSource(n)
  const bp = n.ctx.createBiquadFilter()
  const g = n.ctx.createGain()
  bp.type = 'bandpass'
  bp.frequency.value = 1800
  bp.Q.value = 0.8
  g.gain.setValueAtTime(0.0001, t)
  g.gain.exponentialRampToValueAtTime(0.7, t + 0.005)
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2)
  s.connect(bp)
  bp.connect(g)
  g.connect(n.master)
  s.start(t)
  s.stop(t + 0.22)
  const o = n.ctx.createOscillator()
  const og = n.ctx.createGain()
  o.type = 'triangle'
  o.frequency.value = 190
  og.gain.setValueAtTime(0.0001, t)
  og.gain.exponentialRampToValueAtTime(0.25, t + 0.005)
  og.gain.exponentialRampToValueAtTime(0.0001, t + 0.12)
  o.connect(og)
  og.connect(n.master)
  o.start(t)
  o.stop(t + 0.14)
}

function playHihat(n: AudioNodes, t: number): void {
  const s = noiseSource(n)
  const hp = n.ctx.createBiquadFilter()
  const g = n.ctx.createGain()
  hp.type = 'highpass'
  hp.frequency.value = 7000
  g.gain.setValueAtTime(0.0001, t)
  g.gain.exponentialRampToValueAtTime(0.35, t + 0.002)
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.06)
  s.connect(hp)
  hp.connect(g)
  g.connect(n.master)
  s.start(t)
  s.stop(t + 0.07)
}

function playClap(n: AudioNodes, t: number): void {
  const offs = [0, 0.012, 0.026]
  offs.forEach((off, i) => {
    const s = noiseSource(n)
    const bp = n.ctx.createBiquadFilter()
    const g = n.ctx.createGain()
    bp.type = 'bandpass'
    bp.frequency.value = 1200
    bp.Q.value = 1.0
    const tt = t + off
    const dur = i === 2 ? 0.15 : 0.05
    g.gain.setValueAtTime(0.0001, tt)
    g.gain.exponentialRampToValueAtTime(i === 2 ? 0.5 : 0.3, tt + 0.002)
    g.gain.exponentialRampToValueAtTime(0.0001, tt + dur)
    s.connect(bp)
    bp.connect(g)
    g.connect(n.master)
    s.start(tt)
    s.stop(tt + dur + 0.02)
  })
}

// ---- melody voices (fixed pentatonic pitches) ------------------------------

function playBell(n: AudioNodes, t: number, f: number): void {
  const o = n.ctx.createOscillator()
  const g = n.ctx.createGain()
  o.type = 'triangle'
  o.frequency.value = f
  g.gain.setValueAtTime(0.0001, t)
  g.gain.exponentialRampToValueAtTime(0.5, t + 0.008)
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.9)
  o.connect(g)
  g.connect(n.master)
  o.start(t)
  o.stop(t + 0.92)
  const o2 = n.ctx.createOscillator()
  const g2 = n.ctx.createGain()
  o2.type = 'triangle'
  o2.frequency.value = f * 2.01
  g2.gain.setValueAtTime(0.0001, t)
  g2.gain.exponentialRampToValueAtTime(0.18, t + 0.008)
  g2.gain.exponentialRampToValueAtTime(0.0001, t + 0.5)
  o2.connect(g2)
  g2.connect(n.master)
  o2.start(t)
  o2.stop(t + 0.52)
}

function playChime(n: AudioNodes, t: number, f: number): void {
  const car = n.ctx.createOscillator()
  const cg = n.ctx.createGain()
  const mod = n.ctx.createOscillator()
  const mg = n.ctx.createGain()
  car.type = 'sine'
  car.frequency.value = f
  mod.type = 'sine'
  mod.frequency.value = f * 2.76
  mg.gain.setValueAtTime(f * 3, t)
  mg.gain.exponentialRampToValueAtTime(f * 0.4, t + 0.6)
  mod.connect(mg)
  mg.connect(car.frequency)
  cg.gain.setValueAtTime(0.0001, t)
  cg.gain.exponentialRampToValueAtTime(0.4, t + 0.01)
  cg.gain.exponentialRampToValueAtTime(0.0001, t + 1.1)
  car.connect(cg)
  cg.connect(n.master)
  mod.start(t)
  car.start(t)
  mod.stop(t + 1.12)
  car.stop(t + 1.12)
}

function playFlute(n: AudioNodes, t: number, f: number): void {
  const o = n.ctx.createOscillator()
  const g = n.ctx.createGain()
  o.type = 'sine'
  o.frequency.value = f
  const lfo = n.ctx.createOscillator()
  const lg = n.ctx.createGain()
  lfo.frequency.value = 5
  lg.gain.value = 4
  lfo.connect(lg)
  lg.connect(o.frequency)
  g.gain.setValueAtTime(0.0001, t)
  g.gain.linearRampToValueAtTime(0.34, t + 0.09)
  g.gain.setValueAtTime(0.34, t + 0.34)
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.7)
  o.connect(g)
  g.connect(n.master)
  lfo.start(t)
  o.start(t)
  lfo.stop(t + 0.72)
  o.stop(t + 0.72)
}

function playHarp(n: AudioNodes, t: number, f: number): void {
  const notes: [number, number, number][] = [
    [f * 0.75, 0, 0.18],
    [f, 0.03, 0.5],
  ]
  notes.forEach(([freq, off, dur]) => {
    const o = n.ctx.createOscillator()
    const g = n.ctx.createGain()
    o.type = 'triangle'
    o.frequency.value = freq
    const tt = t + off
    g.gain.setValueAtTime(0.0001, tt)
    g.gain.exponentialRampToValueAtTime(0.4, tt + 0.004)
    g.gain.exponentialRampToValueAtTime(0.0001, tt + dur)
    o.connect(g)
    g.connect(n.master)
    o.start(tt)
    o.stop(tt + dur + 0.02)
  })
}

function playVoice(n: AudioNodes, type: PieceType, t: number): void {
  switch (type) {
    case 'kick':
      return playKick(n, t)
    case 'snare':
      return playSnare(n, t)
    case 'hihat':
      return playHihat(n, t)
    case 'clap':
      return playClap(n, t)
    case 'bell':
    case 'chime':
    case 'flute':
    case 'harp': {
      const f = PIECE_META[type].freq ?? 440
      if (type === 'bell') return playBell(n, t, f)
      if (type === 'chime') return playChime(n, t, f)
      if (type === 'flute') return playFlute(n, t, f)
      return playHarp(n, t, f)
    }
  }
}

export interface LoopStep {
  rhythm: RhythmType | null
  melody: MelodyType | null
}

export interface LoopOptions {
  /** Pieces at a given 0-based step, read fresh each step (live board). */
  getStep: (step: number) => LoopStep
  /** Fires as the visual playhead reaches each step. */
  onStep: (step: number) => void
}

export class AudioEngine {
  private nodes: AudioNodes | null = null
  private enabled: boolean | null = null
  private playing = false
  private currentStep = 0
  private nextNoteTime = 0
  private schedTimer: ReturnType<typeof setInterval> | null = null
  private visualTimer: ReturnType<typeof setInterval> | null = null
  private rafId: number | null = null
  private queue: { step: number; time: number }[] = []
  private options: LoopOptions | null = null

  /** True once Web Audio is confirmed available; false when it failed. */
  get available(): boolean {
    return this.enabled === true
  }

  /** True while it is known Web Audio could not initialize. */
  get unavailable(): boolean {
    return this.enabled === false
  }

  get isPlaying(): boolean {
    return this.playing
  }

  /** Lazily create the AudioContext on a user gesture. Returns whether audio works. */
  ensure(): boolean {
    if (this.enabled !== null) {
      if (this.enabled && this.nodes && this.nodes.ctx.state === 'suspended') {
        void this.nodes.ctx.resume()
      }
      return this.enabled
    }
    try {
      const AC =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (!AC) throw new Error('no AudioContext')
      const ctx = new AC()
      const master = ctx.createGain()
      master.gain.value = 0.55
      master.connect(ctx.destination)
      const len = Math.floor(ctx.sampleRate * 1.0)
      const noise = ctx.createBuffer(1, len, ctx.sampleRate)
      const data = noise.getChannelData(0)
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1
      if (ctx.state === 'suspended') void ctx.resume()
      this.nodes = { ctx, master, noise }
      this.enabled = true
    } catch {
      this.enabled = false
    }
    return this.enabled
  }

  /** Preview one piece immediately (also serves as the audio-unlock gesture). */
  preview(type: PieceType): void {
    if (!this.ensure() || !this.nodes) return
    playVoice(this.nodes, type, this.nodes.ctx.currentTime + 0.02)
  }

  start(options: LoopOptions): void {
    if (this.playing) return
    this.options = options
    this.playing = true
    this.currentStep = 0
    const ok = this.ensure()
    if (ok && this.nodes) {
      this.queue = []
      this.nextNoteTime = this.nodes.ctx.currentTime + 0.06
      this.schedTimer = setInterval(() => this.schedule(), SCHED_MS)
      this.rafId = requestAnimationFrame(() => this.drawPlayhead())
    } else {
      // visual-only fallback
      let step = 0
      options.onStep(0)
      this.visualTimer = setInterval(() => {
        step = (step + 1) % 8
        options.onStep(step)
      }, STEP_SEC * 1000)
    }
  }

  stop(): void {
    if (!this.playing) return
    this.playing = false
    if (this.schedTimer) {
      clearInterval(this.schedTimer)
      this.schedTimer = null
    }
    if (this.visualTimer) {
      clearInterval(this.visualTimer)
      this.visualTimer = null
    }
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId)
      this.rafId = null
    }
    this.queue = []
    this.options?.onStep(-1)
  }

  dispose(): void {
    this.stop()
    if (this.nodes) void this.nodes.ctx.close()
    this.nodes = null
  }

  private schedule(): void {
    if (!this.nodes || !this.options) return
    while (this.nextNoteTime < this.nodes.ctx.currentTime + LOOKAHEAD) {
      const step = this.currentStep
      const { rhythm, melody } = this.options.getStep(step)
      if (rhythm) playVoice(this.nodes, rhythm, this.nextNoteTime)
      if (melody) playVoice(this.nodes, melody, this.nextNoteTime)
      this.queue.push({ step, time: this.nextNoteTime })
      this.nextNoteTime += STEP_SEC
      this.currentStep = (this.currentStep + 1) % 8
    }
  }

  private drawPlayhead(): void {
    if (!this.playing || !this.nodes || !this.options) return
    while (this.queue.length && this.queue[0].time <= this.nodes.ctx.currentTime) {
      this.options.onStep(this.queue[0].step)
      this.queue.shift()
    }
    this.rafId = requestAnimationFrame(() => this.drawPlayhead())
  }
}
