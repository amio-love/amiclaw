/* Ambient module declarations for CSS Modules consumed by this package.
   Mirrors the `*.module.css` type that vite/client provides to consumers
   without taking a hard dependency on Vite (this package is consumed as
   source by both game and game-yijing — each owns its own bundler). */
declare module '*.module.css' {
  const classes: { readonly [key: string]: string }
  export default classes
}
