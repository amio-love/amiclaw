/**
 * Extract a claimed `user_id` from a request without consuming the body the
 * downstream handler still needs.
 *
 * The leaderboard POST handler reads the body via `request.json()`; a body can
 * only be read once. So the guard peeks at a CLONE of the request. Today's
 * device-UUID submissions carry no `user_id`, so this returns null and the
 * guard is a no-op — exactly the required behaviour.
 */

export async function extractClaimedUserId(request: Request): Promise<string | null> {
  // Only JSON bodies can carry a claim in this codebase.
  const contentType = request.headers.get('Content-Type') ?? ''
  if (!contentType.includes('application/json')) return null
  try {
    const body = (await request.clone().json()) as { user_id?: unknown }
    return typeof body.user_id === 'string' && body.user_id.length > 0 ? body.user_id : null
  } catch {
    return null
  }
}
