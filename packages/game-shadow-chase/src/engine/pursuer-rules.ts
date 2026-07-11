export const PURSUER_RULE_COPY =
  '追兵始终以略快速度走最短路：玩家自由时只追玩家，玩家被捕时转追伙伴，玩家获救后立即转回。碰到任意一方都会捕获；每枚光核提供一次换位，三枚集齐后月门立即开启。'

export const PURSUER_RULE_CONTRACT = Object.freeze({
  tracking: 'full-current-position',
  path: 'deterministic-shortest',
  selection: Object.freeze({
    primary: 'player',
    whilePlayerCaptured: 'companion',
  }),
  capture: Object.freeze(['same-cell', 'opposite-edge-crossing']),
  difficultyEffects: Object.freeze(['bonus-step-interval', 'rescue-time']),
  swapEconomy: 'one-charge-per-collected-core',
  exitUnlock: 'all-cores-collected',
})
