import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'

const gameDistDir = resolve('packages/game/dist')
const manualDistDir = resolve('packages/manual/dist')
const yijingDistDir = resolve('packages/game-yijing/dist')
const manualTargetDir = resolve(gameDistDir, 'manual')
const yijingTargetDir = resolve(gameDistDir, 'oracle')

if (!existsSync(gameDistDir)) {
  throw new Error(`Game build output not found: ${gameDistDir}`)
}

if (!existsSync(manualDistDir)) {
  throw new Error(`Manual build output not found: ${manualDistDir}`)
}

if (!existsSync(yijingDistDir)) {
  throw new Error(`Yijing build output not found: ${yijingDistDir}`)
}

rmSync(manualTargetDir, { recursive: true, force: true })
mkdirSync(manualTargetDir, { recursive: true })
cpSync(manualDistDir, manualTargetDir, { recursive: true })

rmSync(yijingTargetDir, { recursive: true, force: true })
mkdirSync(yijingTargetDir, { recursive: true })
cpSync(yijingDistDir, yijingTargetDir, { recursive: true })

console.log(`Assembled Cloudflare Pages assets in ${manualTargetDir}`)
console.log(`Assembled Cloudflare Pages assets in ${yijingTargetDir}`)
