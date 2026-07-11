/**
 * Top-level view switch for the Radio Cipher prototype. The URL hash carries
 * BOTH the screen and the level: `#/` / `#/?level=2` select the listener's
 * 监听台; `#/codebook` / `#/codebook?level=2` select the decoder's 密码本. The
 * level travels with the codebook link so a shared codebook always matches the
 * listener's current level. Screens are keyed by level so switching remounts a
 * fresh engine session + stopwatch.
 */

import { useEffect, useState } from 'react'
import { CodebookPage } from './components/CodebookPage'
import { ListenerScreen } from './components/ListenerScreen'
import { resolveLevel } from './content/levels'

type Route = 'listener' | 'codebook'

interface Location {
  route: Route
  levelKey: string
}

function currentLocation(): Location {
  // hash forms: "", "/", "?level=2", "/codebook", "codebook?level=2", …
  const hash = window.location.hash.replace(/^#\/?/, '')
  const [path, query = ''] = hash.split('?')
  const route: Route = path === 'codebook' ? 'codebook' : 'listener'
  const levelKey = new URLSearchParams(query).get('level') ?? '1'
  return { route, levelKey }
}

export function App() {
  const [{ route, levelKey }, setLocation] = useState<Location>(currentLocation)

  useEffect(() => {
    const handler = () => setLocation(currentLocation())
    window.addEventListener('hashchange', handler)
    return () => window.removeEventListener('hashchange', handler)
  }, [])

  const playableLevel = resolveLevel(levelKey)

  return (
    <main className="app">
      {route === 'codebook' ? (
        <CodebookPage key={playableLevel.key} playableLevel={playableLevel} />
      ) : (
        <ListenerScreen key={playableLevel.key} playableLevel={playableLevel} />
      )}
    </main>
  )
}
