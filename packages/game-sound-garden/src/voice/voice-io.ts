/**
 * Anon-tier voice I/O (PR-2). Voice is a swappable driver so the game loop never
 * changes when voice does.
 *
 * This is the ANON path only. The signed-in mode② partner runs on the platform
 * `useGameVoiceSession` (server ASR + Doubao TTS streamed) and does NOT use this
 * module. Here:
 *   - ASR (listen): browser Web Speech `zh-CN`, PUSH-TO-TALK (tap the mic chip to
 *     capture one utterance). Hidden entirely when unsupported.
 *   - TTS (speak): browser `speechSynthesis` when supported, else silent.
 *   - Neither supported → NullVoice + the scripted brain (fully offline play).
 *
 * The dev proxy tier (`/api/partner`, `/api/tts` Doubao) and the capability probe
 * that selected them were removed with the dev server — the platform session
 * replaces them for signed-in play.
 */

// --- interface ---------------------------------------------------------------

export interface VoiceIO {
  /** True when push-to-talk ASR is available (drives the mic-chip visibility). */
  readonly canListen: boolean
  /** Capture one player utterance (push-to-talk). Resolves '' if none / unsupported. */
  listen(): Promise<string>
  /** Force-stop an in-flight capture (mic-chip second tap). */
  stopListening(): void
  /** Speak a partner line. Resolves when playback finishes (or is skipped). */
  speak(text: string): Promise<void>
  dispose(): void
}

// --- Default: no mic, no TTS -------------------------------------------------

export class NullVoice implements VoiceIO {
  readonly canListen = false
  async listen(): Promise<string> {
    return ''
  }
  stopListening(): void {
    // nothing to stop
  }
  async speak(_text: string): Promise<void> {
    // no-op — partner speech is rendered as text
  }
  dispose(): void {
    // nothing to tear down
  }
}

// --- feature detection -------------------------------------------------------

interface SpeechRecognitionResultLike {
  0: { transcript: string }
}
interface SpeechRecognitionEventLike {
  results: ArrayLike<SpeechRecognitionResultLike>
}
interface SpeechRecognitionLike {
  lang: string
  continuous: boolean
  interimResults: boolean
  onresult: ((event: SpeechRecognitionEventLike) => void) | null
  onerror: (() => void) | null
  onend: (() => void) | null
  start(): void
  stop(): void
  abort(): void
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike

function speechRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === 'undefined') return null
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor
    webkitSpeechRecognition?: SpeechRecognitionCtor
  }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

function speechSynthSupported(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window
}

// --- ASR: Web Speech push-to-talk -------------------------------------------

class WebSpeechListener {
  private readonly ctor: SpeechRecognitionCtor
  private active: SpeechRecognitionLike | null = null

  constructor(ctor: SpeechRecognitionCtor) {
    this.ctor = ctor
  }

  listen(): Promise<string> {
    if (this.active) return Promise.resolve('')
    return new Promise<string>((resolve) => {
      const rec = new this.ctor()
      this.active = rec
      rec.lang = 'zh-CN'
      rec.continuous = false
      rec.interimResults = false
      let transcript = ''
      let settled = false
      const done = (text: string) => {
        if (settled) return
        settled = true
        this.active = null
        resolve(text)
      }
      rec.onresult = (event) => {
        const parts: string[] = []
        for (let i = 0; i < event.results.length; i++) parts.push(event.results[i][0].transcript)
        transcript = parts.join('').trim()
      }
      rec.onerror = () => done('')
      rec.onend = () => done(transcript)
      try {
        rec.start()
      } catch {
        done('')
      }
    })
  }

  stop(): void {
    try {
      this.active?.stop()
    } catch {
      // ignore
    }
  }

  dispose(): void {
    try {
      this.active?.abort()
    } catch {
      // ignore
    }
    this.active = null
  }
}

// --- TTS speakers ------------------------------------------------------------

interface Speaker {
  speak(text: string): Promise<void>
  dispose(): void
}

class NullSpeaker implements Speaker {
  async speak(_text: string): Promise<void> {}
  dispose(): void {}
}

/**
 * Browser `speechSynthesis` TTS (anon tier). Background-tab handling (r13
 * followup): Chrome throttles / queues speech synthesis in a hidden tab, so a
 * line started before backgrounding can replay or pile up on return. We cancel
 * any in-flight utterance on `visibilitychange → hidden` and on dispose, so a
 * backgrounded partner line is dropped rather than caught up later.
 */
class SpeechSynthSpeaker implements Speaker {
  private readonly onVisibility: () => void

  constructor() {
    this.onVisibility = () => {
      if (typeof document !== 'undefined' && document.hidden) this.cancel()
    }
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', this.onVisibility)
    }
  }

  private cancel(): void {
    try {
      window.speechSynthesis?.cancel()
    } catch {
      // ignore
    }
  }

  speak(text: string): Promise<void> {
    return new Promise<void>((resolve) => {
      try {
        const synth = window.speechSynthesis
        synth.cancel()
        const utterance = new SpeechSynthesisUtterance(text)
        utterance.lang = 'zh-CN'
        utterance.onend = () => resolve()
        utterance.onerror = () => resolve()
        synth.speak(utterance)
      } catch {
        resolve()
      }
    })
  }

  dispose(): void {
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.onVisibility)
    }
    this.cancel()
  }
}

// --- composite + factory -----------------------------------------------------

class BrowserVoice implements VoiceIO {
  constructor(
    private readonly listener: WebSpeechListener | null,
    private readonly speaker: Speaker
  ) {}

  get canListen(): boolean {
    return this.listener !== null
  }
  listen(): Promise<string> {
    return this.listener ? this.listener.listen() : Promise.resolve('')
  }
  stopListening(): void {
    this.listener?.stop()
  }
  speak(text: string): Promise<void> {
    return this.speaker.speak(text)
  }
  dispose(): void {
    this.listener?.dispose()
    this.speaker.dispose()
  }
}

/** Resolve the anon voice driver from browser support alone (no server caps). */
export function createVoice(): VoiceIO {
  const ctor = speechRecognitionCtor()
  const listener = ctor ? new WebSpeechListener(ctor) : null
  const speaker: Speaker = speechSynthSupported() ? new SpeechSynthSpeaker() : new NullSpeaker()
  if (listener === null && speaker instanceof NullSpeaker) return new NullVoice()
  return new BrowserVoice(listener, speaker)
}
