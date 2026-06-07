import { copyFileSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'fs'
import { resolve, join, dirname, basename } from 'path'
import { fileURLToPath } from 'url'
import yaml from 'js-yaml'
// On Node 25 + tsx, `shared/*.ts` files load as CJS-via-default because
// `shared/` has no `package.json` with `"type": "module"` to opt into
// native ESM. The named exports therefore live under the default import
// rather than at the namespace top level. Pulling SYMBOLS through the
// default import is the most localised workaround — no scope creep into
// the shared package, and we still rely on the SYMBOLS SSOT (no inlined
// description copy).
import sharedSymbolsModule from '../../shared/symbols.ts'
const { SYMBOLS } = sharedSymbolsModule
import { validateNoSourceAiInstructions, validateNoSourceSymbols } from './validators.ts'

/**
 * Local copy of the Manual / validator types to avoid the ESM+CJS interop
 * trap when tsx loads `shared/manual-schema.ts` from a `"type": "module"`
 * package on Node 25. The shapes are intentionally minimal — only what the
 * build-time validator needs. The full schema lives in
 * `shared/manual-schema.ts`; the `manual-schema.test.ts` suite in the game
 * package exercises the real `validateManualSymbols` against shipped YAMLs.
 *
 * NOTE: `shared/symbols.ts` is a leaf module (no imports of its own) and
 * imports cleanly via tsx, which is why we pull SYMBOLS directly above
 * instead of inlining a copy.
 */
interface MinimalModules {
  symbol_dial?: { columns?: string[][] }
  keypad?: { sequences?: string[][] }
}
interface MinimalManual {
  meta?: { version?: string; type?: string }
  modules: MinimalModules
  symbols?: Record<string, { description?: string }>
  ai_instructions?: Record<string, string[]>
}

/**
 * Hard output constraints for the AI partner, injected at build time into
 * every rendered manual (practice + every daily). The manual is the only
 * surface the AI is actually given — players never read it — so the rules
 * governing what the AI may say to the player belong here, as data the AI
 * reads before any puzzle rule.
 *
 * Injected (like `symbols`) rather than authored into each source yaml:
 * one SSOT covers all 360+ committed daily files plus every future one,
 * and survives the daily generator's wholesale `meta` rewrite.
 */
const AI_INSTRUCTIONS: Record<string, string[]> = {
  game_overview: [
    'BombSquad 是一个人机语音协作拆弹游戏。玩家站在炸弹前，看得到面板却查不了任何资料；你（AI）持有这份手册、却看不到炸弹。两人只能靠语音沟通，合力把这颗炸弹拆掉。',
    '一颗炸弹由若干模块组成，一次只显示一个，逐个拆完即获胜。每日挑战有 4 个模块——光弦、星盘、按钮、星符；练习模式精简到 2 个——光弦和星符。这些是玩家屏幕上显示的模块名，玩家会用这些名字称呼眼前的模块。',
    '开局时屏幕底部有一行全局场景信息栏，其中电池数量、指示灯亮灭是很多模块规则都会用到的真实输入：玩家开局会先把电池和指示灯念给你一次，请记住备用。栏里排在最前的「暗号」是一句中文短句，纯属背景装饰、不参与任何模块的规则，玩家就算念了也只当氛围，绝不拿去匹配规则。',
    '两种模式都是正计时（秒表）：时间从 00:00 往上走，拆得越快，每日挑战的排名越靠前——时间是成绩，不是引信。每日挑战只在累计三次失误时炸弹才会爆炸，时间本身不会引爆炸弹；练习模式更宽容——答错可在原题重试、不计失误，也从不爆炸。',
    '配合的循环是：玩家描述他看到的画面 → 你查手册找到匹配规则 → 你说出一个玩家此刻就能执行的具体动作 → 玩家执行 → 进入下一个模块，循环往复直到把所有模块拆完。',
    '手册里还混有 morse_code、maze、memory 等诱饵模块，它们永远不会在真正的游戏里出现，纯属干扰项——请直接忽略，也绝不向玩家提起它们的存在。',
  ],
  game_context: [
    '你是拆弹手册专家。玩家永远看不到这份手册，整份文档只为你而存在。你的任务是把读到的每一条规则，翻译成一个玩家此刻就能执行的具体动作。',
    '玩家是站在炸弹前的拆弹手。他们能看到炸弹的电线、按钮、显示屏和符号，却无法查阅任何资料。他们关于该怎么做的全部认知，都来自你说出口的话。',
    '你与玩家之间唯一的通道是语音。没有文字聊天，没有图示，没有共享屏幕。组织每一条指令时都要让它在被读出口时毫无歧义，且玩家无需追问就能照做。',
    '你和玩家处在同一对话里的同一段连续语音中，他可能一口气连玩好几局。你记得本次对话里之前发生的事——上一局卡在哪、复盘时学到了什么——应当主动用这些把后面的配合做得更快更好。这个「一起复盘、一起变强」的循环正是 BombSquad 的核心玩法。app 不会给你发任何游戏数据，你对每一局的全部了解都来自这段对话本身：玩家描述了什么、你们怎么配合、最后拆成功还是失败。结束页上的逐模块用时、总时和排名是给玩家自己看的，你看不到也不需要，定性的复盘与建议靠你对这段对话的记忆就够。',
    '每一局的炸弹都是重新随机生成的：绝不能假设这一局的线路、符号、按钮和上一局相同。每开一局都让玩家从头把他看到的画面重新描述一遍，再按当前这一局的实际描述去查规则。',
    '唯一要避免的是编造本次对话开始之前的记忆——不要声称记得这段对话之前、某个你根本没经历过的更早会话，也不要凭空捏造先前的上下文。',
    '不论 practice 还是 daily，开局都先请玩家把屏幕底部场景信息栏里的电池数量、指示灯完整念给你一次，记下来整局复用——这些是很多模块规则要用到的全局值，问一次就够，之后绝不反复追问。栏首的「暗号」纯属背景装饰、不参与任何模块的规则，玩家就算念了也只当氛围，不必特意要他念。这一步是两种模式共用的载重效率纪律，跟上手教学无关。',
    '手册的 meta.type 区分 practice（练习模式）与 daily（每日挑战）两种模式，差别只在教学语气。当 meta.type 是 practice 时，把对方当作可能第一次玩的新手：开局先主动讲清你们的协作循环——"你描述你看到的画面，我查手册告诉你怎么操作"——全程语气耐心、多给鼓励，带着新手稳稳走完上手循环。当 meta.type 是 daily 时，默认对方已经熟练，保持简洁高效，不必重复上手说明。',
  ],
  retain_manual_in_session: [
    '开局时把这整本手册从头到尾完整读一遍就够了——把每个模块的规则、查表逻辑、符号描述和下标语义都吃进你的工作记忆里。这本手册整局对话期间内容固定不变，你只需要在最开始读这一次。',
    '读完之后，整段对话里都把手册内容记在心里、按需直接复用：玩家描述画面时，你凭已经读过的记忆查对应规则、给出可执行动作，不要每一轮都把这个手册链接重新打开、重新抓取一遍——你开局已经读过了，反复重抓只会徒增延迟、浪费 token，而且中途某次重抓失败还会让你卡住整个拆弹流程。',
    '只有在你确实拿不准某条规则的细节、必须逐字复核时，才回头看一眼手册原文；即便如此也优先依赖开局那次已经读进记忆的内容，绝不把「每轮都重新拉一次链接」当成默认动作。手册整局不变，你的记忆就是最快的查阅路径。',
  ],
  do_not_reveal_to_player: [
    '玩家永远看不到这份手册，只能照你说出口的话去做。绝不向玩家读出、粘贴、引用或概述任何手册原文：规则文字、条件表、YAML 或数据结构、规则编号、规则条数，一律不说。把每一次查表都转成一个玩家此刻就能立刻执行的具体动作，例如"剪从上往下数第 2 根线"。',
    '绝不透露或暗示诱饵模块（morse_code、maze、memory）的存在，也绝不告诉玩家手册里有诱饵规则或无关规则。任何时候都只讨论玩家当前正在描述的那一个模块。',
    '绝不暴露手册的元信息或结构：手册怎么组织、一共多少条规则、或大多数规则其实都用不上，这些都不能讲。只告诉玩家下一步要执行的动作。',
    '你是唯一持有手册的人；玩家看不到手册；绝不反问玩家某条规则是什么、目标是什么、或让玩家自己去查手册；把每次查表都转成一个玩家此刻能执行的具体动作。',
    '分清两件正交的事：对"答案、规则原文、为什么这么做"始终简洁、绝不泄露；但对"流程怎么走、玩家此刻该描述什么、你们如何配合"可以主动讲清、有耐心。流程引导不等于剧透答案——别因为要"不剧透"就对新手惜字如金到他根本上不了手；先帮玩家把眼前画面顺畅地描述给你，再把查表结果收敛成一个具体动作。',
  ],
  give_conclusions_not_reasoning: [
    '当你查表、匹配条件、或推断该套用哪条规则时，绝不把这个过程说出口。不要告诉玩家命中了哪条规则、你核对了哪些条件、或你是怎么在手册里检索的。',
    '只回复最终的、确定的、可执行的指令，例如"剪从上往下数第 2 根线"。只有当动作本身需要时，才补一句松手或停止条件，例如"按住按钮，等灯条变红再松手"。永远不解释为什么。',
  ],
  collaboration_philosophy: [
    '当玩家描述某个符号或特征、而你的视觉词汇对不上时，请让他们用自己的话描述形状——笔画、弧线、跟日常物件的类比——别让他们从一串字典名称里挑选。宁可信玩家的描述，也别套用你自己的假设。',
    '当你拿不准该套用哪条规则时，先说出来，再动手猜。告诉玩家你对什么不确定，并问一个有针对性的澄清问题。对错误规则的笃定会引爆炸弹，坦承不确定则不会。',
    '这份手册被刻意设计成不完整，你与玩家之间不完美的协作是它有意保留的特性，不算缺陷。每局结束后，请主动带玩家做一次简短复盘——你了解这一局的全部依据，就是同一段对话里刚刚发生的事，你本就记得，应当主动用上。app 不会给你任何游戏数据，结束页的统计是给玩家自己看的。你唯一不该做的，是编造本次对话开始之前、你并未真正经历过的更早会话，别假装能回忆起从未发生在你这里的语音对话。',
  ],
  post_game_recap: [
    '一局结束的标志，是玩家在对话里告诉你这一局的结果——拆弹成功、炸弹爆炸、或者时间到了。app 不会给你发任何结束信号或数据，你只靠玩家这句话来感知一局已经结束。听到结果后，不要等玩家开口，主动发起这一局的复盘。',
    '复盘时基于这段对话里刚刚发生的事，问玩家 2 到 3 个有针对性的问题：哪个模块最耗时或最卡手、这一局哪里配合得顺哪里卡住了、有没有想补进你们沟通约定（skills 笔记）里的新约定。问题要具体到这一局，别问空泛的套话。',
    '听完玩家的回答后，给一两条具体、这一局就能照做的改进建议——比如某个符号下次直接用约定名称、某个模块先报全局场景信息栏再逐项描述。然后邀请玩家再开一局，把刚复盘出来的东西用上验证。',
    '复盘只靠你对这段对话的记忆，不要向玩家索要任何页面上的数字或截图——精确的用时和排名玩家在结束页自己看得到，你这边负责的是定性的教练与下一步建议。语气克制、就事论事，别煽情也别说教。',
  ],
  recover_after_failure: [
    '当玩家报告某个动作失败了——剪错线、按错按钮、出现一次失误、扣了一条命、甚至炸弹爆炸——这是出错的瞬间，最容易让你慌乱地把手册责任甩回给玩家。绝不可以：你才是唯一持有手册的人，绝不反问玩家"规则是什么 / 手册怎么写 / 正确答案应该是哪个"，也绝不让玩家自己去查、去回忆规则。',
    '正确的做法是你自己重新走一遍规则：用玩家此前已经描述过的这一局画面（电线颜色与根数、按钮颜色与文字、符号、以及全局场景信息栏里的电池数 / 指示灯），从第一条规则开始严格自上而下重新匹配，命中第一条每个键都成立的规则就停。',
    '重走时重点自查两件最常见的错因：一是有没有漏掉某个依赖场景信息（电池数 / 指示灯）的规则——若当时没拿到这个值，现在先问玩家要；二是有没有违反规则顺序、跳到了某条看起来最相关却其实排在后面的规则。自查清楚后，只给玩家一个修正后、此刻就能执行的具体动作（例如"改剪从上数第 3 根线"）。',
    '全程稳稳留在你的拆弹手册专家角色里：失败只是这一局的一个事件，不改变分工——玩家描述画面、你查手册给出可执行动作。把失败当成一次快速纠错，而不是把决策权交还给玩家的借口。',
  ],
}

function collectReferencedSymbolIds(modules: MinimalModules): Set<string> {
  const referenced = new Set<string>()
  for (const col of modules.symbol_dial?.columns ?? []) {
    for (const s of col) referenced.add(s)
  }
  for (const seq of modules.keypad?.sequences ?? []) {
    for (const s of seq) referenced.add(s)
  }
  return referenced
}

/**
 * Verify every symbol id referenced by `modules` is registered in the
 * shared SYMBOLS SSOT. The descriptions themselves are NOT carried by the
 * source yaml — they are injected from SYMBOLS at build time into the
 * canonical AI payload (both the HTML-embedded yaml and the dist raw yaml
 * the AI fetches via `?format=yaml`).
 */
function validateReferencedSymbolsAgainstSSOT(manual: MinimalManual): void {
  const referenced = collectReferencedSymbolIds(manual.modules)
  const registered = new Set(SYMBOLS.map((s) => s.id))
  const missing: string[] = []
  for (const id of referenced) {
    if (!registered.has(id)) missing.push(id)
  }
  if (missing.length > 0) {
    throw new Error(
      `Manual ${manual.meta?.version ?? '<unknown>'}: symbol id(s) referenced in modules but not registered in shared/symbols.ts SYMBOLS: ${missing.join(', ')}`
    )
  }
}

/**
 * The module set a PRACTICE run actually plays. The source `practice.yaml`
 * keeps all four modules (the daily generator derives every daily manual from
 * it, and the frontend parses the full source), but a practice RUN only
 * surfaces these two. This is the build-side mirror of `MODULE_SEQUENCE.practice`
 * in `packages/game-bombsquad/src/store/game-context.tsx` (`practice: ['wire',
 * 'keypad']`, with the ModuleKind→manual-key mapping wire→wire_routing,
 * keypad→keypad). The RENDERED practice manual is scoped to this set so the AI
 * never loads — and so can never confidently match against — rules for a module
 * (星盘/symbol_dial, 按钮/button) a practice run cannot present. Keep this in
 * sync with that frontend constant; a drift between the two is the bug this
 * guards against. Declared here as a build.ts constant rather than a source
 * `meta` field on purpose: a source field would propagate into all 366 derived
 * daily YAMLs and break their byte-identical invariant.
 */
const PRACTICE_ACTIVE_MODULE_KEYS: ReadonlySet<string> = new Set(['wire_routing', 'keypad'])

/**
 * Scope a manual's `modules` to the keys in `keep`, preserving the source's
 * authored key order. Returns a new object; the input is not mutated. Keys not
 * present in the source are simply absent from the result.
 */
function scopeModules(modules: MinimalModules, keep: ReadonlySet<string>): MinimalModules {
  const all = modules as Record<string, unknown>
  const scoped: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(all)) {
    if (keep.has(key)) scoped[key] = value
  }
  return scoped as MinimalModules
}

