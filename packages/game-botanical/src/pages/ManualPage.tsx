import { useSearchParams } from 'react-router-dom'
import { botanicalGameType, levelById } from '@/data/load'
import { renderBotanicalManual } from '@/manual/render-manual'
import ManualPanel from '@/manual/ManualPanel'

/* Dev/inspection route (/manual): the botanist-side manual for the selected
   level (`?level=<id>`, default bg-demo-001). Not linked from the player screen —
   the shipped player is the gardener; the AI botanist consumes toManualData().
   Reachable by URL for inspection. */
export function ManualPage() {
  const [params] = useSearchParams()
  const level = levelById(params.get('level')).level
  const manual = renderBotanicalManual(botanicalGameType, level)
  return <ManualPanel manual={manual} />
}
