import { Link } from 'react-router-dom'

// Scaffold placeholder — sibling 2 implements per handoff §6.4.
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

export function PageReading() {
  return (
    <main style={wrap}>
      <h1>读心 · 解读（reading）</h1>
      <p>TODO: handoff §6.4 in sibling 2</p>
      <Link to="/sign" style={{ color: '#f0c750' }}>
        → 卦签
      </Link>
      <Link to="/casting" style={{ color: '#888' }}>
        ← 起卦
      </Link>
    </main>
  )
}
