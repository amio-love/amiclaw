/**
 * PostGameModal component tests.
 *
 * The modal is now the once-per-device endgame survey ALONE, built on the
 * shared `@amiclaw/ui` Modal primitive (portal + dimmed cosmic backdrop + Esc /
 * backdrop / × dismissal). The nickname gate and the leaderboard AI-tool gate it
 * used to host are retired: a signed-in run auto-submits under the account
 * username and the leaderboard tool is inferred (companion run) or asked once
 * inline on the result surface. These tests exercise the survey shape only.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import PostGameModal from './PostGameModal'
import type { SurveyAnswers } from '@shared/event-types'

function installFakeLocalStorage() {
  const store = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => (store.has(key) ? (store.get(key) as string) : null),
    setItem: (key: string, value: string) => {
      store.set(key, String(value))
    },
    removeItem: (key: string) => {
      store.delete(key)
    },
    clear: () => {
      store.clear()
    },
    get length() {
      return store.size
    },
    key: (i: number) => Array.from(store.keys())[i] ?? null,
  })
  return store
}

/** Answer Q1/Q2/Q3 — the three required survey questions. */
function answerRequiredSurvey({
  aiTool = 'Claude',
  fun = 4,
  difficulty = '刚好',
}: { aiTool?: string; fun?: number; difficulty?: string } = {}) {
  fireEvent.click(screen.getByRole('button', { name: aiTool }))
  fireEvent.click(screen.getByRole('button', { name: `好玩程度 ${fun} 分` }))
  fireEvent.click(screen.getByRole('button', { name: difficulty }))
}

describe('PostGameModal', () => {
  beforeEach(() => {
    installFakeLocalStorage()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('renders nothing when open is false', () => {
    const { container } = render(<PostGameModal open={false} onSubmit={vi.fn()} onSkip={vi.fn()} />)
    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('renders the 4 survey questions, a submit + skip, and a close affordance', () => {
    render(<PostGameModal open onSubmit={vi.fn()} onSkip={vi.fn()} />)

    expect(screen.getByRole('dialog', { name: '聊聊这一局' })).toBeInTheDocument()
    expect(screen.getByText('你这局用的是哪个 AI 工具？')).toBeInTheDocument()
    expect(screen.getByText('整体好玩程度')).toBeInTheDocument()
    expect(screen.getByText('难度感受')).toBeInTheDocument()
    expect(screen.getByText(/AI 最大的问题/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '提交' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '跳过' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '关闭' })).toBeInTheDocument()
    // No nickname section — the gate is retired.
    expect(screen.queryByLabelText(/昵称/)).not.toBeInTheDocument()
  })

  it('disables submit until Q1/Q2/Q3 are all answered', () => {
    render(<PostGameModal open onSubmit={vi.fn()} onSkip={vi.fn()} />)

    const submit = screen.getByRole('button', { name: '提交' })
    expect(submit).toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: 'Claude' }))
    expect(submit).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: '好玩程度 4 分' }))
    expect(submit).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: '刚好' }))
    expect(submit).toBeEnabled()
  })

  it('submit emits onSubmit with the survey answers', () => {
    const onSubmit = vi.fn()
    render(<PostGameModal open onSubmit={onSubmit} onSkip={vi.fn()} />)

    answerRequiredSurvey({ aiTool: 'ChatGPT', fun: 5, difficulty: '太难' })
    fireEvent.click(screen.getByRole('button', { name: '提交' }))

    expect(onSubmit).toHaveBeenCalledTimes(1)
    const survey = onSubmit.mock.calls[0][0] as SurveyAnswers
    expect(survey).toEqual({ ai_tool: 'chatgpt', fun: 5, difficulty: 'too-hard' })
  })

  it('maps each difficulty option to its wire value', () => {
    const cases: Array<[string, string]> = [
      ['太难', 'too-hard'],
      ['刚好', 'just-right'],
      ['太易', 'too-easy'],
    ]
    for (const [label, wire] of cases) {
      const onSubmit = vi.fn()
      const { unmount } = render(<PostGameModal open onSubmit={onSubmit} onSkip={vi.fn()} />)
      answerRequiredSurvey({ difficulty: label })
      fireEvent.click(screen.getByRole('button', { name: '提交' }))
      const survey = onSubmit.mock.calls[0][0] as SurveyAnswers
      expect(survey.difficulty).toBe(wire)
      unmount()
    }
  })

  it('includes the trimmed AI-issue free text when Q4 is filled', () => {
    const onSubmit = vi.fn()
    render(<PostGameModal open onSubmit={onSubmit} onSkip={vi.fn()} />)

    answerRequiredSurvey()
    const issue = screen.getByRole('textbox', { name: /AI 最大的问题/ })
    fireEvent.change(issue, { target: { value: '  经常听不懂线路颜色  ' } })
    fireEvent.click(screen.getByRole('button', { name: '提交' }))

    const survey = onSubmit.mock.calls[0][0] as SurveyAnswers
    expect(survey.ai_issue).toBe('经常听不懂线路颜色')
  })

  it('omits ai_issue when Q4 is left empty', () => {
    const onSubmit = vi.fn()
    render(<PostGameModal open onSubmit={onSubmit} onSkip={vi.fn()} />)

    answerRequiredSurvey()
    fireEvent.click(screen.getByRole('button', { name: '提交' }))

    const survey = onSubmit.mock.calls[0][0] as SurveyAnswers
    expect(survey).not.toHaveProperty('ai_issue')
  })

  it('Q1 「其他」 reveals a text input and uses it as the ai_tool value', () => {
    const onSubmit = vi.fn()
    render(<PostGameModal open onSubmit={onSubmit} onSkip={vi.fn()} />)

    // The free-text input is hidden until 其他 is picked.
    expect(screen.queryByLabelText('其他 AI 工具名称')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '其他' }))
    const otherInput = screen.getByLabelText('其他 AI 工具名称')
    expect(otherInput).toBeInTheDocument()

    // 其他 picked but empty → submit stays disabled.
    fireEvent.click(screen.getByRole('button', { name: '好玩程度 3 分' }))
    fireEvent.click(screen.getByRole('button', { name: '刚好' }))
    expect(screen.getByRole('button', { name: '提交' })).toBeDisabled()

    fireEvent.change(otherInput, { target: { value: 'Copilot' } })
    fireEvent.click(screen.getByRole('button', { name: '提交' }))

    const survey = onSubmit.mock.calls[0][0] as SurveyAnswers
    expect(survey.ai_tool).toBe('Copilot')
  })

  it('the 跳过 button calls onSkip and never fires onSubmit', () => {
    const onSubmit = vi.fn()
    const onSkip = vi.fn()
    render(<PostGameModal open onSubmit={onSubmit} onSkip={onSkip} />)

    fireEvent.click(screen.getByRole('button', { name: '跳过' }))
    expect(onSkip).toHaveBeenCalledTimes(1)
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('a backdrop click, the × control, and Escape all dismiss via onSkip', () => {
    const onSkip = vi.fn()
    render(<PostGameModal open onSubmit={vi.fn()} onSkip={onSkip} />)

    // Backdrop = the element wrapping the dialog (Modal portals to <body>).
    const backdrop = screen.getByRole('dialog').parentElement as HTMLElement
    fireEvent.click(backdrop)
    expect(onSkip).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: '关闭' }))
    expect(onSkip).toHaveBeenCalledTimes(2)

    // Modal listens on document; a keydown bubbling up from the dialog reaches it.
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect(onSkip).toHaveBeenCalledTimes(3)
  })
})
