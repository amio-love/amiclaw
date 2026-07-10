export function nextRng(state: number): { state: number; value: number } {
  const next = (state + 0x6d2b79f5) >>> 0
  let value = next
  value = Math.imul(value ^ (value >>> 15), value | 1)
  value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
  return { state: next, value: ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296 }
}

export function chooseSeeded<T>(items: readonly T[], state: number): { state: number; item: T } {
  if (items.length === 0) throw new Error('Cannot choose from an empty list')
  const next = nextRng(state)
  return { state: next.state, item: items[Math.floor(next.value * items.length)] }
}