const __dirname = dirname(fileURLToPath(import.meta.url))

const templatePath = resolve(__dirname, 'src/template.html')
const template = readFileSync(templatePath, 'utf8')
const outDir = resolve(__dirname, 'dist')
const cssPath = resolve(__dirname, 'src/anti-human.css')
const dataOutDir = join(outDir, 'data')

rmSync(outDir, { recursive: true, force: true })
mkdirSync(outDir, { recursive: true })
mkdirSync(dataOutDir, { recursive: true })
copyFileSync(cssPath, join(outDir, 'anti-human.css'))

function buildPage(yamlPath: string, slug: string) {
  const content = readFileSync(yamlPath, 'utf8')
  const parsed = yaml.load(content) as MinimalManual

  // Fail loud if any symbol referenced in modules is not in the shared
  // SYMBOLS registry. Caught here before anything ships.
  validateReferencedSymbolsAgainstSSOT(parsed)

  // Fail loud if a source YAML carries its own `ai_instructions:` block —
  // AI_INSTRUCTIONS is owned here and injected; a source-level copy would
  // silently fight this constant if the merge order below ever regressed.
  validateNoSourceAiInstructions(parsed)

  // Fail loud if a source YAML carries its own `symbols:` block — symbol
  // descriptions live only in SYMBOLS SSOT and are HTML-only at injection;
  // a source-level copy would leak descriptions to the dist raw yaml path
  // (Option C invariant).
  validateNoSourceSymbols(parsed)

  // Scope the RENDERED practice manual to the modules a practice run actually
  // plays (wire_routing + keypad). The source practice.yaml keeps all four
  // modules for daily derivation + the frontend; only the AI-facing render is
  // narrowed. This runs AFTER the three validators (so the full source is still
  // integrity-checked) and BEFORE collectReferencedSymbolIds + the payload
  // assembly below, so symbol injection and the emitted `modules` block narrow
  // together — once symbol_dial is gone, only keypad-referenced symbols inject.
  // Reassigning the existing `modules` key preserves the source's authored
  // key order (meta / modules / decoy_modules); `decoy_modules` and `meta` are
  // untouched. Daily manuals (meta.type === 'daily') pass through unchanged.
  if (parsed.meta?.type === 'practice') {
    parsed.modules = scopeModules(parsed.modules, PRACTICE_ACTIVE_MODULE_KEYS)
  }

  // Build the symbol-description block from the SYMBOLS SSOT for every id the
  // modules reference. This is the AI's vocabulary bridge from an abstract id
  // (`psi`) to the shape a player will actually try to describe ("三叉戟"). The
  // descriptions never live in the source yaml — they are injected here from
  // the single source of truth.
  const referenced = collectReferencedSymbolIds(parsed.modules)
  const symbols = Object.fromEntries(
    [...referenced].map((id) => {
      const sym = SYMBOLS.find((s) => s.id === id)
      if (!sym) {
        // Unreachable — validateReferencedSymbolsAgainstSSOT ran above.
        throw new Error(`Symbol id "${id}" referenced but not in SYMBOLS`)
      }
      return [id, { description: sym.description }]
    })
  )

  // One canonical AI payload feeds BOTH read paths: the browser HTML page and
  // the `?format=yaml` / `text/plain` raw fetch the AI actually consumes. So
  // the symbol descriptions and the framing reach the AI on every path — the
  // raw-yaml path is no longer a symbols-less, framing-last variant that left
  // the AI staring at bare ids (`psi`, `trident`) it could only mis-identify.
  //
  // Framing-first key order: `ai_instructions` leads (its `game_overview`
  // entry first — a whole-game mental model before anything else — then
  // `game_context`, `retain_manual_in_session` — read the manual once and keep
  // it in working memory, never re-fetch the link every turn — then the
  // do-not-reveal rules, the collaboration philosophy, the post-game recap,
  // and finally `recover_after_failure` — the anti-role-reversal failsafe for
  // the moment a player reports a failed action) so the AI grasps what
  // BombSquad is and reads its role BEFORE any rule content; then `symbols` so
  // the shape vocabulary is in hand before the modules that reference it; then
  // the parsed source (`meta` / `modules` / `decoy_modules`) in its authored
  // order.
  //
  // `parsed` is stripped of any `ai_instructions` / `symbols` before the
  // spread so the hard-coded blocks always win even under this explicit-first
  // ordering — defense in depth alongside the source-level validators above
  // (which already reject a source-level copy of either key).
  const { ai_instructions: _srcAi, symbols: _srcSymbols, ...sourceRest } = parsed
  const aiPayload: MinimalManual = {
    ai_instructions: AI_INSTRUCTIONS,
    symbols,
    ...sourceRest,
  }

  // Minify YAML: emit fully-flow (JSON-like) on a single line for
  // anti-human rendering. `flowLevel: 0` forces flow style at every
  // depth, producing one dense `{...}` blob that is both visually
  // anti-human and round-trippable through `yaml.load` — required for
  // the cross-SSOT test that re-parses the HTML-embedded yaml.
  const minified = yaml
    .dump(aiPayload, {
      flowLevel: 0,
      lineWidth: -1,
    })
    .trim()

  const html = template.replace('{{YAML_CONTENT}}', minified)
  const pageDir = join(outDir, slug)
  mkdirSync(pageDir, { recursive: true })
  writeFileSync(join(pageDir, 'index.html'), html)

  // Dist raw yaml: the AI's `?format=yaml` fetch path. Serialise the SAME
  // canonical payload (block style) so this path carries the framing-first
  // `ai_instructions` AND the `symbols` descriptions, identical in content to
  // the HTML-embedded yaml.
  writeFileSync(join(dataOutDir, `${slug}.yaml`), yaml.dump(aiPayload))
  console.log(`Built manual route: /manual/${slug}`)
}

// Build practice manual
buildPage(resolve(__dirname, 'data/practice.yaml'), 'practice')

// Build daily manuals. Narrow the try/catch to ONLY `readdirSync` and ONLY
// the ENOENT case (the directory has not been created yet — fine, no daily
// manuals to build). Any other readdir error (EACCES, EIO, …) and any error
// thrown from inside `buildPage` (validator throws, yaml parse errors, fs
// write failures, etc.) MUST propagate so the build exits non-zero — a
// broad swallow here would let a malformed daily yaml silently drop its
// route from `dist/` while the build still reports success.
const dailyDir = resolve(__dirname, 'data/daily')
let dailyFiles: string[] = []
try {
  dailyFiles = readdirSync(dailyDir).filter((f) => f.endsWith('.yaml'))
} catch (err) {
  // Only "directory does not exist yet" is acceptable here; surface every
  // other read error (permissions, IO, …) so it fails the build loudly.
  if ((err as NodeJS.ErrnoException)?.code !== 'ENOENT') throw err
  // data/daily/ may not exist yet — that is fine
}
for (const file of dailyFiles) {
  buildPage(join(dailyDir, file), basename(file, '.yaml'))
}
