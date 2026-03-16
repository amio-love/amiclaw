import { handlePostScore } from './handlers/post-score'
import { handleGetLeaderboard } from './handlers/get-leaderboard'

interface Env {
  LEADERBOARD: KVNamespace
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': 'https://bombsquad.amio.fans',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS })
    }

    const url = new URL(request.url)

    if (request.method === 'POST' && url.pathname === '/api/leaderboard') {
      return addCors(await handlePostScore(request, env.LEADERBOARD))
    }

    if (request.method === 'GET' && url.pathname === '/api/leaderboard') {
      return addCors(await handleGetLeaderboard(request, env.LEADERBOARD))
    }

    return new Response('Not Found', { status: 404 })
  },
}

function addCors(response: Response): Response {
  const r = new Response(response.body, response)
  for (const [key, value] of Object.entries(CORS_HEADERS)) {
    r.headers.set(key, value)
  }
  return r
}
