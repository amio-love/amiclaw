// Minimal static preview server for the assembled Cloudflare Pages tree
// (packages/platform/dist). It exists because `vite preview` only does a
// single-root SPA history fallback, but the assembled deploy root hosts THREE
// apps — the platform shell at `/`, BombSquad (a BrowserRouter SPA) under
// `/bombsquad/`, and the Yijing Oracle (HashRouter) under `/oracle/`. The e2e
// suite hard-loads and reloads deep BombSquad routes (e.g. /bombsquad/result),
// which must fall back to the BombSquad sub-app's index, not the platform shell.
//
// This server mirrors production Cloudflare Pages routing: serve real files
// first, then apply the same rules encoded in
// packages/platform/public/_redirects (copied to the dist root by the build) —
//   /game, /result, …  ->  /bombsquad/…       (legacy 301 redirects)
//   /bombsquad/*        ->  /bombsquad/index.html  (BombSquad SPA history fallback)
//   /*                  ->  /index.html             (platform shell history fallback)
//
// The 301 rules must be honored as real 301 responses (not just 200 rewrites)
// so local preview matches production: a hard-load of /game/run returns a 301
// to /bombsquad/run, exactly as Cloudflare Pages would serve it.
//
// Zero dependencies on purpose — it must run in CI with only Node available.

import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { extname, join, normalize, resolve } from 'node:path'

const ROOT = resolve(process.argv[2] ?? 'packages/platform/dist')
const PORT = Number(process.env.PORT ?? 4173)

// Parse the exact-match 301 redirect rules from the dist-root _redirects file.
// Only the `<from> <to> 301` form is needed here (the 200 SPA fallbacks are
// handled by resolveTarget); splat/placeholder rules are out of scope.
async function loadRedirects() {
  const map = new Map()
  const raw = await readFile(join(ROOT, '_redirects'), 'utf8').catch(() => '')
  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const [from, to, status] = trimmed.split(/\s+/)
    if (status === '301' && from && to && !from.includes('*')) {
      map.set(from, to)
    }
  }
  return map
}

const REDIRECTS = await loadRedirects()

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
  '.yaml': 'text/yaml; charset=utf-8',
  '.yml': 'text/yaml; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
}

async function tryFile(absPath) {
  try {
    const info = await stat(absPath)
    if (info.isFile()) return absPath
    if (info.isDirectory()) {
      const indexPath = join(absPath, 'index.html')
      const indexInfo = await stat(indexPath).catch(() => null)
      if (indexInfo?.isFile()) return indexPath
    }
  } catch {
    /* not found */
  }
  return null
}

async function resolveTarget(pathname) {
  // Block path traversal: normalize and ensure the resolved path stays in ROOT.
  const safe = normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, '')
  const direct = await tryFile(join(ROOT, safe))
  if (direct) return direct

  // Fallback rules (order matches packages/platform/public/_redirects).
  if (pathname.startsWith('/bombsquad/')) {
    return join(ROOT, 'bombsquad', 'index.html')
  }
  return join(ROOT, 'index.html')
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', `http://localhost:${PORT}`)

    // Legacy 301 redirects take precedence over file serving / SPA fallback,
    // mirroring Cloudflare Pages: an exact-match _redirects 301 rule wins.
    const redirectTo = REDIRECTS.get(url.pathname)
    if (redirectTo) {
      res.writeHead(301, { location: redirectTo + url.search })
      res.end()
      return
    }

    const target = await resolveTarget(url.pathname)
    const body = await readFile(target)
    res.writeHead(200, { 'content-type': MIME[extname(target)] ?? 'application/octet-stream' })
    res.end(body)
  } catch (err) {
    res.writeHead(500)
    res.end(`preview-pages error: ${err instanceof Error ? err.message : String(err)}`)
  }
})

server.listen(PORT, () => {
  console.log(`preview-pages serving ${ROOT} at http://localhost:${PORT}`)
})
