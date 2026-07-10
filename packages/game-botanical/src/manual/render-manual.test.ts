import { describe, it, expect } from 'vitest'
import { renderBotanicalManual, toManualData, type RenderedManual } from './render-manual'
import { botanicalGameType, levelById, tutorialLevel } from '@/data/load'

const manual = renderBotanicalManual(botanicalGameType, tutorialLevel)

function section(m: RenderedManual, id: string) {
  const s = m.sections.find((x) => x.id === id)
  if (!s) throw new Error(`section ${id} missing`)
  return s
}

describe('renderBotanicalManual — bg-demo-001 v1.1.0', () => {
  it('emits the expected sections in a stable order (addressing)', () => {
    expect(manual.version).toBe('1.1.0')
    expect(manual.sections.map((s) => s.id)).toEqual([
      'objective',
      'species_care:orchid',
      'danger:fern',
      'compatibility',
      'light',
      'growth',
      'health_and_decay',
    ])
    // section ids are unique
    const ids = manual.sections.map((s) => s.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('objective renders win + lose from the level conditions', () => {
    const lines = section(manual, 'objective').lines.join('\n')
    expect(lines).toContain('稳定（stable）')
    expect(lines).toContain('开花（flowering）')
    expect(lines).toContain('枯死（dead）')
    expect(lines).toContain('至少 1 株')
  })

  it('species_care reads the heal precondition from the needs rule', () => {
    const s = section(manual, 'species_care:orchid')
    expect(s.title).toBe('兰花 · 养护要点')
    expect(s.lines[0]).toContain('半荫（partial_shade）')
    expect(s.lines[0]).toContain('恢复健康')
  })

  it('danger reads the harm precondition from the needs rule', () => {
    const s = section(manual, 'danger:fern')
    expect(s.title).toBe('蕨类 · 风险提示')
    expect(s.lines[0]).toContain('全荫（full_shade）')
    expect(s.lines[0]).toContain('受损')
  })

  it('compatibility renders every matrix relation as strategic info', () => {
    const lines = section(manual, 'compatibility').lines
    expect(lines).toContain('蕨类（fern） 与 多肉（succulent）：相克（incompatible）')
    expect(lines).toContain('蕨类（fern） 与 苔藓（moss）：协同（synergy）')
    // 1 lead line + 5 matrix rows
    expect(lines).toHaveLength(6)
  })

  it('light renders the shade ladder with the player verb', () => {
    const lines = section(manual, 'light').lines.join('\n')
    expect(lines).toContain('全光经遮光变为半荫')
    expect(lines).toContain('半荫经遮光变为全荫')
  })

  it('growth renders the fertilize→repot→bloom sequence', () => {
    const lines = section(manual, 'growth').lines
    expect(lines).toContain('幼苗经施肥变为成株')
    expect(lines).toContain('成株经换盆变为成熟')
    expect(lines).toContain('成熟经催花变为开花')
  })

  it('health_and_decay renders the ladder, decay timing, and death', () => {
    const lines = section(manual, 'health_and_decay').lines.join('\n')
    expect(lines).toContain(
      '枯死（dead） < 垂危（critical） < 枯萎（wilting） < 稳定（stable） < 茁壮（thriving）'
    )
    expect(lines).toContain('浇水（correct_care）可提升健康')
    expect(lines).toContain('过量浇水（wrong_care）会降低健康')
    expect(lines).toContain('无人照料（neglect）会随时间衰退')
    expect(lines).toContain('每约 60 秒衰退一次，临近前 8 秒会预警')
    expect(lines).toContain('枯死即无法挽回')
  })

  it('golden: full rendered manual is pinned for bg-demo-001', () => {
    expect(manual).toMatchSnapshot('bg-demo-001')
  })
})

describe('toManualData — platform-ai contract projection', () => {
  it('keys sections by stable section id and carries the version', () => {
    const data = toManualData(manual)
    expect(data.version).toBe('1.1.0')
    expect(Object.keys(data.sections).sort()).toEqual(manual.sections.map((s) => s.id).sort())
    // each value is the addressable section (title + lines)
    const objective = data.sections['objective'] as { title: string; lines: string[] }
    expect(objective.title).toBe('目标与败局')
    expect(Array.isArray(objective.lines)).toBe(true)
  })
})

describe('renderBotanicalManual — bg-standard-001 v1.1.0', () => {
  const standard = renderBotanicalManual(botanicalGameType, levelById('bg-standard-001').level)

  it('emits a per-species care section for BOTH shade-healed plants (no danger section)', () => {
    expect(standard.version).toBe('1.1.0')
    expect(standard.sections.map((s) => s.id)).toEqual([
      'objective',
      'species_care:orchid',
      'species_care:fern',
      'compatibility',
      'light',
      'growth',
      'health_and_decay',
    ])
  })

  it('surfaces the irreversible over-shade LOCKOUT danger for orchid AND fern', () => {
    // The load-bearing honesty requirement: a botanist consulting about the
    // orchid/fern must be warned that over-shading to full_shade is irreversible
    // (their heal rule never fires again, and no verb raises light).
    for (const species of ['orchid', 'fern'] as const) {
      const lines = section(standard, `species_care:${species}`).lines.join('\n')
      expect(lines).toContain('只有在光照为半荫（partial_shade）时') // conditional heal
      expect(lines).toContain('全荫（full_shade）') // where it locks out
      expect(lines).toContain('再也无法恢复健康') // irreversible
      expect(lines).toContain('切勿遮光过头') // the actionable warning
    }
  })

  it('scopes the correct_care line HONESTLY: watering does NOT heal the shade-only plants', () => {
    const lines = section(standard, 'health_and_decay').lines.join('\n')
    // Watering heals only the three water-healed species...
    expect(lines).toContain(
      '浇水（correct_care）仅能提升 苔藓（moss）、多肉（succulent）、藤蔓（vine） 的健康'
    )
    // ...and the manual explicitly says it does NOT heal orchid/fern.
    expect(lines).toContain('兰花（orchid）、蕨类（fern）浇水无效')
    // The false universal claim must be gone.
    expect(lines).not.toContain('浇水（correct_care）可提升健康：')
    // Decay stays universal (every plant decays).
    expect(lines).toContain('无人照料（neglect）会随时间衰退')
    expect(lines).toContain('每约 60 秒衰退一次')
  })

  it('compatibility renders the synergy pair and the informational relations', () => {
    const lines = section(standard, 'compatibility').lines
    expect(lines).toContain('苔藓（moss） 与 多肉（succulent）：协同（synergy）')
    expect(lines).toContain('多肉（succulent） 与 藤蔓（vine）：相容（compatible）')
    expect(lines).toContain('苔藓（moss） 与 藤蔓（vine）：中性（neutral）')
  })

  it('golden: full rendered manual is pinned for bg-standard-001', () => {
    expect(standard).toMatchSnapshot('bg-standard-001')
  })
})
