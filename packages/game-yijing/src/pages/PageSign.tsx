import { useCallback, useEffect, useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { Button, Scenery } from '@amiclaw/ui'
import {
  markArcadeProfileEventsClaimed,
  readArcadeLocalProfile,
  recordOracleLocalSign,
} from '@amiclaw/arcade-profile/local'
import { submitArcadeProfileEvent } from '@amiclaw/arcade-profile/api-client'
import { getTodayString, toChineseDateString } from '@shared/date'
import { Hexagram } from '../glyphs'
import {
  changedValues,
  changingLines,
  ganzhi,
  hexagramFromBinary,
  type YaoSextet,
} from '../glyphs/utils'
import { hexagramByNumber } from '../manual'
import { useSession } from '../session'
import styles from './PageSign.module.css'

/* Sign — handoff §6.5. Shareable oracle card with header / hex row /
   judgment / divider / takeaway / vermilion seal foot. Every text on the
   card is manual data for the cast hexagrams (classical judgment + its
   modern gloss) — no AI-attributed content. Direct navigation without a
   cast redirects home: a sign only exists for a cast the visitor made. */

type SaveState = 'saving' | 'saved-local' | 'synced' | 'account-error' | 'unavailable'
type ShareState = 'idle' | 'shared' | 'copied' | 'error'

export function PageSign() {
  const { yaoValues } = useSession()
  if (yaoValues === null) return <Navigate to="/home" replace />
  return <SignCard values={yaoValues} />
}

function SignCard({ values }: { values: YaoSextet }) {
  const navigate = useNavigate()
  const { sessionId, castCreatedAt } = useSession()
  const [saveState, setSaveState] = useState<SaveState>('saving')
  const [shareState, setShareState] = useState<ShareState>('idle')

  /* The sign's product day (UTC date, shared with the arcade shell): the
     cast timestamp when present. Both the Gregorian date and the 干支 seal
     derive from it, so the card can never show one day's date with another
     day's 干支. */
  const signDate = castCreatedAt?.slice(0, 10) ?? getTodayString()
  const changed = changedValues(values) as unknown as YaoSextet
  const [benNumber, benCn] = hexagramFromBinary(values)
  const [, bianCn] = hexagramFromBinary(changed)

  // Card texts are manual data for the cast hexagram: the classical judgment,
  // plus the first changing line's modern gloss as the takeaway (falling back
  // to the judgment gloss when the cast has no changing lines). An all-six-
  // changing 乾/坤 cast reads 用九/用六 instead, per the canonical rule.
  const benEntry = hexagramByNumber(benNumber)
  const judgment = benEntry?.judgment.classical ?? ''
  const changing = changingLines(values)
  const extraLine = changing.length === 6 ? benEntry?.extra_line : undefined
  const firstChangingLine = (() => {
    if (!benEntry) return undefined
    const position = changing[0]
    if (position === undefined) return undefined
    return benEntry.lines.find((line) => line.position === position + 1)
  })()
  const takeaway =
    extraLine?.modern_interpretation ??
    firstChangingLine?.modern_interpretation ??
    benEntry?.judgment.modern_interpretation ??
    ''

  useEffect(() => {
    if (castCreatedAt === null) {
      queueMicrotask(() => setSaveState('unavailable'))
      return
    }
    const event = recordOracleLocalSign({
      sessionId,
      signDate: castCreatedAt.slice(0, 10),
      ben: benCn,
      bian: bianCn,
      yaoValues: [...values] as [number, number, number, number, number, number],
      createdAt: castCreatedAt,
    })
    if (!event || event.kind !== 'oracle_sign') {
      queueMicrotask(() => setSaveState('unavailable'))
      return
    }
    const sourceKey = event.sign.source_key
    const localProfile = readArcadeLocalProfile()
    const localSaved =
      localProfile?.oracle_signs.some((sign) => sign.source_key === sourceKey) ?? false
    queueMicrotask(() => setSaveState(localSaved ? 'saved-local' : 'unavailable'))
    submitArcadeProfileEvent(event).then((result) => {
      if (result.kind === 'ok') {
        markArcadeProfileEventsClaimed([sourceKey])
        setSaveState('synced')
      } else if (result.kind === 'anon') {
        setSaveState(localSaved ? 'saved-local' : 'unavailable')
      } else {
        setSaveState(localSaved ? 'account-error' : 'unavailable')
      }
    })
  }, [bianCn, benCn, castCreatedAt, sessionId, values])

  const shareText = useCallback(
    () =>
      `AMIO 游乐场今日卦签：${benCn} → ${bianCn}。${takeaway} ${window.location.origin}/oracle/`,
    [benCn, bianCn, takeaway]
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
            <span className={styles.cardDate}>{toChineseDateString(signDate)}</span>
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

          <div className={styles.judgment}>{judgment}</div>

          <div className={styles.divider}>今日提点</div>

          <div className={styles.insight}>{takeaway}</div>

          <div className={styles.foot}>
            <div className={styles.footUrl}>claw.amio.fans/oracle</div>
            <div className={styles.seal}>
              <span className={styles.sealL1}>{benCn}</span>
              <span className={styles.sealL2}>{ganzhi(signDate)}</span>
            </div>
          </div>
        </div>

        <div className={styles.actions}>
          <div className={styles.feedback}>
            <span className={styles.feedbackLabel}>保存状态</span>
            <strong className={styles.feedbackValue}>{saveStatusText(saveState)}</strong>
            <span className={styles.feedbackMeta}>
              {saveState === 'unavailable'
                ? '本次卦签没有写入档案；请重新问卦后再试。'
                : '本次卦签已计入今日清单。'}
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
    case 'unavailable':
      return '本次卦签暂未写入档案'
    default:
      return '保存中…'
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
