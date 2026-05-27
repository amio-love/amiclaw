import { Link } from 'react-router-dom'

// Scaffold placeholder — sibling 2 implements per handoff §6.2.
const wrap: React.CSSProperties = {
  minHeight: '100vh',
  padding: 24,
  background: '#111',
  color: '#f0c750',
  display: 'flex',
  flexDirection: 'column',
  gap: 16,
  fontFamily: 'system-ui, sans-serif',
}

export function PageProjection() {
  return (
    <main style={wrap}>
      <h1>心象 · 起意（projection）</h1>
      <p>TODO: handoff §6.2 in sibling 2</p>
      <Link to="/casting" style={{ color: '#f0c750' }}>
        → 起卦
      </Link>
      <Link to="/" style={{ color: '#888' }}>
        ← Home
      </Link>
    </main>
  )
}
