import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, Scenery } from '@amiclaw/ui'
import { recordOracleLocalSign } from '@amiclaw/arcade-profile/local'
import { submitArcadeProfileEvent } from '@amiclaw/arcade-profile/api-client'
import { getTodayString } from '@shared/date'
import { Hexagram } from '../glyphs'
import { changedValues, ganzhi, hexagramFromBinary, type YaoSextet } from '../glyphs/utils'
import { useSession } from '../session'
import styles from './PageSign.module.css'

/* Sign — handoff §6.5. Shareable oracle card with header / hex row /
   judgment / divider / insight / vermilion seal foot. Demo data falls back
   to 同人 #13 → 无妄 #25 when the session hasn't cast yet (e.g. direct
   navigation, Phase-1 persistence is sessionStorage-only). */

/* Fallback to the canonical demo cast result (handoff prototype). */
const DEMO_YAO: YaoSextet = [7, 8, 9, 7, 7, 7]

const JUDGMENT = '同人于野，亨。利涉大川，利君子贞。'
const INSIGHT =
  '在协同与方向之间，你正寻求一致。占据更高视角，便能看见同心而异轨者亦可同人——主动停一停，不是放弃，是让真正的同行人显形。'
type SaveState = 'demo' | 'saving' | 'saved-local' | 'synced' | 'account-error'
type ShareState = 'idle' | 'shared' | 'copied' | 'error'

