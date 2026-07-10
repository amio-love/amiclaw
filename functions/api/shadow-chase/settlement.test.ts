import { describe, expect, it } from 'vitest'

import { createSession, buildSessionCookie } from '../../../packages/api/src/auth/session'
import { FakeKV } from '../../../packages/api/src/auth/fake-kv'
import { createTestDb } from '../../../packages/companion-memory/src/test-support/sqlite-db'
import { onRequest } from './settlement'

describe('shadow chase settlement Pages adapter', () => {
  it('registers background capture through the bound context.waitUntil method', async () => {
    const auth = new FakeKV()
    const { sessionId } = await createSession(auth.asKV(), {
      user_id: 'user-a',
      email: 'a@example.com',
    })
    const context = {
      request: new Request('https://claw.amio.fans/api/shadow-chase/settlement', {
        method: 'POST',
        headers: {
          Origin: 'https://claw.amio.fans',
          'Content-Type': 'application/json',
          Cookie: buildSessionCookie(sessionId).split(';')[0],
        },
        body: JSON.stringify({
          version: 1,
          runId: '00000000-0000-4000-8000-000000000009',
          outcome: 'win',
          durationTicks: 800,
        }),
      }),
      env: { AUTH: auth.asKV(), COMPANION_DB: createTestDb() },
      scheduled: [] as Promise<unknown>[],
      waitUntil(promise: Promise<unknown>) {
        if (this !== context) throw new Error('waitUntil lost its context binding')
        this.scheduled.push(promise)
      },
    }

    const response = await onRequest(context)
    expect(response.status).toBe(202)
    expect(context.scheduled).toHaveLength(1)
    await expect(Promise.all(context.scheduled)).resolves.toEqual([undefined])
  })
})
