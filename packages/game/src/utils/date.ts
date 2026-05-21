export function getTodayString(): string {
  return new Date().toISOString().slice(0, 10) // YYYY-MM-DD
}

/* Render a `YYYY-MM-DD` string as the Chinese date form
   `YYYY 年 M 月 D 日`, stripping leading zeros from month and day.
   Defaults to today when no argument is given. */
export function toChineseDateString(iso?: string): string {
  const [y, m, d] = (iso ?? getTodayString()).split('-')
  return `${y} 年 ${Number(m)} 月 ${Number(d)} 日`
}
