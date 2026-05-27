import { Link } from 'react-router-dom'

// Scaffold placeholder — sibling 2 implements per handoff §6.5.
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

export function PageSign() {
  return (
    <main style={wrap}>
      <h1>今日卦签（sign）</h1>
      <p>TODO: handoff §6.5 in sibling 2</p>
      <Link to="/home" style={{ color: '#f0c750' }}>
        ↺ 回到首页
      </Link>
    </main>
  )
}
