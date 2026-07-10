export const PURSUER_RULE_COPY =
  '追兵能看见整条没有墙遮挡的横竖直线：它追最近且未被捕获的可见影子，距离相同时不换目标；谁都看不见就返回月门。同格或迎面交叉会被捕获。诱敌只改变伙伴走位，难度只改变追兵速度和救援时间。'

export const PURSUER_RULE_CONTRACT = Object.freeze({
  eligibility: 'free-visible-shadows',
  vision: Object.freeze({
    alignment: 'same-row-or-column',
    blocker: 'wall-between',
    range: 'full-map',
  }),
  selection: Object.freeze({
    metric: 'shortest-path-distance',
    tie: 'retain-last-eligible-actor-target',
    initialFallback: 'player',
  }),
  noVisibleDestination: 'moon-gate',
  capture: Object.freeze(['same-cell', 'opposite-edge-crossing']),
  difficultyEffects: Object.freeze(['movement-cadence', 'rescue-time']),
  decoyAuthority: 'companion-movement-only',
})
