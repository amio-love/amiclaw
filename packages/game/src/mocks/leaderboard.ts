import type { LeaderboardEntry } from '@shared/leaderboard-types'

/* Mock leaderboard data for the Atlas homepage and the (Phase 7)
   leaderboard page. Every row reuses the shared LeaderboardEntry shape
   so mock and real-API rows render through identical markup. The real
   daily API stays scoped to the /leaderboard 每日 tab (blueprint §7);
   the homepage mini board and the week/month/all-time tabs are mock. */

/* FeaturedBombSquad right-panel mini board (§6.4) — three ranked
   players plus the signed-in player's own (你) row. */
export const featuredMini: LeaderboardEntry[] = [
  { rank: 1, nickname: 'Skyfall_42', time_ms: 42000, attempt_number: 3, ai_tool: 'claude' },
  { rank: 2, nickname: '林星海', time_ms: 51000, attempt_number: 2, ai_tool: 'chatgpt' },
  { rank: 3, nickname: 'dustbloom', time_ms: 58000, attempt_number: 1, ai_tool: 'gemini' },
  { rank: 247, nickname: '林星海（你）', time_ms: 194000, attempt_number: 11, ai_tool: 'claude' },
]

/* 本周 tab — weekly aggregate board. */
export const weekRows: LeaderboardEntry[] = [
  { rank: 1, nickname: 'Skyfall_42', time_ms: 42000, attempt_number: 3, ai_tool: 'claude' },
  { rank: 2, nickname: '林星海', time_ms: 51000, attempt_number: 5, ai_tool: 'chatgpt' },
  { rank: 3, nickname: 'dustbloom', time_ms: 58000, attempt_number: 2, ai_tool: 'gemini' },
  { rank: 4, nickname: '小汪', time_ms: 62000, attempt_number: 4, ai_tool: 'claude' },
  { rank: 5, nickname: 'aurora', time_ms: 68000, attempt_number: 7, ai_tool: 'chatgpt' },
  { rank: 6, nickname: '石头剪刀布', time_ms: 74000, attempt_number: 2, ai_tool: 'gemini' },
  { rank: 7, nickname: '夜空灯塔', time_ms: 81000, attempt_number: 9, ai_tool: 'claude' },
  { rank: 8, nickname: '南瓜灯', time_ms: 88000, attempt_number: 6, ai_tool: 'chatgpt' },
  { rank: 9, nickname: 'apricot', time_ms: 95000, attempt_number: 4, ai_tool: 'gemini' },
  { rank: 10, nickname: '潮汐过境', time_ms: 101000, attempt_number: 5, ai_tool: 'claude' },
  { rank: 247, nickname: '林星海（你）', time_ms: 194000, attempt_number: 11, ai_tool: 'claude' },
]

/* 本月 tab — monthly aggregate board. */
export const monthRows: LeaderboardEntry[] = [
  { rank: 1, nickname: 'nova_lin', time_ms: 39000, attempt_number: 6, ai_tool: 'claude' },
  { rank: 2, nickname: 'Skyfall_42', time_ms: 44000, attempt_number: 3, ai_tool: 'gemini' },
  { rank: 3, nickname: '潮汐过境', time_ms: 49000, attempt_number: 8, ai_tool: 'chatgpt' },
  { rank: 4, nickname: '夜空灯塔', time_ms: 53000, attempt_number: 4, ai_tool: 'claude' },
  { rank: 5, nickname: '麦田圈', time_ms: 57000, attempt_number: 5, ai_tool: 'gemini' },
  { rank: 6, nickname: 'aurora', time_ms: 61000, attempt_number: 9, ai_tool: 'chatgpt' },
  { rank: 7, nickname: '林星海', time_ms: 66000, attempt_number: 7, ai_tool: 'claude' },
  { rank: 8, nickname: '二进制羊', time_ms: 72000, attempt_number: 3, ai_tool: 'gemini' },
  { rank: 9, nickname: 'dustbloom', time_ms: 79000, attempt_number: 6, ai_tool: 'chatgpt' },
  { rank: 10, nickname: 'codeword', time_ms: 85000, attempt_number: 4, ai_tool: 'claude' },
  { rank: 312, nickname: '林星海（你）', time_ms: 181000, attempt_number: 14, ai_tool: 'claude' },
]

/* 历史 tab — all-time record board. */
export const allTimeRows: LeaderboardEntry[] = [
  { rank: 1, nickname: 'Skyfall_42', time_ms: 31000, attempt_number: 12, ai_tool: 'claude' },
  { rank: 2, nickname: 'phantom_键', time_ms: 34000, attempt_number: 8, ai_tool: 'gemini' },
  { rank: 3, nickname: 'nova_lin', time_ms: 36000, attempt_number: 10, ai_tool: 'chatgpt' },
  { rank: 4, nickname: '量子拆弹手', time_ms: 38000, attempt_number: 6, ai_tool: 'claude' },
  { rank: 5, nickname: 'dustbloom', time_ms: 41000, attempt_number: 9, ai_tool: 'gemini' },
  { rank: 6, nickname: 'aurora', time_ms: 44000, attempt_number: 7, ai_tool: 'chatgpt' },
  { rank: 7, nickname: '潮汐过境', time_ms: 47000, attempt_number: 11, ai_tool: 'claude' },
  { rank: 8, nickname: '林星海', time_ms: 52000, attempt_number: 5, ai_tool: 'gemini' },
  { rank: 9, nickname: '夜空灯塔', time_ms: 55000, attempt_number: 8, ai_tool: 'chatgpt' },
  { rank: 10, nickname: '南瓜灯', time_ms: 59000, attempt_number: 4, ai_tool: 'claude' },
  { rank: 1402, nickname: '林星海（你）', time_ms: 168000, attempt_number: 23, ai_tool: 'claude' },
]
