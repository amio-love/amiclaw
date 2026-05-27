import { Link } from 'react-router-dom'

// Scaffold placeholder — sibling 2 implements per handoff §6.1.
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

export function PageHome() {
  return (
    <main style={wrap}>
      <h1>易经签卜（home）</h1>
      <p>TODO: implement per handoff §6.1 in sibling 2</p>
      <Link to="/projection" style={{ color: '#f0c750' }}>
        → 心象选择
      </Link>
    </main>
  )
}
