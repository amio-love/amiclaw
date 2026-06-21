import { afterEach, describe, expect, it, vi } from 'vitest'
import { awaitWithTimeout, startDeadline, TIMEOUTS } from './timeout'

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

// --- TIMEOUTS constants -----------------------------------------------------

describe('TIMEOUTS', () => {
  it('exposes conservative connect + first-response defaults (named, not magic)', () => {
    // The exact ms values are L3-tunable, but the connect deadline must be
    // strictly shorter than the first-response deadline: a connection that never
    // comes up should fail before the (longer) first-byte budget would.
    expect(TIMEOUTS.connectMs).toBeGreaterThan(0)
    expect(TIMEOUTS.firstResponseMs).toBeGreaterThan(0)
    expect(TIMEOUTS.connectMs).toBeLessThanOrEqual(TIMEOUTS.firstResponseMs)
  })
})

// --- startDeadline ----------------------------------------------------------

describe('startDeadline', () => {
  it('fires onTimeout once after the delay', () => {
    vi.useFakeTimers()
    const onTimeout = vi.fn()
    startDeadline(1000, onTimeout)
    expect(onTimeout).not.toHaveBeenCalled()
    vi.advanceTimersByTime(999)
    expect(onTimeout).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(onTimeout).toHaveBeenCalledTimes(1)
  })

  it('cancel() before the delay prevents the fire', () => {
    vi.useFakeTimers()
    const onTimeout = vi.fn()
    const deadline = startDeadline(1000, onTimeout)
    deadline.cancel()
    vi.advanceTimersByTime(5000)
    expect(onTimeout).not.toHaveBeenCalled()
  })

  it('cancel() after the fire is a harmless no-op', () => {
    vi.useFakeTimers()
    const onTimeout = vi.fn()
    const deadline = startDeadline(10, onTimeout)
    vi.advanceTimersByTime(10)
    expect(onTimeout).toHaveBeenCalledTimes(1)
    // Calling cancel after firing must not throw and must not re-fire.
    expect(() => deadline.cancel()).not.toThrow()
    expect(onTimeout).toHaveBeenCalledTimes(1)
  })

  it('swallows a throwing onTimeout so it never escapes as an uncaught timer error', () => {
    vi.useFakeTimers()
    // The real call sites do fail-loud work in onTimeout (abort/fail/close) that
    // can throw. A throw on the timer macrotask has no enclosing await to catch
    // it, so the primitive must contain it. advanceTimersByTime runs the timer
    // callback synchronously; if the throw escaped, this advance would itself
    // throw and the assertion would fail.
    const onTimeout = vi.fn(() => {
      throw new Error('cleanup blew up')
    })
    startDeadline(1000, onTimeout)
    expect(() => vi.advanceTimersByTime(1000)).not.toThrow()
    expect(onTimeout).toHaveBeenCalledTimes(1)
  })
})

// --- awaitWithTimeout -------------------------------------------------------

describe('awaitWithTimeout', () => {
  it('resolves with the underlying value when it settles in time (no onTimeout)', async () => {
    const onTimeout = vi.fn()
    const result = await awaitWithTimeout(Promise.resolve('ok'), 1000, 'too slow', onTimeout)
    expect(result).toBe('ok')
    expect(onTimeout).not.toHaveBeenCalled()
  })

  it('propagates the underlying rejection when it rejects in time (no onTimeout)', async () => {
    const onTimeout = vi.fn()
    await expect(
      awaitWithTimeout(Promise.reject(new Error('boom')), 1000, 'too slow', onTimeout)
    ).rejects.toThrow(/boom/)
    expect(onTimeout).not.toHaveBeenCalled()
  })

  it('invokes onTimeout and rejects with the message when the deadline fires first', async () => {
    vi.useFakeTimers()
    const onTimeout = vi.fn()
    // A promise that never settles on its own — only the deadline can resolve the race.
    const pending = new Promise<string>(() => {})
    const raced = awaitWithTimeout(pending, 1000, 'deadline hit', onTimeout)
    const assertion = expect(raced).rejects.toThrow(/deadline hit/)
    await vi.advanceTimersByTimeAsync(1000)
    await assertion
    expect(onTimeout).toHaveBeenCalledTimes(1)
  })

  it('does not fire onTimeout when the promise wins the race, even on a fake clock', async () => {
    vi.useFakeTimers()
    const onTimeout = vi.fn()
    const raced = awaitWithTimeout(Promise.resolve('fast'), 1000, 'unused', onTimeout)
    // Settle the resolved promise's microtasks, then advance well past the deadline.
    await vi.advanceTimersByTimeAsync(0)
    await expect(raced).resolves.toBe('fast')
    await vi.advanceTimersByTimeAsync(5000)
    expect(onTimeout).not.toHaveBeenCalled()
  })

  it('still rejects with Error(message) when onTimeout throws on the timeout branch', async () => {
    vi.useFakeTimers()
    // This is the load-bearing regression guard: if a throwing onTimeout skipped
    // the reject, the timeout promise would never settle, Promise.race would hang
    // forever, and the very deadlock this module exists to prevent would return.
    // The reject must be deterministic regardless of the cleanup throwing.
    const cleanupError = new Error('abort threw')
    const onTimeout = vi.fn(() => {
      throw cleanupError
    })
    const pending = new Promise<string>(() => {})
    const raced = awaitWithTimeout(pending, 1000, 'deadline hit', onTimeout)
    const assertion = expect(raced).rejects.toThrow(/deadline hit/)
    // advanceTimersByTimeAsync drives the timer callback synchronously; a throw
    // escaping the primitive would reject this await and fail the test. It must
    // not — the primitive swallows the cleanup throw and still rejects the race.
    await vi.advanceTimersByTimeAsync(1000)
    await assertion
    expect(onTimeout).toHaveBeenCalledTimes(1)
  })

  it('attaches the onTimeout failure as the reject error cause for diagnosis', async () => {
    vi.useFakeTimers()
    const cleanupError = new Error('abort threw')
    const onTimeout = vi.fn(() => {
      throw cleanupError
    })
    const pending = new Promise<string>(() => {})
    const raced = awaitWithTimeout(pending, 1000, 'deadline hit', onTimeout)
    const captured = raced.catch((err: unknown) => err)
    await vi.advanceTimersByTimeAsync(1000)
    const err = await captured
    expect(err).toBeInstanceOf(Error)
    expect((err as Error).message).toMatch(/deadline hit/)
    expect((err as Error).cause).toBe(cleanupError)
  })
})
