/**
 * Robust text copy shared by every share/copy surface (SSOT).
 *
 * Tries the async Clipboard API first, then falls back to the legacy
 * `document.execCommand('copy')` on a hidden textarea. The async API rejects in
 * more contexts than it is missing from — no user gesture, an unfocused
 * document (headless / background tab), or a permissions block — so a present
 * `writeText` that throws must still degrade to the legacy path rather than
 * report failure. Returns `true` only when the text was actually copied; the
 * caller surfaces its own terminal fallback (e.g. a select-to-copy field) on
 * `false`, never a bare failure message.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      /* fall through to legacy */
    }
  }
  const el = document.createElement('textarea')
  el.value = text
  el.style.position = 'fixed'
  el.style.opacity = '0'
  document.body.appendChild(el)
  el.select()
  const ok = document.execCommand('copy')
  document.body.removeChild(el)
  return ok
}
