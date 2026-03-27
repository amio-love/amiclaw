import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'

const gameDistDir = resolve('packages/game/dist')
const manualDistDir = resolve('packages/manual/dist')
const manualTargetDir = resolve(gameDistDir, 'manual')

if (!existsSync(gameDistDir)) {
  throw new Error(`Game build output not found: ${gameDistDir}`)
}

if (!existsSync(manualDistDir)) {
  throw new Error(`Manual build output not found: ${manualDistDir}`)
}

rmSync(manualTargetDir, { recursive: true, force: true })
mkdirSync(manualTargetDir, { recursive: true })
cpSync(manualDistDir, manualTargetDir, { recursive: true })

console.log(`Assembled Cloudflare Pages assets in ${manualTargetDir}`)
