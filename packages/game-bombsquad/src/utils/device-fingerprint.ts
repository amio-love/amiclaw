const DEVICE_ID_KEY = 'bombsquad-device-id'

// Session-lifetime fallback for contexts where localStorage access throws
// (site storage blocked, strict tracking prevention, some in-app webviews) or
// is at quota. Keeps getDeviceId total so a submission still fires instead of
// throwing and freezing the settlement on「正在把成绩送上榜…」forever.
let memoryDeviceId: string | null = null

/**
 * Returns a stable device id for the leaderboard. Reads/writes localStorage
 * when available; on any storage failure it degrades to a per-session in-memory
 * UUID rather than throwing. A storage-blocked device therefore still submits —
 * it just draws a fresh id on the next reload, which is harmless because the
 * backend dedupes each run by `run_id`, not by device.
 */
export function getDeviceId(): string {
  try {
    const existing = localStorage.getItem(DEVICE_ID_KEY)
    if (existing) return existing
    const id = crypto.randomUUID()
    localStorage.setItem(DEVICE_ID_KEY, id)
    return id
  } catch {
    if (memoryDeviceId === null) memoryDeviceId = crypto.randomUUID()
    return memoryDeviceId
  }
}
