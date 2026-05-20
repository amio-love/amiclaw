import styles from './PracticeIntro.module.css'

interface PracticeIntroProps {
  /** Starts the run — unlocks audio inside the click gesture, then START_GAME. */
  onStart: () => void
}

/**
 * Practice-mode pre-game briefing. Practice exists to teach a first-time
 * player the core loop, so before the countdown starts we spell out the
 * voice / manual / act cycle and name the two modules this run contains.
 *
 * Kept deliberately lightweight — one screen, not a step-by-step tutorial.
 */
export default function PracticeIntro({ onStart }: PracticeIntroProps) {
  return (
    <div className={styles.intro}>
      <h1 className={styles.title}>练习模式</h1>
      <p className={styles.lede}>
        先花一分钟搞懂你和 AI 搭档怎么配合，再开始。练习不会失败，放心试。
      </p>

      <p className={styles.sectionLabel}>每个模块都是同一个循环</p>
      <ol className={styles.loop}>
        <li>你看炸弹面板，用语音把看到的描述给 AI</li>
        <li>AI 读拆弹手册，查到这一题对应的规则</li>
        <li>AI 用语音告诉你该怎么操作</li>
        <li>你照着做 —— 做错了不会失败，再听一遍 AI 的话，在原题上重试</li>
      </ol>

      <p className={styles.sectionLabel}>这一局有两个模块</p>
      <ul className={styles.modules}>
        <li>
          <strong>线路</strong> —— 把每根线的颜色报给 AI，剪掉它指定的那一根
        </li>
        <li>
          <strong>键盘</strong> —— 把四个符号报给 AI，按它给的顺序逐个点击
        </li>
      </ul>

      <button type="button" className={styles.startBtn} onClick={onStart}>
        开始练习
      </button>
    </div>
  )
}
