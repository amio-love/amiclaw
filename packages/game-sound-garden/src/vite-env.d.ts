/// <reference types="vite/client" />

// Raw YAML imports (Vite `?raw` suffix) — used to load the sound-garden
// GameType vocabulary from the creation package fixtures without a build step.
declare module '*.yaml?raw' {
  const content: string
  export default content
}
