/* eslint-disable no-console */

import { randomBytes } from 'node:crypto'
import net from 'node:net'
import { spawnSync } from 'node:child_process'
import tls from 'node:tls'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { checkVoiceMappingReadiness, VOICE_ENV_BINDINGS } from '../src/voice-id-mapping.ts'

type CheckStatus = 'pass' | 'fail' | 'skip'

interface CheckResult {
  status: CheckStatus
  name: string
  detail: string
}

const CHECKS: CheckResult[] = []
const DEFAULT_BASE_URL = 'https://claw.amio.fans'
const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const REPO_ROOT = resolve(PACKAGE_ROOT, '../..')
const WRANGLER_CONFIG = resolve(PACKAGE_ROOT, 'wrangler.toml')

function record(status: CheckStatus, name: string, detail: string): void {
  CHECKS.push({ status, name, detail })
  const label = status.toUpperCase().padEnd(4)
  console.log(`[${label}] ${name} - ${detail}`)
}

function requireEnv(name: string): string {
  const value = process.env[name]
  if (value === undefined || value.trim() === '') {
    throw new Error(`${name} is required for this opt-in check`)
  }
  return value
}

function baseUrl(): URL {
  return new URL(process.env.PLATFORM_AI_BASE_URL ?? DEFAULT_BASE_URL)
}

function wsUrl(sessionName: string): URL {
  const base = baseUrl()
  const url = new URL(`/ai-ws/${sessionName}`, base.origin)
  url.protocol = base.protocol === 'http:' ? 'ws:' : 'wss:'
  return url
}

function runWrangler(args: string[]): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(
    'pnpm',
    ['--dir', REPO_ROOT, 'exec', 'wrangler', `--config=${WRANGLER_CONFIG}`, ...args],
    {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    }
  )
  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  }
}

async function checkWorkerVoiceSecretNames(): Promise<void> {
  if (process.env.RUN_WORKER_SECRET_NAME_CHECK !== '1') {
    record(
      'skip',
      'deployed voice secret names',
      'set RUN_WORKER_SECRET_NAME_CHECK=1 to run wrangler secret list and verify VOLC_TTS_VOICE_COMPANION_* names'
    )
    return
  }
  const result = runWrangler(['secret', 'list'])
  const combined = `${result.stdout}\n${result.stderr}`
  if (result.status !== 0) {
    record('fail', 'deployed voice secret names', combined.trim() || 'wrangler secret list failed')
    return
  }
  const required = Array.from(new Set(Object.values(VOICE_ENV_BINDINGS)))
  const missing = required.filter((name) => !combined.includes(name))
  if (missing.length === 0) {
    record('pass', 'deployed voice secret names', `found ${required.join(', ')}`)
    return
  }
  record('fail', 'deployed voice secret names', `missing ${missing.join(', ')}`)
}

async function withTimeout<T>(label: string, ms: number, work: Promise<T>): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
      }),
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

interface HandshakeResult {
  status: number
  statusLine: string
  socket?: net.Socket
  leftover: Buffer
}

function openTcp(url: URL): net.Socket {
  const isTls = url.protocol === 'wss:'
  const port = Number(url.port || (isTls ? 443 : 80))
  if (isTls) {
    return tls.connect({ host: url.hostname, port, servername: url.hostname })
  }
  return net.connect({ host: url.hostname, port })
}

