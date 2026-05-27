import { Link } from 'react-router-dom'

// Scaffold placeholder — sibling 2 implements per handoff §6.3.
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

export function PageCasting() {
  return (
    <main style={wrap}>
      <h1>起卦（casting）</h1>
      <p>TODO: handoff §6.3 in sibling 2</p>
      <Link to="/reading" style={{ color: '#f0c750' }}>
        → 读心
      </Link>
      <Link to="/projection" style={{ color: '#888' }}>
        ← 心象
      </Link>
    </main>
  )
}
