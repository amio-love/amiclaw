export interface LeaderboardPlayerMetadata {
  aiTool: string
  aiModel?: string
}

const AI_TOOL_KEY = 'bombsquad-leaderboard-ai-tool'
const AI_MODEL_KEY = 'bombsquad-leaderboard-ai-model'

export const LEADERBOARD_AI_TOOL_MAX_LENGTH = 40
export const LEADERBOARD_AI_MODEL_MAX_LENGTH = 80

export function isValidLeaderboardAiTool(value: unknown): boolean {
  if (typeof value !== 'string') return false
  const trimmed = value.trim()
  return trimmed.length > 0 && trimmed.length <= LEADERBOARD_AI_TOOL_MAX_LENGTH
}

export function normalizeLeaderboardAiModel(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  if (trimmed.length === 0) return undefined
  return trimmed.slice(0, LEADERBOARD_AI_MODEL_MAX_LENGTH)
}

export function getStoredLeaderboardPlayerMetadata(): LeaderboardPlayerMetadata | null {
  try {
    const rawAiTool = localStorage.getItem(AI_TOOL_KEY)
    if (!isValidLeaderboardAiTool(rawAiTool)) return null
    const aiTool = (rawAiTool as string).trim()
    const aiModel = normalizeLeaderboardAiModel(localStorage.getItem(AI_MODEL_KEY))
    return aiModel ? { aiTool, aiModel } : { aiTool }
  } catch {
    return null
  }
}

export function setStoredLeaderboardPlayerMetadata(metadata: LeaderboardPlayerMetadata): boolean {
  if (!isValidLeaderboardAiTool(metadata.aiTool)) return false
  const aiTool = metadata.aiTool.trim()
  const aiModel = normalizeLeaderboardAiModel(metadata.aiModel)
  try {
    localStorage.setItem(AI_TOOL_KEY, aiTool)
    if (aiModel) {
      localStorage.setItem(AI_MODEL_KEY, aiModel)
    } else {
      localStorage.removeItem(AI_MODEL_KEY)
    }
    return true
  } catch {
    return false
  }
}
