import { createRoot } from 'react-dom/client'
import { loadGameType, loadLevel } from '../src/schema/load'
import radioCipherGameTypeYaml from '../fixtures/radio-cipher/game-type.yaml?raw'
import radioCipherLevelYaml from '../fixtures/radio-cipher/level.rc-demo-001.yaml?raw'
import soundGardenGameTypeYaml from '../fixtures/sound-garden/game-type.yaml?raw'
import soundGardenLevelYaml from '../fixtures/sound-garden/level.sg-demo-001.yaml?raw'
import botanicalGameTypeYaml from '../fixtures/botanical-garden/game-type.yaml?raw'
import botanicalLevelYaml from '../fixtures/botanical-garden/level.bg-demo-001.yaml?raw'
import type { GameOption } from './App'
import { App } from './App'
import { DevShellStore } from './store'
import './app.css'

const games: GameOption[] = [
  {
    id: 'radio-cipher',
    label: 'Radio Cipher (hidden_info_coop)',
    create: () =>
      new DevShellStore(loadGameType(radioCipherGameTypeYaml), loadLevel(radioCipherLevelYaml)),
  },
  {
    id: 'sound-garden',
    label: 'Sound Garden (co_build)',
    create: () =>
      new DevShellStore(loadGameType(soundGardenGameTypeYaml), loadLevel(soundGardenLevelYaml)),
  },
  {
    id: 'botanical-garden',
    label: 'Botanical Garden (hidden_info_coop)',
    create: () =>
      new DevShellStore(loadGameType(botanicalGameTypeYaml), loadLevel(botanicalLevelYaml)),
  },
]

createRoot(document.getElementById('root') as HTMLElement).render(<App games={games} />)
