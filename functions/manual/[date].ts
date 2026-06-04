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
  // path: handing `request` straight to `env.ASSETS.fetch` makes Cloudflare
  // ASSETS reply with an empty 308 redirect to `/manual/<date>/`. A weak
  // external AI fetcher that does not follow redirects then sees an empty
  // body and cannot read the manual at all. Instead, fetch the canonical
  // index asset directly (pathname normalised to `/manual/<date>/index.html`)
  // and re-emit its body as a 200 so the no-trailing-slash URL returns the
  // anti-human HTML page in one hop, no redirect. A request that already
  // targets a normal asset (e.g. the trailing-slash form, or any path ending
  // in a file extension) is passed through untouched so the normal 200 path
  // is not disturbed.
  const path = url.pathname
  const isDirectoryPath = !path.endsWith('/') && !/\.[^/]+$/.test(path)
  if (!isDirectoryPath) {
    return env.ASSETS.fetch(request)
  }

  const htmlUrl = new URL(request.url)
  htmlUrl.pathname = `${path}/index.html`
  const htmlResponse = await env.ASSETS.fetch(new Request(htmlUrl.toString(), request))
  if (!htmlResponse.ok) {
    return new Response(`Manual not found: ${params.date}`, { status: 404 })
  }

  return new Response(await htmlResponse.text(), {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    },
  })
}
