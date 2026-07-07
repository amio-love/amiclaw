import { useNavigate } from 'react-router-dom'
import { Button, Scenery } from '@amiclaw/ui'
import { ProjArt, PROJ_KEYS } from '../glyphs'
import { useSession } from '../session'
import styles from './PageProjection.module.css'

/* Projection — handoff §6.2. Pick 2 of 6 abstract images; FIFO replacement
   at length 2 (delegated to SessionProvider.pickImage). */
export function PageProjection() {
  const navigate = useNavigate()
  const { picked, pickImage, clearPicks } = useSession()

  const ready = picked.length === 2

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
          <div className={styles.headerTitle}>起意</div>
          <div className={styles.headerMeta}>
            <div className={styles.headerStep}>第 1 步 / 3</div>
            <div className={styles.headerSub}>心象 · 选两张</div>
          </div>
        </div>

        <div className={styles.intro}>
          <div className={styles.intent}>
            <span className={styles.intentLbl}>起意</span>
            <p className={styles.intentLine}>
              先在心里默默想着<span className={styles.intentAccent}>一件最近放不下的事</span>——
              <br />
              不用说出口，选两张此刻最有感觉的图。
            </p>
          </div>
          <p className={styles.hint}>
            没有对错。选图只是仪式的一部分，帮你把心里那件事想得更清楚。
          </p>
        </div>

        <div className={styles.grid}>
          {PROJ_KEYS.map((k) => {
            const idx = picked.indexOf(k)
            const selected = idx >= 0
            const order = (idx + 1) as 1 | 2
            return (
              <ProjArt
                key={k}
                id={k}
                selected={selected}
                selectionOrder={selected ? order : undefined}
                onClick={() => pickImage(k)}
              />
            )
          })}
        </div>

        <div className={styles.counter}>
          已选 <span className={styles.counterAccent}>{picked.length} / 2</span>
        </div>

        <div className={styles.cta}>
          <Button variant="ghost" onClick={clearPicks} disabled={picked.length === 0}>
            清空
          </Button>
          <Button variant="primary" onClick={() => navigate('/casting')} disabled={!ready}>
            {ready ? '确认 · 开始投币 →' : `还差 ${2 - picked.length} 张`}
          </Button>
        </div>
      </div>
    </main>
  )
}
