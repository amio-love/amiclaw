import type { ShadowChaseSettlement } from './settlement-contract'

export function handoffSettlement(settlement: ShadowChaseSettlement): void {
  void fetch('/api/shadow-chase/settlement', {
    method: 'POST',
    credentials: 'include',
    keepalive: true,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(settlement),
  }).catch(() => undefined)
}
