/* eslint-disable no-console -- stdout CLI probe for the live during-speech ASR. */
// Verifies the live (during-speech) ASR against the deployed Worker: connect →
// AI-first greeting → `speech-start` → stream audio in REAL-TIME-paced frames →
// expect interim `{type:'transcript'}` captions WHILE streaming → `turn` →
// expect a FULL final transcript + the AI reply, with NO 8s ASR timeout.
import { readFileSync } from 'node:fs'

const FRAME_BYTES = 8192 // ~256ms at 16kHz PCM16
const url = process.argv.includes('--url')
  ? process.argv[process.argv.indexOf('--url') + 1]
  : 'wss://claw.amio.fans'
const gameId = process.argv.includes('--gameId')
  ? process.argv[process.argv.indexOf('--gameId') + 1]
  : 'bombsquad'
const fixturePath = process.argv.includes('--fixture')
  ? process.argv[process.argv.indexOf('--fixture') + 1]
  : 'demo/fixture-long.pcm'
const audio = new Uint8Array(readFileSync(fixturePath))

const ws = new WebSocket(`${url}/ai-ws/lasr-${Math.random().toString(36).slice(2, 8)}`)
const t0 = () => `${((Date.now() - start) / 1000).toFixed(1)}s`
let start = 0
let greetingDone = false
let interimCount = 0
let finalTranscript = ''
let replyText = ''

ws.addEventListener('open', () => {
  start = Date.now()
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

async function speakLive() {
  console.log(`[${t0()}] speech-start → streaming audio in real-time-paced frames…`)
  ws.send(JSON.stringify({ type: 'speech-start' }))
  for (let off = 0; off < audio.byteLength; off += FRAME_BYTES) {
    if (ws.readyState !== WebSocket.OPEN) return
    ws.send(audio.slice(off, Math.min(off + FRAME_BYTES, audio.byteLength)).buffer)
    await new Promise((r) => setTimeout(r, 250)) // ~real-time: one 256ms frame / 250ms
  }
  console.log(`[${t0()}] audio done → turn (finalize)`)
  ws.send(JSON.stringify({ type: 'turn' }))
}

ws.addEventListener('message', (event) => {
  if (typeof event.data !== 'string') return
  let m
  try {
    m = JSON.parse(event.data)
  } catch {
    return
  }
  if (m.type === 'created') {
    console.log(`[${t0()}] created — awaiting AI-first greeting…`)
    setTimeout(() => {
      greetingDone = true
      speakLive()
    }, 7000) // give the greeting time, then speak
  } else if (m.type === 'transcript') {
    if (greetingDone) {
      interimCount += m.final ? 0 : 1
      if (m.final) finalTranscript = m.text
      console.log(`[${t0()}] caption ${m.final ? 'FINAL' : 'interim'}: "${m.text}"`)
    }
  } else if (m.type === 'chunk') {
    if (greetingDone && m.kind === 'text' && m.text) replyText += m.text
    if (greetingDone && m.done) {
      console.log(`\n=== RESULT ===`)
      console.log(
        `interims-during-speech: ${interimCount}  (want > 1 and arriving BEFORE the turn)`
      )
      console.log(`final transcript: "${finalTranscript}"`)
      console.log(`AI reply: "${replyText}"`)
      ws.send(JSON.stringify({ type: 'end' }))
      setTimeout(() => process.exit(0), 1500)
    }
  } else if (m.type === 'error') {
    console.log(`[${t0()}] server error: ${m.code} — ${m.message}`)
  }
})
ws.addEventListener('close', (e) => {
  console.log(`\n[${t0()}] close code=${e.code} reason="${e.reason || ''}"`)
  process.exit(0)
})
ws.addEventListener('error', () => console.log('[error] websocket error'))
