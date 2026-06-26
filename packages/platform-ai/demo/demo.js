// Platform AI voice-session demo client.
//
// Minimal browser harness that drives the full session over the `/ai-ws/*`
// WebSocket: create -> stream player audio frames -> `turn` -> render the AI's
// streamed text + audio response.
//
// AUDIO FORMAT: player audio is captured as PCM16 16kHz mono — the exact wire
// format the real STT adapter expects (`volcengine.ts`: format:'pcm', rate:16000,
// bits:16, channel:1). Capture uses `AudioContext({ sampleRate: 16000 })` +
// `ScriptProcessorNode`, converting Float32 samples to Int16 little-endian PCM
// per frame (see `floatTo16BitPCM` in `./audio-pcm.js`). The server defaults to
// the deterministic mock providers here (gameId `demo-mock`), but because the
// audio layer is now protocol-correct, this capture path is reusable as-is by a
// real-provider / live-verification harness.
//
// SECURITY INVARIANT (load-bearing): this client connects ONLY to the
// same-origin Worker WebSocket. It holds NO provider API key and NO system
// prompt. The gameId (`demo-mock`) is the only game material it sends; the
// prompt + manual injection + provider credentials all live server-side. Do not
// add any key or prompt text to this file.
//
// With the demo wrangler config, the server resolves `demo-mock` to the
// deterministic mock providers, so the round trip works with no real
// credentials. Note: the mock TTS frame is the UTF-8 bytes of the sentence (a
// placeholder, not a real audio codec), so playback is best-effort — the point
// of the demo is to show the text + audio chunks arriving end to end.

import { floatTo16BitPCM } from './audio-pcm.js'

const els = {
  connect: document.getElementById('connect'),
  speak: document.getElementById('speak'),
  end: document.getElementById('end'),
  status: document.getElementById('status'),
  log: document.getElementById('log'),
}

const GAME_ID = 'demo-mock'

// A tiny example manual so the mock LLM has an injected section to ground its
// reply in. This is per-run game data (allowed on the wire), NOT a system
// prompt.
const MANUAL_DATA = {
  version: 'demo-v1',
  sections: {
    'button-module': {
      rule: 'If the button is red and labeled ABORT, hold it until the strip turns blue, then release.',
    },
  },
}
const GAME_STATE = { relevantSections: ['button-module'] }

const CAPTURE_SAMPLE_RATE = 16000

let ws = null
let mediaStream = null
let audioCtx = null
let sourceNode = null
let procNode = null
let currentAiTurn = null

function setStatus(text) {
  els.status.textContent = text
}

function appendTurn(who, cssClass) {
  const wrap = document.createElement('div')
  wrap.className = `turn ${cssClass}`
  const label = document.createElement('div')
  label.className = 'who'
  label.textContent = who
  const body = document.createElement('div')
  body.className = 'body'
  wrap.append(label, body)
  els.log.append(wrap)
  els.log.scrollTop = els.log.scrollHeight
  return body
}

function base64ToBytes(b64) {
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return bytes
}

function playAudioFrame(bytes) {
  // Best-effort playback. The mock TTS emits placeholder bytes, so decoding may
  // fail; that is expected in mock mode. A real TTS adapter would emit decodable
  // audio here.
  try {
    const blob = new Blob([bytes], { type: 'audio/mpeg' })
    const url = URL.createObjectURL(blob)
    const audio = new Audio(url)
    audio.play().catch(() => {})
    audio.addEventListener('ended', () => URL.revokeObjectURL(url))
  } catch {
    // ignore — placeholder bytes are not playable in mock mode
  }
}

