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

  return env.ASSETS.fetch(request)
}
