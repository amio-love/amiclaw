/**
 * Builds the 译码员密码本 (decoder codebook) model STRICTLY from the engine's
 * decoder role-view + the level rules. It never imports the playable content
 * module, so the plaintext answer is structurally unable to leak onto the
 * codebook — the information partition is enforced by construction, not by
 * discipline. Everything here is decoder-allowed (method, key, ring, category,
 * frequency hints); none of it is the answer.
 */

import { GameSession } from '@amiclaw/creation'
import type { GameType, Level, LevelRule } from '@amiclaw/creation'
import { FINALS_RING } from '../codec/finals-ring'

const CHINESE_ORDINALS = ['一', '二', '三', '四', '五', '六', '七', '八']

// plaintext_category has no display_labels in the fixture — map to a natural
// Chinese noun for the codebook's category hint.
const CATEGORY_NOUN: Record<string, string> = {
  animal: '动物',
  color: '颜色',
  number_word: '数字',
  direction: '方向',
  weather: '天气',
}

export interface CodebookSegment {
  id: string
  label: string
  categoryHint: string
  methodLabel: string
  keyLine: string
}

export interface CodebookFrequencyHint {
  typeLabel: string
  syllable: string
}

/**
 * Present only when a Caesar segment's key withholds its shift_amount (level 2):
 * the decoder must derive the offset from the frequency hint. `mostFrequent` is
 * the most-frequent-plaintext-final hint that anchors the derivation.
 */
export interface CodebookDerivation {
  mostFrequent: string
}

export interface Codebook {
  ring: readonly string[]
  segments: CodebookSegment[]
  frequencyHints: CodebookFrequencyHint[]
  /** Set when at least one Caesar key hides its shift (deduction level). */
  derivation?: CodebookDerivation
}

function displayLabel(
  gameType: GameType,
  archetypeId: string,
  attribute: string,
  value: string
): string {
  const archetype = gameType.element_archetypes.find((a) => a.id === archetypeId)
  const attr = archetype?.attributes.find((a) => a.name === attribute)
  return attr?.display_labels?.[value] ?? value
}

/** The decrypt rule (caesar or reverse) whose binding names this segment. */
function decryptRuleFor(level: Level, segmentId: string): LevelRule | undefined {
  return level.rules.find(
    (rule) =>
      (rule.template === 'decrypt_step' || rule.template === 'reverse_decrypt') &&
      rule.bindings.cipher_segment_id === segmentId
  )
}

export function buildCodebook(gameType: GameType, level: Level): Codebook {
  const decoderView = new GameSession(gameType, level).getRoleView('decoder')
  const segmentViews = decoderView.elements.filter(
    (element) => element.archetype === 'cipher_segment'
  )

  let unknownShift = false
  const segments: CodebookSegment[] = segmentViews.map((element, index) => {
    const category = String(element.visible_params.plaintext_category ?? '')
    const rule = decryptRuleFor(level, element.element_id)
    let methodLabel = displayLabel(gameType, 'cipher_key', 'target_method', 'reverse')
    let keyLine = '音节顺序倒着念即可，无需密钥。'
    if (rule?.template === 'decrypt_step') {
      const keyId = String(rule.bindings.cipher_key_id ?? '')
      const keyView = decoderView.elements.find((e) => e.element_id === keyId)
      const method = String(keyView?.visible_params.target_method ?? 'caesar_shift')
      const shiftRaw = keyView?.visible_params.shift_amount
      methodLabel = displayLabel(gameType, 'cipher_key', 'target_method', method)
      if (shiftRaw === undefined) {
        // Deduction level: the key names the method but withholds the offset.
        unknownShift = true
        keyLine = '偏移量未知——密钥只给了方法。用下方「频率推导」算出偏移量，再回拨解密。'
      } else {
        const shift = Number(shiftRaw)
        keyLine = `偏移量 ${shift}：把每个音节的韵母，在韵母环上回拨 ${shift} 格即得解密韵母。`
      }
    }
    return {
      id: element.element_id,
      label: `段${CHINESE_ORDINALS[index] ?? index + 1}`,
      categoryHint: `答案是一种${CATEGORY_NOUN[category] ?? category}`,
      methodLabel,
      keyLine,
    }
  })

  const hintElements = decoderView.elements.filter(
    (element) => element.archetype === 'frequency_hint'
  )
  const frequencyHints: CodebookFrequencyHint[] = hintElements.map((element) => ({
    typeLabel: displayLabel(
      gameType,
      'frequency_hint',
      'hint_type',
      String(element.visible_params.hint_type ?? '')
    ),
    syllable: String(element.visible_params.target_syllable ?? ''),
  }))

  let derivation: CodebookDerivation | undefined
  if (unknownShift) {
    const mostFrequent = hintElements.find(
      (element) => String(element.visible_params.hint_type ?? '') === 'most_frequent'
    )
    derivation = { mostFrequent: String(mostFrequent?.visible_params.target_syllable ?? 'a') }
  }

  return { ring: FINALS_RING, segments, frequencyHints, derivation }
}
