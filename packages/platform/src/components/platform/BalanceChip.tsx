import { useState } from 'react'
import { Chip, Modal } from '@amiclaw/ui'
import { STARBURST_GLYPH, STARBURST_LABEL } from '@shared/reward-types'
import type { AssetEntryView } from '@shared/companion-types'
import { useBalance } from '@/hooks/useBalance'
import styles from './BalanceChip.module.css'

/* Human label per ledger `kind` — code / wire use the source-key prefix, the
   drawer renders the player-facing beat. */
const KIND_LABELS: Record<AssetEntryView['kind'], string> = {
  win: '过关奖励',
  checkin: '每日打卡',
  welcome: '见面礼',
  session: '语音陪伴',
  other: '星芒变动',
}

/* Signed amount: credits read +N, deducts read −N (a real minus sign, U+2212). */
function formatAmount(amount: number): string {
  return amount >= 0 ? `+${amount}` : `−${Math.abs(amount)}`
}

/**
 * The authenticated-only starburst balance chip for the TopNav right slot
 * (reward-economy §7). A brand `Chip` showing `✦ <n>`; tapping it opens the
 * shared `Modal` with the recent ledger — NO new route (the e2e flow-inventory
 * stays within existing pages). While the balance is loading or unavailable the
 * chip renders nothing, so the nav never flashes a broken pill.
 */
export default function BalanceChip() {
  const { state, reload } = useBalance(true)
  const [open, setOpen] = useState(false)

  if (state.status !== 'ready') return null

  const openLedger = () => {
    // Re-read so the ledger reflects a win / spend earned earlier this session.
    reload()
    setOpen(true)
  }

  return (
    <>
      <button
        type="button"
        className={styles.chipButton}
        onClick={openLedger}
        aria-label={`${STARBURST_LABEL}余额 ${state.balance}，查看明细`}
      >
        <Chip variant="brand">
          <span className={styles.glyph} aria-hidden="true">
            {STARBURST_GLYPH}
          </span>
          <span className={styles.value}>{state.balance}</span>
        </Chip>
      </button>

      <Modal open={open} onClose={() => setOpen(false)} title={`${STARBURST_LABEL}明细`}>
        <div className={styles.summary}>
          <span className={styles.summaryLabel}>当前{STARBURST_LABEL}</span>
          <span className={styles.summaryValue}>
            {STARBURST_GLYPH} {state.balance}
          </span>
        </div>
        {state.entries.length === 0 ? (
          <p className={styles.empty}>还没有{STARBURST_LABEL}记录，赢一局或每天来打卡就有了。</p>
        ) : (
          <ul className={styles.ledger}>
            {state.entries.map((entry, index) => (
              <li key={`${entry.earned_at}-${index}`} className={styles.entry}>
                <span className={styles.entryKind}>{KIND_LABELS[entry.kind]}</span>
                <span
                  className={`${styles.entryAmount} ${
                    entry.amount >= 0 ? styles.credit : styles.debit
                  }`}
                >
                  {formatAmount(entry.amount)} {STARBURST_GLYPH}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Modal>
    </>
  )
}
