/* eslint-disable no-console -- stdout CLI probe for the full-duplex backend. */
// Full-duplex backend probe: verifies AI-FIRST greeting + hands-free AUTO-TURN
// (no client `turn` message) against the deployed Worker. Phase 1 sends NO audio
// and expects an AI opening turn. Phase 2 streams the speech fixture + trailing
// silence (so the ASR endpoint-detects the utterance end) WITHOUT a `turn`
// message and expects an auto-fired turn. Phase 3 repeats to test multi-utterance.
import { readFileSync } from 'node:fs'

const SAMPLE_RATE = 16000
const FRAME_BYTES = 8192
const url = process.argv.includes('--url')
  ? process.argv[process.argv.indexOf('--url') + 1]
  : 'wss://claw.amio.fans'
const gameId = process.argv.includes('--gameId')
  ? process.argv[process.argv.indexOf('--gameId') + 1]
  : 'bombsquad'
const fixturePath = process.argv.includes('--fixture')
  ? process.argv[process.argv.indexOf('--fixture') + 1]
  : 'demo/fixture-red-wire.pcm'

const speech = new Uint8Array(readFileSync(fixturePath))

const name = `fdx-${Math.random().toString(36).slice(2, 10)}`
const ws = new WebSocket(`${url}/ai-ws/${name}`)

const phase = { idx: 0, label: 'connect', text: '', frames: 0 }
const log = (m) => console.log(`[${phase.label}] ${m}`)
let idleTimer = null

function streamBytes(bytes) {
  for (let off = 0; off < bytes.byteLength; off += FRAME_BYTES) {
    ws.send(bytes.slice(off, Math.min(off + FRAME_BYTES, bytes.byteLength)).buffer)
  }
}
function startPhase(idx, label) {
  if (phase.text || phase.frames)
    log(`done — text="${phase.text.slice(0, 80)}" frames=${phase.frames}`)
  phase.idx = idx
  phase.label = label
  phase.text = ''
  phase.frames = 0
}
// Advance to the next phase after a quiet gap (a turn's chunks stopped arriving).
function bumpIdle(ms, next) {
  if (idleTimer) clearTimeout(idleTimer)
  idleTimer = setTimeout(next, ms)
}

ws.addEventListener('open', () => {
  startPhase(1, 'ai-first')
  ws.send(
    JSON.stringify({
      type: 'create',
      gameId,
      manualData: {
        version: 'fdx',
        sections: { button: { rule: 'Describe the button color and label.' } },
      },
      gameState: { relevantSections: ['button'] },
    })
  )
})

ws.addEventListener('message', (event) => {
  if (typeof event.data !== 'string') return
  let msg
  try {
    msg = JSON.parse(event.data)
  } catch {
    return
  }
  if (msg.type === 'created') {
    log(`session created: ${msg.sessionId} — waiting for AI-FIRST greeting (no audio sent)…`)
    // If no greeting arrives within 12s, move on to the auto-turn test anyway.
    bumpIdle(12000, () => runAutoTurn(2, 'auto-turn-1'))
    return
  }
  if (msg.type === 'chunk') {
    if (msg.kind === 'text' && msg.text) phase.text += msg.text
    else if (msg.kind === 'audio' && msg.audio) phase.frames += 1
    // A response started → the endpoint fired a turn; stop the mic-mimic silence.
    if (phase.idx >= 2) stopContinuousSilence()
    // Each chunk resets the idle gap; when chunks stop for 6s, advance.
    if (phase.idx === 1) bumpIdle(6000, () => runAutoTurn(2, 'auto-turn-1'))
    else if (phase.idx === 2) bumpIdle(6000, () => runAutoTurn(3, 'auto-turn-2'))
    else if (phase.idx === 3) bumpIdle(6000, finish)
    return
  }
  if (msg.type === 'error') log(`server error: ${msg.code} — ${msg.message}`)
})

let silenceTimer = null
function stopContinuousSilence() {
  if (silenceTimer) {
    clearInterval(silenceTimer)
    silenceTimer = null
  }
}
function runAutoTurn(idx, label) {
  startPhase(idx, label)
  log('streaming speech, then CONTINUOUS silence (mimic real mic, NO turn message)…')
  streamBytes(speech)
  // Keep the audio stream alive like a real mic: send a 256ms silence frame
  // every 200ms so the ASR never hits its 8s inter-packet timeout, and its VAD
  // can endpoint-detect the (speech-then-silence) utterance and auto-fire a turn.
  const frame = new Uint8Array(SAMPLE_RATE * 2 * 0.256)
  silenceTimer = setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) ws.send(frame.buffer.slice(0))
  }, 200)
  // Once a turn's chunks arrive, the message handler advances; here we just cap
  // the wait. Stop the silence once we've seen a response (handled in onmessage).
  bumpIdle(25000, () => {
    stopContinuousSilence()
    if (!phase.text && !phase.frames)
      log('NO auto-turn within 25s of continuous audio — endpoint never fired')
    if (idx === 2) runAutoTurn(3, 'auto-turn-2')
    else finish()
  })
}
function finish() {
  if (phase.text || phase.frames)
    log(`done — text="${phase.text.slice(0, 80)}" frames=${phase.frames}`)
  ws.send(JSON.stringify({ type: 'end' }))
  setTimeout(() => process.exit(0), 2000)
}

ws.addEventListener('close', (e) => {
  console.log(`\n[close] code=${e.code} reason="${e.reason || ''}"`)
  process.exit(0)
})
ws.addEventListener('error', () => console.log('[error] websocket error'))
