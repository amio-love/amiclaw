export function bombsquadRunSourceKey(runId: string): string {
  return `bombsquad:${runId}`
}

export function oracleSignSourceKey(signDate: string, sessionId: string): string {
  return `oracle:${signDate}:${sessionId}`
}
