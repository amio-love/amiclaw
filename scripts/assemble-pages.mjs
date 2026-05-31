import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'

const platformDistDir = resolve('packages/platform/dist')
const manualDistDir = resolve('packages/manual/dist')
const bombsquadDistDir = resolve('packages/game-bombsquad/dist')
const yijingDistDir = resolve('packages/game-yijing/dist')
const manualTargetDir = resolve(platformDistDir, 'manual')
const bombsquadTargetDir = resolve(platformDistDir, 'bombsquad')
const yijingTargetDir = resolve(platformDistDir, 'oracle')

if (!existsSync(platformDistDir)) {
  throw new Error(`Platform build output not found: ${platformDistDir}`)
}

if (!existsSync(manualDistDir)) {
  throw new Error(`Manual build output not found: ${manualDistDir}`)
}

if (!existsSync(bombsquadDistDir)) {
  throw new Error(`BombSquad build output not found: ${bombsquadDistDir}`)
}

if (!existsSync(yijingDistDir)) {
  throw new Error(`Yijing build output not found: ${yijingDistDir}`)
}

rmSync(manualTargetDir, { recursive: true, force: true })
mkdirSync(manualTargetDir, { recursive: true })
cpSync(manualDistDir, manualTargetDir, { recursive: true })

rmSync(bombsquadTargetDir, { recursive: true, force: true })
mkdirSync(bombsquadTargetDir, { recursive: true })
cpSync(bombsquadDistDir, bombsquadTargetDir, { recursive: true })

rmSync(yijingTargetDir, { recursive: true, force: true })
mkdirSync(yijingTargetDir, { recursive: true })
cpSync(yijingDistDir, yijingTargetDir, { recursive: true })

console.log(`Assembled Cloudflare Pages assets in ${manualTargetDir}`)
console.log(`Assembled Cloudflare Pages assets in ${bombsquadTargetDir}`)
console.log(`Assembled Cloudflare Pages assets in ${yijingTargetDir}`)
