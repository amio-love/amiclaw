import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'

const platformDistDir = resolve('packages/platform/dist')
const manualDistDir = resolve('packages/manual/dist')
const bombsquadDistDir = resolve('packages/game-bombsquad/dist')
const yijingDistDir = resolve('packages/game-yijing/dist')
const shadowChaseDistDir = resolve('packages/game-shadow-chase/dist')
const botanicalDistDir = resolve('packages/game-botanical/dist')
const radioCipherDistDir = resolve('packages/game-radio-cipher/dist')
const manualTargetDir = resolve(platformDistDir, 'manual')
const bombsquadTargetDir = resolve(platformDistDir, 'bombsquad')
const yijingTargetDir = resolve(platformDistDir, 'oracle')
const shadowChaseTargetDir = resolve(platformDistDir, 'shadow-chase')
const botanicalTargetDir = resolve(platformDistDir, 'botanical')
const radioCipherTargetDir = resolve(platformDistDir, 'radio-cipher')

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

if (!existsSync(shadowChaseDistDir)) {
  throw new Error(`Shadow Chase build output not found: ${shadowChaseDistDir}`)
}

if (!existsSync(botanicalDistDir)) {
  throw new Error(`Botanical build output not found: ${botanicalDistDir}`)
}

if (!existsSync(radioCipherDistDir)) {
  throw new Error(`Radio Cipher build output not found: ${radioCipherDistDir}`)
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

rmSync(shadowChaseTargetDir, { recursive: true, force: true })
mkdirSync(shadowChaseTargetDir, { recursive: true })
cpSync(shadowChaseDistDir, shadowChaseTargetDir, { recursive: true })

rmSync(botanicalTargetDir, { recursive: true, force: true })
mkdirSync(botanicalTargetDir, { recursive: true })
cpSync(botanicalDistDir, botanicalTargetDir, { recursive: true })

rmSync(radioCipherTargetDir, { recursive: true, force: true })
mkdirSync(radioCipherTargetDir, { recursive: true })
cpSync(radioCipherDistDir, radioCipherTargetDir, { recursive: true })

console.log(`Assembled Cloudflare Pages assets in ${manualTargetDir}`)
console.log(`Assembled Cloudflare Pages assets in ${bombsquadTargetDir}`)
console.log(`Assembled Cloudflare Pages assets in ${yijingTargetDir}`)
console.log(`Assembled Cloudflare Pages assets in ${shadowChaseTargetDir}`)
console.log(`Assembled Cloudflare Pages assets in ${botanicalTargetDir}`)
console.log(`Assembled Cloudflare Pages assets in ${radioCipherTargetDir}`)
