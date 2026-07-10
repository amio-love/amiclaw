export interface ShadowChaseSettlement {
  version: 1
  runId: string
  outcome: 'win' | 'loss' | 'timeout'
  durationTicks: number
}
