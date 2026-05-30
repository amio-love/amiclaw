import type { GameMode, ModuleStat } from '@/store/game-context'

// Label keyed by module kind, not list position — practice and daily run
// different module sequences, so a positional lookup would mislabel practice.
// Atlas redesign names (design_handoff_bombsquad README §1): 线路→光弦,
// 密码盘→星盘, 键盘→星符; the button module keeps 按钮.
const MODULE_LABEL: Record<string, string> = {
  wire: '光弦',
  dial: '星盘',
  button: '按钮',
  keypad: '星符',
}

/**
 * Find the index of the slowest module. Stable on ties — ties break toward
 * the earlier index so the player always hears the same name back when they
 * re-read the recap.
 *
 * Returns 0 on empty input; callers must short-circuit on empty stats before
 * trusting the result (see `buildRetroQuestions` empty-stats guard).
 */
function findLongestModuleIndex(stats: ModuleStat[]): number {
  if (stats.length === 0) return 0
  let best = 0
  for (let i = 1; i < stats.length; i++) {
    if (stats[i].timeMs > stats[best].timeMs) {
      best = i
    }
  }
  return best
}

/**
 * Build the spec §5.3 three-question retrospective block:
 *  - Q1: focuses on the slowest module (and its error count, if any)
 *  - Q2: contextual — daily-mode 2nd-or-later attempt invites a comparison;
 *        otherwise asks for a smooth/sticky moment
 *  - Q3: closes the loop on the skills file
 *
 * Output is three "- " bulleted lines, ready to drop straight into the recap.
 */
export function buildRetroQuestions(
  stats: ModuleStat[],
  attemptNumber: number,
  mode: GameMode
): string {
  if (stats.length === 0) return ''
  const longestIdx = findLongestModuleIndex(stats)
  const longest = stats[longestIdx]
  const longestName = MODULE_LABEL[longest?.moduleType ?? ''] ?? longest?.moduleType ?? '某个'
  const errorCount = longest?.errorCount ?? 0

  const q1 =
    errorCount >= 1
      ? `${longestName}模块耗时最长且失误 ${errorCount} 次，我们的沟通/操作哪里可以改进？`
      : `${longestName}模块耗时最长，我们的沟通/操作哪里可以改进？`

  const q2 =
    mode === 'daily' && attemptNumber > 1
      ? `这是我今天的第 ${attemptNumber} 次尝试，跟前几次比哪里更顺、哪里更卡？`
      : `这一局有什么时刻沟通格外顺、有什么时刻格外卡？`

  const q3 = `我们的 skills 文件需要补什么，下次能再快一点？`

  return `- ${q1}\n- ${q2}\n- ${q3}`
}
