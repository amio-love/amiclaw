import {
  handlePostShadowChaseSettlement,
  type ShadowChaseSettlementEnv,
} from '../../../packages/api/src/handlers/shadow-chase-settlement'

interface Context {
  request: Request
  env: ShadowChaseSettlementEnv
  waitUntil(promise: Promise<unknown>): void
}

/** Thin Pages adapter. HTTP/auth/persistence semantics live in packages/api. */
export async function onRequest(context: Context): Promise<Response> {
  return handlePostShadowChaseSettlement(context.request, context.env, {
    scheduler: {
      schedule(promise) {
        // Do not destructure waitUntil: Workers binds it to the execution context.
        context.waitUntil(promise)
      },
    },
  })
}
