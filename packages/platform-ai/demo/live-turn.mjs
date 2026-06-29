// Headless live-turn verification harness for `@amiclaw/platform-ai`.
//
// Drives ONE voice turn end to end through the REAL Worker over the `/ai-ws/*`
// WebSocket, against a locally running `wrangler dev`, and asserts the full
// turn completed: ASR final transcript non-empty -> LLM output tokens > 0 ->
// TTS audio frames > 0. It self-validates against the deterministic mock
// providers (gameId `demo-mock`, no credentials) and is one flag away from a
// REAL-provider run (`--gameId demo` against `demo/wrangler.live.toml` + a
// local `.dev.vars`).
//
// This proves what no isolated handshake check could: a single orchestrated
// SUCCESSFUL full turn, end to end through the deployed orchestration code.
//
// SECURITY INVARIANT (load-bearing): this driver connects ONLY to the Worker
// WebSocket. It holds NO provider API key and NO system prompt. The gameId and
// per-run manual data are the only game material it sends; provider credentials
// live exclusively server-side (wrangler secrets / `.dev.vars`, read by the
// Worker). Do NOT add any secret or prompt text to this file.
//
// WIRE PROTOCOL (mirrors `demo.js` + `src/session-do.ts`):
//   client -> {type:'create', gameId, manualData, gameState?}
//   client -> binary PCM16 16kHz mono frames (player audio)
//   client -> {type:'turn'}
//   server -> {type:'created', sessionId}
//   server -> {type:'chunk', kind:'text'|'audio', text?, audio?(base64), done}
//   client -> {type:'end'}
//   server -> {type:'summary', summary}   (SessionSummary)
//
// AUDIO FORMAT: PCM16 16kHz mono (`src/providers/volcengine.ts`:
// format:'pcm', rate:16000, bits:16, channel:1). With no `--fixture`, a short
// synthetic PCM16 tone is generated in memory — enough for the mock STT to
// report non-zero `sttInputSeconds` (the mock yields a fixed transcript
// regardless of content). For the REAL run, pass a real-speech fixture built by
// `demo/make-fixture.sh`.

/* eslint-disable no-console -- this is a stdout-driven CLI verification harness. */
import { readFileSync } from 'node:fs'

const SAMPLE_RATE = 16000 // Hz — the STT adapter's fixed input rate.
const FRAME_BYTES = 8192 // ~256ms per binary frame; arbitrary chunking.
const TURN_TIMEOUT_MS = 60000

function parseArgs(argv) {
  const args = {
    gameId: 'demo-mock',
    url: 'ws://localhost:8787',
    fixture: null,
    name: `live-${Math.random().toString(36).slice(2, 10)}`,
  }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    const next = () => argv[(i += 1)]
    if (arg === '--gameId') args.gameId = next()
    else if (arg === '--url') args.url = next()
    else if (arg === '--fixture') args.fixture = next()
    else if (arg === '--name') args.name = next()
    else if (arg === '--help' || arg === '-h') {
      console.log(
        'Usage: node demo/live-turn.mjs [--gameId demo-mock|demo] [--url ws://localhost:8787] [--fixture path.pcm] [--name sessionName]'
      )
      process.exit(0)
    } else {
      console.error(`Unknown argument: ${arg}`)
      process.exit(2)
    }
  }
  return args
}

// A tiny example manual so the LLM has an injected section to ground its reply
// in. Per-run game data (allowed on the wire), NOT a system prompt.
const MANUAL_DATA = {
  version: 'live-v1',
  sections: {
    'button-module': {
      rule: 'If the button is red and labeled ABORT, hold it until the strip turns blue, then release.',
    },
  },
}
const GAME_STATE = { relevantSections: ['button-module'] }

/**
 * Load the player-audio fixture as raw PCM16 bytes. With no `--fixture`, build a
 * ~1.5s 16kHz sine tone in memory — content is irrelevant (the mock STT yields a
 * fixed transcript), but non-zero bytes are needed so `sttInputSeconds > 0`.
 */
function loadAudio(fixturePath) {
  if (fixturePath) {
    const bytes = new Uint8Array(readFileSync(fixturePath))
    if (bytes.byteLength === 0) {
      throw new Error(`fixture ${fixturePath} is empty — need non-zero PCM16 bytes`)
    }
    return { bytes, source: `${fixturePath} (${bytes.byteLength} bytes)` }
  }
  const seconds = 1.5
  const sampleCount = Math.floor(SAMPLE_RATE * seconds)
  const buffer = new ArrayBuffer(sampleCount * 2)
  const view = new DataView(buffer)
  for (let i = 0; i < sampleCount; i += 1) {
    const sample = Math.sin((2 * Math.PI * 440 * i) / SAMPLE_RATE) * 0.3
    view.setInt16(i * 2, Math.round(sample * 0x7fff), true)
  }
  return {
    bytes: new Uint8Array(buffer),
    source: `synthetic 440Hz tone (${seconds}s, ${buffer.byteLength} bytes)`,
  }
}

