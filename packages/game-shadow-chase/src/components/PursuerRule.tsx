import { PURSUER_RULE_COPY } from '../engine/pursuer-rules'

export const OBJECTIVE_RULE_COPY =
  '收集三枚光核，月门会立即开启，再与伙伴一起抵达出口撤离。战术准备结束后追兵立即行动；任何一方被捕获，都要在倒计时结束前完成救援。'

function RuleVisual() {
  return (
    <div
      className="rule-strip"
      aria-label="追兵走确定性最短路且始终略快；玩家自由时只追玩家，玩家被捕时转追伙伴，获救后转回；接触或迎面交叉会捕获任一方；每枚光核提供一次换位；三枚集齐后月门立即开启"
    >
      <span className="rule-step">
        <svg viewBox="0 0 44 32" aria-hidden="true">
          <path className="danger-stroke" d="M4 26c5-15 13-5 18-16 3-6 8-6 17-6m-5-3 5 3-4 5" />
          <path className="shadow-stroke" d="M34 27v-8l4-5 4 5v8" />
        </svg>
        <span>最短略快</span>
      </span>
      <span className="rule-step">
        <svg viewBox="0 0 44 32" aria-hidden="true">
          <path className="shadow-stroke" d="M3 26V15l5-7 5 7v11M31 26V15l5-7 5 7v11" />
          <path className="danger-stroke" d="M18 8h8m-3-3 3 3-3 3M26 22h-8m3-3-3 3 3 3" />
        </svg>
        <span>目标切换</span>
      </span>
      <span className="rule-step">
        <svg viewBox="0 0 44 32" aria-hidden="true">
          <path className="shadow-stroke" d="M4 26 19 9m-6 0h6v6" />
          <path className="danger-stroke" d="M40 26 25 9m6 0h-6v6M18 21l8-8m0 8-8-8" />
        </svg>
        <span>接触捕获</span>
      </span>
      <span className="rule-step">
        <svg viewBox="0 0 44 32" aria-hidden="true">
          <path className="positive-stroke" d="m8 5 7 6-3 11H4L1 11Z" />
          <path className="shadow-stroke" d="M20 10h20m-5-5 5 5-5 5M40 23H20m5 5-5-5 5-5" />
        </svg>
        <span>光核换位</span>
      </span>
      <span className="rule-step">
        <svg viewBox="0 0 44 32" aria-hidden="true">
          <path
            className="positive-stroke"
            d="M3 7h9m-4-4 4 4-4 4M3 16h9m-4-4 4 4-4 4M3 25h9m-4-4 4 4-4 4"
          />
          <path className="positive-stroke" d="M21 28V14l9-10 9 10v14M27 28V17h6v11" />
        </svg>
        <span>三核开门</span>
      </span>
    </div>
  )
}

export function PursuerRule({ includeObjective = false }: { includeObjective?: boolean }) {
  return (
    <section className="pursuer-rule" aria-label="追兵规则">
      <RuleVisual />
      <details>
        <summary>规则说明</summary>
        {includeObjective && <p>{OBJECTIVE_RULE_COPY}</p>}
        <p>{PURSUER_RULE_COPY}</p>
      </details>
    </section>
  )
}
