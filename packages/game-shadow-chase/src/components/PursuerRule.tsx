import { PURSUER_RULE_COPY } from '../engine/pursuer-rules'

export function PursuerRule() {
  return (
    <section className="pursuer-rule" aria-label="追兵规则">
      <strong>追兵规则</strong>
      <p>{PURSUER_RULE_COPY}</p>
    </section>
  )
}