function base64ToByteLength(b64) {
  // Length of the decoded bytes without materializing them.
  return Buffer.from(b64, 'base64').byteLength
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const { bytes: audio, source: audioSource } = loadAudio(args.fixture)

  console.log('— platform-ai live-turn harness —')
  console.log(`  gameId : ${args.gameId}`)
  console.log(`  url    : ${args.url}/ai-ws/${args.name}`)
  console.log(`  audio  : ${audioSource}`)
  console.log('')

  const ws = new WebSocket(`${args.url}/ai-ws/${args.name}`)

  // Per-hop observations collected across the turn.
  let llmText = ''
  let audioFrameCount = 0
  let audioBytesTotal = 0
  let turnDone = false
  let summary = null

  const timeout = setTimeout(() => {
    console.error(`\nFAIL: no summary within ${TURN_TIMEOUT_MS}ms — turn did not complete.`)
    try {
      ws.close()
    } catch {
      // ignore
    }
    process.exit(1)
  }, TURN_TIMEOUT_MS)

  const fail = (reason) => {
    clearTimeout(timeout)
    console.error(`\nFAIL: ${reason}`)
    try {
      ws.close()
    } catch {
      // ignore
    }
    process.exit(1)
  }

  ws.addEventListener('open', () => {
    ws.send(
      JSON.stringify({
        type: 'create',
        gameId: args.gameId,
        manualData: MANUAL_DATA,
        gameState: GAME_STATE,
        // This harness verifies ONE client-`turn`-driven player turn in
        // isolation; suppress the AI-first opening greeting so the first
        // `done:true` chunk belongs to the player turn (not the greeting), which
        // is what the `end`-on-done step keys off.
        opening: false,
      })
    )
  })

  ws.addEventListener('message', (event) => {
    let msg
    try {
      msg = JSON.parse(event.data)
    } catch {
      return // ignore non-JSON frames
    }
    switch (msg.type) {
      case 'created': {
        console.log(`[create] session created: ${msg.sessionId}`)
        // Stream the player audio as binary PCM16 frames, then request the turn.
        for (let off = 0; off < audio.byteLength; off += FRAME_BYTES) {
          const frame = audio.subarray(off, Math.min(off + FRAME_BYTES, audio.byteLength))
          // Copy into a fresh ArrayBuffer so the WS does not see a subview over
          // the whole backing buffer.
          ws.send(frame.slice().buffer)
        }
        console.log(`[audio ] streamed ${audio.byteLength} bytes of player audio`)
        ws.send(JSON.stringify({ type: 'turn' }))
        console.log('[turn  ] requested — awaiting AI response stream…')
        break
      }
      case 'chunk': {
        if (msg.kind === 'text' && msg.text) {
          llmText += msg.text
        } else if (msg.kind === 'audio' && msg.audio) {
          const len = base64ToByteLength(msg.audio)
          if (len > 0) {
            audioFrameCount += 1
            audioBytesTotal += len
          }
        }
        if (msg.done) {
          turnDone = true
          console.log('[stream] turn complete — sending end…')
          ws.send(JSON.stringify({ type: 'end' }))
        }
        break
      }
      case 'transcript': {
        console.log(`[transcript ${msg.final ? 'FINAL' : 'interim'}] "${msg.text}"`)
        break
      }
      case 'summary': {
        summary = msg.summary
        break
      }
      case 'error': {
        fail(`server error: ${msg.code} — ${msg.message}`)
        break
      }
      default:
        break
    }
  })

  ws.addEventListener('error', (event) => {
    fail(
      `WebSocket error: ${event?.message ?? 'unknown'} (is wrangler dev running at ${args.url}?)`
    )
  })

  ws.addEventListener('close', (event) => {
    clearTimeout(timeout)
    if (!summary) {
      fail(`socket closed (${event.code} ${event.reason || ''}) before a SessionSummary arrived.`)
      return
    }
    report({ summary, llmText, audioFrameCount, audioBytesTotal, turnDone })
  })
}

function extractAsrTranscript(summary) {
  // The wire protocol never streams the ASR transcript to the client (it is
  // server-side). But `SessionSummary.highlights` carries the transcript: the
  // `user:`-prefixed history entry is the player's transcribed utterance.
  const highlights = Array.isArray(summary.highlights) ? summary.highlights : []
  const userLine = highlights.find((h) => typeof h === 'string' && h.startsWith('user:'))
  return userLine ? userLine.slice('user:'.length).trim() : ''
}

function report({ summary, llmText, audioFrameCount, audioBytesTotal, turnDone }) {
  const usage = summary.usage ?? {}
  const asr = extractAsrTranscript(summary)

  console.log('\n— per-hop report —')
  console.log(`  ASR : transcript="${asr}"  (sttInputSeconds=${usage.sttInputSeconds})`)
  console.log(`  LLM : outputTokens=${usage.llmOutputTokens}  reply="${llmText}"`)
  console.log(
    `  TTS : audioFrames=${audioFrameCount}  totalBytes=${audioBytesTotal}  (ttsOutputSeconds=${usage.ttsOutputSeconds})`
  )
  console.log(`  turnCount=${summary.turnCount}`)

  const checks = [
    ['turn reached done:true', turnDone === true],
    ['turnCount >= 1', summary.turnCount >= 1],
    ['usage.llmOutputTokens > 0', (usage.llmOutputTokens ?? 0) > 0],
    ['usage.sttInputSeconds > 0', (usage.sttInputSeconds ?? 0) > 0],
    ['>= 1 TTS audio frame', audioFrameCount >= 1],
    ['ASR transcript non-empty', asr.length > 0],
  ]

  console.log('\n— assertions —')
  let allPass = true
  for (const [label, ok] of checks) {
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`)
    if (!ok) allPass = false
  }

  if (allPass) {
    console.log('\nOK: full voice turn completed end to end (ASR -> LLM -> TTS).')
    process.exit(0)
  } else {
    console.error('\nFAIL: one or more turn assertions did not hold.')
    process.exit(1)
  }
}

main().catch((err) => {
  console.error(`FAIL: ${err?.stack ?? err}`)
  process.exit(1)
})