async function websocketHandshake(url: URL, cookie?: string): Promise<HandshakeResult> {
  const socket = openTcp(url)
  const key = randomBytes(16).toString('base64')
  const path = `${url.pathname}${url.search}`
  const headers = [
    `GET ${path} HTTP/1.1`,
    `Host: ${url.host}`,
    'Upgrade: websocket',
    'Connection: Upgrade',
    `Sec-WebSocket-Key: ${key}`,
    'Sec-WebSocket-Version: 13',
    ...(cookie === undefined ? [] : [`Cookie: ${cookie}`]),
    '\r\n',
  ].join('\r\n')

  return withTimeout(
    `websocket handshake ${url.href}`,
    8000,
    new Promise((resolvePromise, reject) => {
      let buffer = Buffer.alloc(0)
      const cleanup = (): void => {
        socket.off('data', onData)
        socket.off('error', onError)
      }
      const onError = (error: Error): void => {
        cleanup()
        reject(error)
      }
      const onData = (chunk: Buffer): void => {
        buffer = Buffer.concat([buffer, chunk])
        const headerEnd = buffer.indexOf('\r\n\r\n')
        if (headerEnd === -1) return
        cleanup()
        const header = buffer.subarray(0, headerEnd).toString('utf8')
        const [statusLine] = header.split('\r\n')
        const status = Number(statusLine.split(' ')[1])
        const leftover = buffer.subarray(headerEnd + 4)
        if (status !== 101) socket.end()
        resolvePromise({
          status,
          statusLine,
          socket: status === 101 ? socket : undefined,
          leftover,
        })
      }
      socket.on('error', onError)
      socket.on('data', onData)
      socket.write(headers)
    })
  )
}

function websocketTextFrame(text: string): Buffer {
  const payload = Buffer.from(text, 'utf8')
  const mask = randomBytes(4)
  const header =
    payload.length < 126
      ? Buffer.from([0x81, 0x80 | payload.length])
      : Buffer.from([0x81, 0x80 | 126, (payload.length >> 8) & 0xff, payload.length & 0xff])
  const masked = Buffer.alloc(payload.length)
  for (let i = 0; i < payload.length; i += 1) {
    masked[i] = payload[i] ^ mask[i % 4]
  }
  return Buffer.concat([header, mask, masked])
}

class ReadinessSocket {
  private buffer: Buffer

  constructor(
    private readonly socket: net.Socket,
    leftover: Buffer
  ) {
    this.buffer = leftover
  }

  sendJson(value: unknown): void {
    this.socket.write(websocketTextFrame(JSON.stringify(value)))
  }

  close(): void {
    this.socket.end()
  }

  async readText(timeoutMs = 8000): Promise<string> {
    return withTimeout(
      'websocket frame read',
      timeoutMs,
      new Promise((resolvePromise, reject) => {
        const tryRead = (): boolean => {
          if (this.buffer.length < 2) return false
          const first = this.buffer[0]
          const second = this.buffer[1]
          const opcode = first & 0x0f
          let offset = 2
          let length = second & 0x7f
          if (length === 126) {
            if (this.buffer.length < 4) return false
            length = this.buffer.readUInt16BE(2)
            offset = 4
          } else if (length === 127) {
            reject(new Error('readiness socket does not support >64KB frames'))
            return true
          }
          const masked = (second & 0x80) !== 0
          const maskLength = masked ? 4 : 0
          if (this.buffer.length < offset + maskLength + length) return false
          const mask = masked ? this.buffer.subarray(offset, offset + 4) : undefined
          offset += maskLength
          const payload = Buffer.from(this.buffer.subarray(offset, offset + length))
          this.buffer = this.buffer.subarray(offset + length)
          if (mask !== undefined) {
            for (let i = 0; i < payload.length; i += 1) {
              payload[i] = payload[i] ^ mask[i % 4]
            }
          }
          if (opcode === 0x8) {
            reject(new Error('websocket closed before text response'))
            return true
          }
          if (opcode !== 0x1) return tryRead()
          resolvePromise(payload.toString('utf8'))
          return true
        }

        const cleanup = (): void => {
          this.socket.off('data', onData)
          this.socket.off('error', onError)
          this.socket.off('close', onClose)
        }
        const onData = (chunk: Buffer): void => {
          this.buffer = Buffer.concat([this.buffer, chunk])
          if (tryRead()) cleanup()
        }
        const onError = (error: Error): void => {
          cleanup()
          reject(error)
        }
        const onClose = (): void => {
          cleanup()
          reject(new Error('socket closed before text response'))
        }
        if (tryRead()) return
        this.socket.on('data', onData)
        this.socket.on('error', onError)
        this.socket.on('close', onClose)
      })
    )
  }
}

