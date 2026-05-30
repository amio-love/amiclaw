/**
 * PostGameModal component tests.
 *
 * Covers the unified post-game modal that composes an optional nickname
 * section and an optional 4-question survey section into a single dialog —
 * never two stacked. Three shapes are exercised: survey-only (dismissable),
 * nickname-only (non-dismissable), and the merged nickname+survey modal.
 *
 * Note on localStorage: jsdom's `localStorage` in this workspace is a
 * method-less stub (see `nickname.test.ts`). The modal's nickname section
 * calls the real `setStoredNickname`, so a Map-backed fake is installed so
 * the nickname path round-trips instead of failing into the error branch.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import PostGameModal, { type PostGameModalResult } from './PostGameModal'

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
    const { container } = render(
      <PostGameModal
        open={false}
        showNickname={false}
        showSurvey
        onConfirm={vi.fn()}
        onSkip={vi.fn()}
      />
    )
    expect(container).toBeEmptyDOMElement()
  })

  describe('survey-only modal', () => {
    it('renders the 4 questions and a dismissable affordance', () => {
      render(
        <PostGameModal open showNickname={false} showSurvey onConfirm={vi.fn()} onSkip={vi.fn()} />
      )

      expect(screen.getByRole('dialog')).toBeInTheDocument()
      expect(screen.getByText('你这局用的是哪个 AI 工具？')).toBeInTheDocument()
      expect(screen.getByText('整体好玩程度')).toBeInTheDocument()
      expect(screen.getByText('难度感受')).toBeInTheDocument()
      expect(screen.getByText(/AI 最大的问题/)).toBeInTheDocument()
      // Dismissable: skip button + close affordance present.
      expect(screen.getByRole('button', { name: '跳过' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: '跳过问卷' })).toBeInTheDocument()
      // No nickname section.
      expect(screen.queryByLabelText(/昵称/)).not.toBeInTheDocument()
    })

    it('disables submit until Q1/Q2/Q3 are all answered', () => {
      render(
        <PostGameModal open showNickname={false} showSurvey onConfirm={vi.fn()} onSkip={vi.fn()} />
      )

      const submit = screen.getByRole('button', { name: '提交' })
      expect(submit).toBeDisabled()

      fireEvent.click(screen.getByRole('button', { name: 'Claude' }))
      expect(submit).toBeDisabled()
      fireEvent.click(screen.getByRole('button', { name: '好玩程度 4 分' }))
      expect(submit).toBeDisabled()
      fireEvent.click(screen.getByRole('button', { name: '刚好' }))
      expect(submit).toBeEnabled()
    })

    it('submit emits onConfirm with the survey answers and no nickname', () => {
      const onConfirm = vi.fn()
      render(
        <PostGameModal
          open
          showNickname={false}
          showSurvey
          onConfirm={onConfirm}
          onSkip={vi.fn()}
        />
      )

      answerRequiredSurvey({ aiTool: 'ChatGPT', fun: 5, difficulty: '太难' })
      fireEvent.click(screen.getByRole('button', { name: '提交' }))

      expect(onConfirm).toHaveBeenCalledTimes(1)
      const result = onConfirm.mock.calls[0][0] as PostGameModalResult
      expect(result.nickname).toBeUndefined()
      expect(result.survey).toEqual({
        ai_tool: 'chatgpt',
        fun: 5,
        difficulty: 'too-hard',
      })
    })

    it('maps each difficulty option to its wire value', () => {
      const cases: Array<[string, string]> = [
        ['太难', 'too-hard'],
        ['刚好', 'just-right'],
        ['太易', 'too-easy'],
      ]
      for (const [label, wire] of cases) {
        const onConfirm = vi.fn()
        const { unmount } = render(
          <PostGameModal
            open
            showNickname={false}
            showSurvey
            onConfirm={onConfirm}
            onSkip={vi.fn()}
          />
        )
        answerRequiredSurvey({ difficulty: label })
        fireEvent.click(screen.getByRole('button', { name: '提交' }))
        const result = onConfirm.mock.calls[0][0] as PostGameModalResult
        expect(result.survey?.difficulty).toBe(wire)
        unmount()
      }
    })

    it('includes the trimmed AI-issue free text when Q4 is filled', () => {
      const onConfirm = vi.fn()
      render(
        <PostGameModal
          open
          showNickname={false}
          showSurvey
          onConfirm={onConfirm}
          onSkip={vi.fn()}
        />
      )

      answerRequiredSurvey()
      const issue = screen.getByRole('textbox', { name: /AI 最大的问题/ })
      fireEvent.change(issue, { target: { value: '  经常听不懂线路颜色  ' } })
      fireEvent.click(screen.getByRole('button', { name: '提交' }))

      const result = onConfirm.mock.calls[0][0] as PostGameModalResult
      expect(result.survey?.ai_issue).toBe('经常听不懂线路颜色')
    })

    it('omits ai_issue when Q4 is left empty', () => {
      const onConfirm = vi.fn()
      render(
        <PostGameModal
          open
          showNickname={false}
          showSurvey
          onConfirm={onConfirm}
          onSkip={vi.fn()}
        />
      )

      answerRequiredSurvey()
      fireEvent.click(screen.getByRole('button', { name: '提交' }))

      const result = onConfirm.mock.calls[0][0] as PostGameModalResult
      expect(result.survey).not.toHaveProperty('ai_issue')
    })

    it('Q1 「其他」 reveals a text input and uses it as the ai_tool value', () => {
      const onConfirm = vi.fn()
      render(
        <PostGameModal
          open
          showNickname={false}
          showSurvey
          onConfirm={onConfirm}
          onSkip={vi.fn()}
        />
      )

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

      const result = onConfirm.mock.calls[0][0] as PostGameModalResult
      expect(result.survey?.ai_tool).toBe('Copilot')
    })

    it('skip button calls onSkip and never fires onConfirm', () => {
      const onConfirm = vi.fn()
      const onSkip = vi.fn()
      render(
        <PostGameModal open showNickname={false} showSurvey onConfirm={onConfirm} onSkip={onSkip} />
      )

      fireEvent.click(screen.getByRole('button', { name: '跳过' }))
      expect(onSkip).toHaveBeenCalledTimes(1)
      expect(onConfirm).not.toHaveBeenCalled()
    })

    it('a backdrop click and the Escape key both dismiss via onSkip', () => {
      const onSkip = vi.fn()
      render(
        <PostGameModal open showNickname={false} showSurvey onConfirm={vi.fn()} onSkip={onSkip} />
      )

      // Backdrop = the overlay wrapping the dialog.
      const overlay = screen.getByRole('dialog').parentElement as HTMLElement
      fireEvent.click(overlay)
      expect(onSkip).toHaveBeenCalledTimes(1)

      fireEvent.keyDown(window, { key: 'Escape' })
      expect(onSkip).toHaveBeenCalledTimes(2)
    })
  })

  describe('nickname-only modal', () => {
    it('renders the nickname gate, no survey, and is non-dismissable', () => {
      render(
        <PostGameModal open showNickname showSurvey={false} onConfirm={vi.fn()} onSkip={vi.fn()} />
      )

      expect(screen.getByRole('dialog', { name: /给自己起个名字/ })).toBeInTheDocument()
      expect(screen.getByLabelText(/昵称/)).toBeInTheDocument()
      expect(screen.queryByText('你这局用的是哪个 AI 工具？')).not.toBeInTheDocument()
      // Non-dismissable: no skip / close affordance.
      expect(screen.queryByRole('button', { name: '跳过' })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: '跳过问卷' })).not.toBeInTheDocument()
    })

    it('Escape and backdrop clicks do not dismiss the nickname gate', () => {
      const onSkip = vi.fn()
      render(
        <PostGameModal open showNickname showSurvey={false} onConfirm={vi.fn()} onSkip={onSkip} />
      )

      fireEvent.keyDown(window, { key: 'Escape' })
      fireEvent.click(screen.getByRole('dialog').parentElement as HTMLElement)
      expect(onSkip).not.toHaveBeenCalled()
    })

    it('confirm emits only the nickname once a valid value is typed', () => {
      const onConfirm = vi.fn()
      render(
        <PostGameModal
          open
          showNickname
          showSurvey={false}
          onConfirm={onConfirm}
          onSkip={vi.fn()}
        />
      )

      const confirm = screen.getByRole('button', { name: '确认' })
      expect(confirm).toBeDisabled()

      fireEvent.change(screen.getByLabelText(/昵称/), { target: { value: '小明' } })
      expect(confirm).toBeEnabled()
      fireEvent.click(confirm)

      expect(onConfirm).toHaveBeenCalledTimes(1)
      const result = onConfirm.mock.calls[0][0] as PostGameModalResult
      expect(result.nickname).toBe('小明')
      expect(result.survey).toBeUndefined()
    })
  })

  describe('merged nickname + survey modal', () => {
    it('shows both sections inside a single dialog with the survey marked optional', () => {
      render(<PostGameModal open showNickname showSurvey onConfirm={vi.fn()} onSkip={vi.fn()} />)

      // Exactly one dialog — never two stacked.
      expect(screen.getAllByRole('dialog')).toHaveLength(1)
      expect(screen.getByLabelText(/昵称/)).toBeInTheDocument()
      expect(screen.getByText('你这局用的是哪个 AI 工具？')).toBeInTheDocument()
      // No standalone skip control — but the survey optionality is made plain.
      expect(screen.queryByRole('button', { name: '跳过' })).not.toBeInTheDocument()
      expect(screen.getByText(/问卷选填/)).toBeInTheDocument()
    })

    it('gates confirm on the nickname only — the survey never blocks it', () => {
      const onConfirm = vi.fn()
      render(<PostGameModal open showNickname showSurvey onConfirm={onConfirm} onSkip={vi.fn()} />)

      const confirm = screen.getByRole('button', { name: '确认' })
      expect(confirm).toBeDisabled()

      // A valid nickname alone unlocks confirm — the survey stays untouched.
      fireEvent.change(screen.getByLabelText(/昵称/), { target: { value: '小红' } })
      expect(confirm).toBeEnabled()
      fireEvent.click(confirm)

      expect(onConfirm).toHaveBeenCalledTimes(1)
      const result = onConfirm.mock.calls[0][0] as PostGameModalResult
      expect(result.nickname).toBe('小红')
      // Survey untouched → no survey payload emitted.
      expect(result.survey).toBeUndefined()
    })

    it('emits the survey alongside the nickname when it is fully answered', () => {
      const onConfirm = vi.fn()
      render(<PostGameModal open showNickname showSurvey onConfirm={onConfirm} onSkip={vi.fn()} />)

      fireEvent.change(screen.getByLabelText(/昵称/), { target: { value: '小红' } })
      answerRequiredSurvey({ aiTool: 'Gemini', fun: 2, difficulty: '太易' })
      fireEvent.click(screen.getByRole('button', { name: '确认' }))

      expect(onConfirm).toHaveBeenCalledTimes(1)
      const result = onConfirm.mock.calls[0][0] as PostGameModalResult
      expect(result.nickname).toBe('小红')
      expect(result.survey).toEqual({
        ai_tool: 'gemini',
        fun: 2,
        difficulty: 'too-easy',
      })
    })

    it('drops a partially-answered survey on confirm', () => {
      const onConfirm = vi.fn()
      render(<PostGameModal open showNickname showSurvey onConfirm={onConfirm} onSkip={vi.fn()} />)

      fireEvent.change(screen.getByLabelText(/昵称/), { target: { value: '小红' } })
      // Only Q1 answered — Q2/Q3 left blank.
      fireEvent.click(screen.getByRole('button', { name: 'Claude' }))
      const confirm = screen.getByRole('button', { name: '确认' })
      expect(confirm).toBeEnabled()
      fireEvent.click(confirm)

      const result = onConfirm.mock.calls[0][0] as PostGameModalResult
      expect(result.nickname).toBe('小红')
      expect(result.survey).toBeUndefined()
    })

    it('keeps confirm disabled until the nickname is valid even with a full survey', () => {
      render(<PostGameModal open showNickname showSurvey onConfirm={vi.fn()} onSkip={vi.fn()} />)

      answerRequiredSurvey()
      // Survey complete but nickname still empty → confirm stays disabled.
      expect(screen.getByRole('button', { name: '确认' })).toBeDisabled()
    })
  })
})