function todayCN(): string {
  const d = new Date()
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`
}

export function PageSign() {
  const navigate = useNavigate()
  const { sessionId, yaoValues } = useSession()
  const [saveState, setSaveState] = useState<SaveState>(yaoValues === null ? 'demo' : 'saving')
  const [shareState, setShareState] = useState<ShareState>('idle')

  const values: YaoSextet = yaoValues ?? DEMO_YAO
  const changed = changedValues(values) as unknown as YaoSextet
  const [, benCn] = hexagramFromBinary(values)
  const [, bianCn] = hexagramFromBinary(changed)

  useEffect(() => {
    if (yaoValues === null) {
      queueMicrotask(() => setSaveState('demo'))
      return
    }
    const event = recordOracleLocalSign({
      sessionId,
      signDate: getTodayString(),
      ben: benCn,
      bian: bianCn,
      yaoValues: [...yaoValues] as [number, number, number, number, number, number],
    })
    if (!event) {
      queueMicrotask(() => setSaveState('account-error'))
      return
    }
    queueMicrotask(() => setSaveState('saved-local'))
    submitArcadeProfileEvent(event).then((result) => {
      setSaveState(
        result.kind === 'ok' ? 'synced' : result.kind === 'anon' ? 'saved-local' : 'account-error'
      )
    })
  }, [bianCn, benCn, sessionId, yaoValues])

  const shareText = useCallback(
    () => `AMIO 游乐场今日卦签：${benCn} → ${bianCn}。${INSIGHT} ${window.location.origin}/oracle/`,
    [benCn, bianCn]
  )

  const handleShare = useCallback(async () => {
    const text = shareText()
    try {
      const share = (navigator as Navigator & { share?: (data: ShareData) => Promise<void> }).share
      if (share) {
        await share({
          title: 'AMIO Arcade Oracle',
          text,
          url: `${window.location.origin}/oracle/`,
        })
        setShareState('shared')
        return
      }
      if (!navigator.clipboard?.writeText) throw new Error('clipboard unavailable')
      await navigator.clipboard.writeText(text)
      setShareState('copied')
    } catch {
      setShareState('error')
    }
  }, [shareText])

  const handleCopy = useCallback(async () => {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('clipboard unavailable')
      await navigator.clipboard.writeText(shareText())
      setShareState('copied')
    } catch {
      setShareState('error')
    }
  }, [shareText])

  return (
    <main className={styles.page}>
      <Scenery accent="yellow" />

      <div className={styles.content}>
        <div className={styles.header}>
          <button
            type="button"
            className={styles.iconBtn}
            onClick={() => navigate('/home')}
            aria-label="返回"
          >
            <svg
              viewBox="0 0 24 24"
              width="20"
              height="20"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
            >
              <path d="M15 4 L7 12 L15 20" />
            </svg>
          </button>
          <div className={styles.headerTitle}>今日卦签</div>
          <div className={styles.headerMeta}>
            <div className={styles.headerStep}>完成</div>
            <div className={styles.headerSub}>可分享</div>
          </div>
        </div>

        <div className={styles.card}>
          <div className={styles.cardHead}>
            <span className={styles.cardLbl}>AMIO 游乐场 · 卦签</span>
            <span className={styles.cardDate}>{todayCN()}</span>
          </div>

          <div className={styles.hexRow}>
            <div className={`${styles.col} ${styles.colBen}`}>
              <Hexagram values={values} size={80} lineH={10} gap={5} />
              <span className={styles.colTtl}>{benCn}</span>
              <span className={styles.colRole}>本卦 · {benCn}</span>
            </div>
            <span className={styles.hexArrow}>→</span>
            <div className={`${styles.col} ${styles.colBian}`}>
              <Hexagram values={changed} size={80} lineH={10} gap={5} />
              <span className={styles.colTtl}>{bianCn}</span>
              <span className={styles.colRole}>变卦 · {bianCn}</span>
            </div>
          </div>

          <div className={styles.judgment}>{JUDGMENT}</div>

          <div className={styles.divider}>AI 洞见</div>

          <div className={styles.insight}>{INSIGHT}</div>

          <div className={styles.foot}>
            <div className={styles.footUrl}>claw.amio.fans/oracle</div>
            <div className={styles.seal}>
              <span className={styles.sealL1}>{benCn}</span>
              <span className={styles.sealL2}>{ganzhi()}</span>
            </div>
          </div>
        </div>

        <div className={styles.actions}>
          <div className={styles.feedback}>
            <span className={styles.feedbackLabel}>保存状态</span>
            <strong className={styles.feedbackValue}>{saveStatusText(saveState)}</strong>
            <span className={styles.feedbackMeta}>
              {yaoValues === null ? 'Demo 卦签不会写入档案。' : '真实卦签已计入今日清单。'}
            </span>
            {shareState !== 'idle' && (
              <span className={styles.feedbackMeta}>{shareStatusText(shareState)}</span>
            )}
          </div>
          <Button variant="primary" onClick={handleShare}>
            <svg
              viewBox="0 0 24 24"
              width="16"
              height="16"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              style={{ marginRight: 6 }}
            >
              <path d="M4 12 v8 a1 1 0 0 0 1 1 h14 a1 1 0 0 0 1 -1 v-8" />
              <path d="M16 6 L12 2 L8 6" />
              <line x1="12" y1="2" x2="12" y2="15" />
            </svg>
            分享卦签
          </Button>
          <Button variant="ghost" onClick={handleCopy}>
            <svg
              viewBox="0 0 24 24"
              width="16"
              height="16"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              style={{ marginRight: 6 }}
            >
              <rect x="9" y="9" width="13" height="13" rx="2" />
              <path d="M5 15 H4 a2 2 0 0 1 -2 -2 V4 a2 2 0 0 1 2 -2 h9 a2 2 0 0 1 2 2 v1" />
            </svg>
            复制卦签
          </Button>
          <Button variant="ghost" onClick={() => window.location.assign('/me')}>
            保存到我的档案
          </Button>
          <Button variant="ghost" onClick={() => navigate('/casting')}>
            再问一次
          </Button>
          <button type="button" className={styles.textLink} onClick={() => navigate('/home')}>
            ← 回首页
          </button>
        </div>
      </div>
    </main>
  )
}

function saveStatusText(state: SaveState): string {
  switch (state) {
    case 'synced':
      return '已保存到账号档案'
    case 'saved-local':
      return '已保存到本设备'
    case 'account-error':
      return '本设备已保存，账号同步失败'
    case 'saving':
      return '保存中…'
    default:
      return '等待真实卦签'
  }
}

function shareStatusText(state: ShareState): string {
  switch (state) {
    case 'shared':
      return '已打开系统分享。'
    case 'copied':
      return '分享文案已复制。'
    case 'error':
      return '分享失败，请稍后再试。'
    default:
      return ''
  }
}