async function checkVoiceMapping(): Promise<void> {
  const readiness = checkVoiceMappingReadiness(process.env)
  if (readiness.ok) {
    record(
      'pass',
      'voice mapping env',
      `configured ${readiness.configured.map(({ voiceId }) => voiceId).join(', ')}`
    )
    return
  }
  record(
    'fail',
    'voice mapping env',
    `missing ${readiness.missing.map(({ voiceId, envVar }) => `${voiceId}:${envVar}`).join(', ')}`
  )
}

async function checkUnauthedWsReject(): Promise<void> {
  const target = wsUrl(`readiness-unauth-${Date.now()}`)
  const handshake = await websocketHandshake(target)
  if (handshake.status === 401) {
    record('pass', 'unauthenticated /ai-ws/* reject', `${target.href} returned 401`)
    return
  }
  record(
    'fail',
    'unauthenticated /ai-ws/* reject',
    `${target.href} returned ${handshake.statusLine}`
  )
}

async function checkCompanionApiReadOnly(cookie: string | undefined): Promise<void> {
  if (cookie === undefined) {
    record(
      'skip',
      'Pages companion D1 binding visibility',
      'set PLATFORM_AI_AUTH_COOKIE to run read-only GET /api/companion/profile'
    )
    return
  }
  const target = new URL('/api/companion/profile', baseUrl().origin)
  const response = await fetch(target, { headers: { Cookie: cookie } })
  if (response.status === 200 || response.status === 404) {
    record(
      'pass',
      'Pages companion D1 binding visibility',
      `${target.href} returned ${response.status}`
    )
    return
  }
  record(
    'fail',
    'Pages companion D1 binding visibility',
    `${target.href} returned ${response.status}; expected 200 or 404 with a valid auth cookie`
  )
}

async function checkSessionCreateShape(cookie: string | undefined): Promise<void> {
  if (process.env.RUN_SESSION_CREATE_CHECK !== '1') {
    record(
      'skip',
      'login-gated Platform AI session create',
      'set RUN_SESSION_CREATE_CHECK=1 and PLATFORM_AI_AUTH_COOKIE to opt in; this creates and ends a demo-mock session'
    )
    return
  }
  if (cookie === undefined) throw new Error('PLATFORM_AI_AUTH_COOKIE is required')
  const target = wsUrl(`readiness-auth-${Date.now()}`)
  const handshake = await websocketHandshake(target, cookie)
  if (handshake.status !== 101 || handshake.socket === undefined) {
    record(
      'fail',
      'login-gated Platform AI session create',
      `${target.href} returned ${handshake.statusLine}; expected 101 Switching Protocols`
    )
    return
  }
  const ws = new ReadinessSocket(handshake.socket, handshake.leftover)
  ws.sendJson({
    type: 'create',
    gameId: 'demo-mock',
    manualData: {
      version: 'readiness-smoke',
      sections: { intro: 'Post-deploy readiness smoke. No real providers.' },
    },
    gameState: { relevantSections: ['intro'] },
    opening: false,
    gameRunId: `readiness-${Date.now()}`,
  })
  const created = JSON.parse(await ws.readText()) as { type?: string; sessionId?: string }
  if (created.type !== 'created' || typeof created.sessionId !== 'string') {
    ws.close()
    record(
      'fail',
      'login-gated Platform AI session create',
      `unexpected frame ${JSON.stringify(created)}`
    )
    return
  }
  ws.sendJson({ type: 'end' })
  const summary = JSON.parse(await ws.readText()) as { type?: string; summary?: unknown }
  ws.close()
  if (summary.type !== 'summary') {
    record(
      'fail',
      'login-gated Platform AI session create',
      `expected summary frame, got ${JSON.stringify(summary)}`
    )
    return
  }
  record(
    'pass',
    'login-gated Platform AI session create',
    `created demo-mock session ${created.sessionId} and received summary`
  )
}

