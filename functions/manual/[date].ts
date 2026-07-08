import { getTodayString } from '../../shared/date'

interface Env {
  ASSETS: { fetch: (req: Request) => Promise<Response> }
}

interface Context {
  request: Request
  params: { date: string }
  env: Env
}

export async function onRequest(context: Context): Promise<Response> {
  const { request, params, env } = context
  const url = new URL(request.url)

  // The literal `/manual/daily` is not a dated asset — a hand-typed or
  // bookmarked `/manual/daily` used to render blank (F11). Redirect it to
  // today's dated manual (the same UTC product-day source every daily surface
  // uses), preserving any `?format=yaml` so an AI fetching the YAML form still
  // gets it. The product's own links already point at the dated form, so this
  // only rescues the manually-guessed path.
  if (params.date === 'daily') {
    const target = new URL(`/manual/${getTodayString()}`, request.url)
    target.search = url.search
    return Response.redirect(target.toString(), 302)
  }

  const format = url.searchParams.get('format')
  const acceptHeader = request.headers.get('Accept') ?? ''

  const wantsYaml =
    format === 'yaml' ||
    format === 'text' ||
    acceptHeader.includes('application/yaml') ||
    acceptHeader.includes('text/plain')

  if (wantsYaml) {
    const yamlUrl = new URL(request.url)
    yamlUrl.pathname = `/manual/data/${params.date}.yaml`
    const yamlResponse = await env.ASSETS.fetch(new Request(yamlUrl.toString(), request))
    if (!yamlResponse.ok) {
      return new Response(`Manual not found: ${params.date}`, { status: 404 })
    }

    return new Response(await yamlResponse.text(), {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'public, max-age=3600',
      },
    })
  }

  // HTML path. A bare `/manual/<date>` (no trailing slash) is a directory
  // path. On the real Cloudflare Pages edge, ASSETS replies with an empty 308
  // redirect to the canonical `/manual/<date>/` form — and a fetch for the
  // explicit `/manual/<date>/index.html` ALSO 308-redirects to the same
  // directory URL. A weak external AI fetcher that does not follow redirects
  // then sees an empty body and cannot read the manual at all.
  //
  // Rather than guess the canonical asset path, let ASSETS tell us: fetch the
  // request as-is, and if it answers with a 3xx redirect, follow that redirect
  // exactly once to the `location` it names and re-emit the resulting body as a
  // 200 `text/html`. This serves the anti-human HTML page in one hop with no
  // redirect, using ASSETS' own notion of the canonical URL instead of a
  // hard-coded `/index.html` guess. A normal asset request (the trailing-slash
  // form, or any direct file) is not a 3xx and passes through untouched, so the
  // existing 200 path is undisturbed. The follow is single-hop and non-
  // recursive: if the followed response is still not 200, the original response
  // is returned unchanged so we never manufacture a 404 regression.
  const res = await env.ASSETS.fetch(request)
  const isRedirect = res.status >= 300 && res.status < 400
  const location = res.headers.get('location')
  if (!isRedirect || !location) {
    return res
  }

  const followUrl = new URL(location, request.url)
  const followed = await env.ASSETS.fetch(new Request(followUrl.toString(), request))
  if (!followed.ok) {
    return res
  }

  return new Response(await followed.text(), {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    },
  })
}