function handleServerMessage(raw) {
  let msg
  try {
    msg = JSON.parse(raw)
  } catch {
    return
  }
  switch (msg.type) {
    case 'created':
      setStatus(`Session created: ${msg.sessionId}`)
      els.speak.disabled = false
      els.end.disabled = false
      break
    case 'chunk':
      if (!currentAiTurn) currentAiTurn = appendTurn('AI', 'ai')
      if (msg.kind === 'text' && msg.text) {
        currentAiTurn.textContent += msg.text
        els.log.scrollTop = els.log.scrollHeight
      } else if (msg.kind === 'audio' && msg.audio) {
        playAudioFrame(base64ToBytes(msg.audio))
      }
      if (msg.done) {
        currentAiTurn = null
        setStatus('Turn complete. Hold to speak again.')
      }
      break
    case 'summary':
      setStatus(`Session ended. Turns: ${msg.summary.turnCount}`)
      break
    default:
      break
  }
}

function connect() {
  const sessionName = `demo-${Math.random().toString(36).slice(2, 10)}`
  const proto = location.protocol === 'https:' ? 'wss' : 'ws'
  ws = new WebSocket(`${proto}://${location.host}/ai-ws/${sessionName}`)

  ws.addEventListener('open', () => {
    setStatus('Connected. Creating session…')
    ws.send(
      JSON.stringify({
        type: 'create',
        gameId: GAME_ID,
        manualData: MANUAL_DATA,
        gameState: GAME_STATE,
      })
    )
  })
  ws.addEventListener('message', (event) => handleServerMessage(event.data))
  ws.addEventListener('close', (event) => {
    setStatus(`Disconnected (${event.code}).`)
    els.speak.disabled = true
    els.end.disabled = true
  })
  ws.addEventListener('error', () => setStatus('WebSocket error.'))
}

async function startSpeaking() {
  if (!ws || ws.readyState !== WebSocket.OPEN) return
  appendTurn('You (speaking…)', 'user')
  try {
    mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true })
  } catch {
    setStatus('Microphone permission denied — sending a silent frame instead.')
    // Even without a mic, the mock STT yields its fixed transcript, so the demo
    // still completes a turn. Send one empty PCM frame to stand in for audio.
    ws.send(new ArrayBuffer(0))
    return
  }
  // Capture at 16kHz so the browser resamples the mic to the STT adapter's rate;
  // no manual downsampling needed. ScriptProcessor is deprecated but universally
  // supported and sufficient for this dev harness.
  audioCtx = new AudioContext({ sampleRate: CAPTURE_SAMPLE_RATE })
  sourceNode = audioCtx.createMediaStreamSource(mediaStream)
  procNode = audioCtx.createScriptProcessor(4096, 1, 1)
  procNode.addEventListener('audioprocess', (event) => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return
    // Mono Float32 samples @16kHz -> Int16 little-endian PCM frame.
    const pcm = floatTo16BitPCM(event.inputBuffer.getChannelData(0))
    ws.send(pcm)
  })
  sourceNode.connect(procNode)
  procNode.connect(audioCtx.destination)
  setStatus('Listening… release to send.')
}

function teardownCapture() {
  if (procNode) {
    procNode.disconnect()
    procNode = null
  }
  if (sourceNode) {
    sourceNode.disconnect()
    sourceNode = null
  }
  if (audioCtx) {
    audioCtx.close()
    audioCtx = null
  }
  if (mediaStream) {
    mediaStream.getTracks().forEach((t) => t.stop())
    mediaStream = null
  }
}

function stopSpeaking() {
  teardownCapture()
  if (ws && ws.readyState === WebSocket.OPEN) {
    // Give the last audio frame a moment to flush, then request the AI turn.
    setStatus('Thinking…')
    setTimeout(() => ws.send(JSON.stringify({ type: 'turn' })), 300)
  }
}

els.connect.addEventListener('click', () => {
  els.connect.disabled = true
  connect()
})
// Hold-to-speak: press starts capture, release sends the turn.
els.speak.addEventListener('pointerdown', startSpeaking)
els.speak.addEventListener('pointerup', stopSpeaking)
els.speak.addEventListener('pointerleave', stopSpeaking)
els.end.addEventListener('click', () => {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'end' }))
})
