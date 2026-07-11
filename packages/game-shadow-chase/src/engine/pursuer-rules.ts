export const PURSUER_RULE_COPY =
  '追兵只锁定你：横竖直线没有墙遮挡时追向你，看不见你就返回月门。它始终比你和伙伴略快；接触或迎面交叉仍会捕获任何一方。每收集一枚光核获得一次换位。'

export const PURSUER_RULE_CONTRACT = Object.freeze({
  eligibility: 'free-visible-player-only',
  vision: Object.freeze({
    alignment: 'same-row-or-column',
    blocker: 'wall-between',
    range: 'full-map',
  }),
  selection: Object.freeze({
    target: 'player-only',
  }),
  noVisibleDestination: 'moon-gate',
  capture: Object.freeze(['same-cell', 'opposite-edge-crossing']),
  difficultyEffects: Object.freeze(['bonus-step-interval', 'rescue-time']),
  swapEconomy: 'one-charge-per-collected-core',
})
