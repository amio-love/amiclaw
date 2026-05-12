import { handlePostEvent } from '../../packages/api/src/handlers/post-event'

interface Env {
  LEADERBOARD: KVNamespace
}

interface Context {
  request: Request
  env: Env
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': 'https://bombsquad.amio.fans',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

export async function onRequest(context: Context): Promise<Response> {
  const { request, env } = context

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS })
  }

  if (request.method === 'POST') {
    return addCors(await handlePostEvent(request, env.LEADERBOARD))
  }

  return addCors(new Response('Method Not Allowed', { status: 405 }))
}

function addCors(response: Response): Response {
  const nextResponse = new Response(response.body, response)
  for (const [key, value] of Object.entries(CORS_HEADERS)) {
    nextResponse.headers.set(key, value)
  }
  return nextResponse
}
