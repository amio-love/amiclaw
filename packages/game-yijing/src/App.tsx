import { CoinTrio, Hexagram, Taiji, TaijiFrame } from './glyphs'

/* Temporary existence-proof render for the glyph vocabulary port (sibling 1
   Round 3). Sibling 2 will replace this with the 5-screen flow + animations. */
export default function App() {
  console.log('yijing-oracle scaffold mounted')
  return (
    <main
      style={{
        padding: 24,
        color: 'white',
        background: '#111',
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        gap: 24,
        alignItems: 'flex-start',
      }}
    >
      <h1>易经签卜 (scaffold + glyphs)</h1>
      <Hexagram values={[7, 8, 9, 7, 7, 6]} size={120} />
      <Taiji size={130} />
      <TaijiFrame size={240} accent="qian" />
      <CoinTrio sides={['heads', 'tails', 'heads']} />
    </main>
  )
}