async function checkD1Schema(): Promise<void> {
  if (process.env.RUN_D1_SCHEMA_CHECK !== '1') {
    record(
      'skip',
      'Companion D1 schema read',
      'set RUN_D1_SCHEMA_CHECK=1 to run wrangler d1 execute --remote read-only schema query'
    )
    return
  }
  const database = process.env.COMPANION_D1_DATABASE_NAME ?? 'amiclaw-companion'
  const sql =
    "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('companion','episode','profile_claim','profile_claim_evidence','asset_entry','capture_event') ORDER BY name;"
  const result = runWrangler(['d1', 'execute', database, '--remote', '--command', sql])
  const combined = `${result.stdout}\n${result.stderr}`
  const requiredTables = [
    'asset_entry',
    'capture_event',
    'companion',
    'episode',
    'profile_claim',
    'profile_claim_evidence',
  ]
  const missingTables = requiredTables.filter((name) => !combined.includes(name))
  if (result.status === 0 && missingTables.length === 0) {
    record('pass', 'Companion D1 schema read', `${database} exposes companion-memory tables`)
    return
  }
  record(
    'fail',
    'Companion D1 schema read',
    missingTables.length > 0
      ? `missing ${missingTables.join(', ')} in ${database}`
      : combined.trim() || 'wrangler d1 execute failed'
  )
}

async function checkUsageWrite(): Promise<void> {
  if (process.env.RUN_USAGE_WRITE_CHECK !== '1') {
    record(
      'skip',
      'USAGE KV write visibility',
      'set RUN_USAGE_WRITE_CHECK=1 and USAGE_KV_NAMESPACE_ID to opt into a write/get/delete smoke'
    )
    return
  }
  const namespaceId = requireEnv('USAGE_KV_NAMESPACE_ID')
  const key = `readiness-smoke:${Date.now()}`
  const value = JSON.stringify({ source: 'platform-ai-readiness', at: new Date().toISOString() })
  const put = runWrangler([
    'kv',
    'key',
    'put',
    key,
    value,
    '--namespace-id',
    namespaceId,
    '--remote',
  ])
  if (put.status !== 0) {
    record('fail', 'USAGE KV write visibility', put.stderr.trim() || put.stdout.trim())
    return
  }
  const get = runWrangler(['kv', 'key', 'get', key, '--namespace-id', namespaceId, '--remote'])
  const del = runWrangler(['kv', 'key', 'delete', key, '--namespace-id', namespaceId, '--remote'])
  if (get.status === 0 && get.stdout.includes('platform-ai-readiness') && del.status === 0) {
    record('pass', 'USAGE KV write visibility', `wrote, read, and deleted ${key}`)
    return
  }
  record(
    'fail',
    'USAGE KV write visibility',
    `get/delete failed after put; get=${get.status} delete=${del.status}`
  )
}

async function main(): Promise<void> {
  const cookie = process.env.PLATFORM_AI_AUTH_COOKIE

  await checkVoiceMapping()
  await checkWorkerVoiceSecretNames()
  await checkUnauthedWsReject()
  await checkCompanionApiReadOnly(cookie)
  await checkSessionCreateShape(cookie)
  await checkD1Schema()
  await checkUsageWrite()

  console.log('\nLog lookup:')
  console.log('- Confirm packages/platform-ai/wrangler.toml keeps [observability].enabled = true.')
  console.log(
    '- Live tail: pnpm exec wrangler --config=packages/platform-ai/wrangler.toml tail platform-ai'
  )
  console.log('- Query Builder: filter Worker = platform-ai and log text contains turn-trace.')
  console.log(
    '- Companion capture: search for companion-capture or companion-consolidator messages.'
  )

  const failed = CHECKS.filter((check) => check.status === 'fail')
  if (failed.length > 0) {
    process.exitCode = 1
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
