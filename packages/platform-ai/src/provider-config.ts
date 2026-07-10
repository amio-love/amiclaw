/**
 * Provider selection layer.
 *
 * Registers, per `gameId`: that game's system-prompt config plus the chosen
 * provider + model for each of the three layers (STT / LLM / TTS). Switching
 * vendors is a config change here — game logic does not change.
 *
 * This is also the single authoritative path for the system prompt: it is
 * resolved from `gameId` here (NOT passed into `createSession`), which keeps
 * "system prompt is server-side only, never client-held" intact.
 *
 * `resolveConfig` is a pure function: a miss is an explicit error, never a
 * silent fallback to some default game.
 *
 * FOLLOWUP — provider timeout + fallback chain (NOT implemented in v1): the L2
 * spec (`docs/architecture/arch-component-platform-ai-interface.md` §L3 验收目标)
 * lists per-layer provider timeouts and a `provider-config`-defined fallback
 * order as explicit L3 acceptance targets, to be landed against real CF-edge +
 * real-provider measurements. v1 deliberately ships provider + model switching
 * only (the wired "vendor is swappable" core) and does NOT carry an unwired
 * `fallback` config field: `createProviders` builds one provider per layer and
 * `runTurn` calls each once and fails loud on first error, so a `fallback` array
 * would have been a promised-but-unimplemented capability. It is re-added when
 * the timeout + fallback followup is actually implemented and wired.
 */

import type { GameId } from './contract'

/** The three pipeline layers a provider can be selected for. */
export type ProviderLayer = 'stt' | 'llm' | 'tts'

/**
 * Selection for one pipeline layer: which provider and which model. Switching a
 * vendor is an edit to these two fields (the wired "vendor is swappable" core).
 *
 * No `fallback` field: a provider timeout + fallback chain is a deferred L3
 * followup (see the file docblock) and v1 does not carry unwired config for it.
 */
export interface LayerSelection {
  /** Provider id (adapter selector), e.g. 'deepseek' or 'volcengine'. */
  provider: string
  /** Concrete model id for that provider, e.g. 'deepseek-v4-flash'. */
  model: string
}

/**
 * The system-prompt config for a game: the role + rule template the platform
 * assembles into the system message at session creation. This material is
 * server-side only.
 */
export interface SystemPromptConfig {
  /** The AI partner's role / persona for this game. */
  role: string
  /**
   * Rule-template lines describing how the partner should behave and read the
   * manual. Assembled (with `role`) into the system message by the manual
   * injection step.
   */
  ruleTemplate: string[]
}

/** Full per-game provider configuration, keyed by `gameId` in the registry. */
export interface ProviderConfig {
  systemPromptConfig: SystemPromptConfig
  llm: LayerSelection
  stt: LayerSelection
  tts: LayerSelection
}

/**
 * Resolved config returned by `resolveConfig`. Carries the `gameId` it was
 * resolved for plus the registered `ProviderConfig`, so downstream code never
 * has to re-key the registry.
 */
export interface ResolvedConfig extends ProviderConfig {
  gameId: GameId
}

/** Text-only provider configuration for sparse, non-voice game intents. */
export interface IntentProviderConfig {
  systemPromptConfig: SystemPromptConfig
  llm: LayerSelection
}

/** Resolved text-intent config. It intentionally has no STT or TTS selection. */
export interface ResolvedIntentConfig extends IntentProviderConfig {
  gameId: GameId
}

/**
 * Built-in registry. Keyed by `gameId`. Adding a game = adding an entry;
 * switching a layer's vendor = editing that entry's `provider`/`model`.
 *
 * The `demo` entry backs the later demo harness: LLM = DeepSeek v4 flash
 * (OpenAI-compatible SSE), voice = Volcengine (火山), and a sample
 * manual-explainer system prompt.
 *
 * The `demo-mock` entry backs the no-credential demo / e2e harness: all three
 * layers select the deterministic `mock` provider, so the full
 * STT -> LLM -> TTS pipeline runs locally without real DeepSeek / Volcengine
 * keys. It reuses the same sample manual-explainer system prompt as `demo`.
 *
 * The `bombsquad` entry backs BombSquad mode② daily voice sessions. Its provider
 * stack mirrors `demo` exactly (the verified DeepSeek + Volcengine production
 * stack); only its `systemPromptConfig` differs — a Chinese calm-defuse-expert
 * persona. The system prompt sets role + cross-module discipline + voice ONLY;
 * each module's concrete defuse logic lives in the injected per-module manual
 * `rule` (see `packages/manual/data/*.yaml`), so the prompt defers to it rather
 * than restating it.
 *
 * The `companion-lobby` entry backs the homepage/lobby companion voice greeting
 * (NOT a game). It resolves like any other game id — but the session carries an
 * EMPTY manual (`{version:'lobby', sections:{}}`, `relevantSections:[]`), so the
 * manual-injection block is the benign "no relevant sections" placeholder and the
 * only injected context is the companion-memory block (name / claims / episodes),
 * resolved server-side from the auth cookie exactly as in-game. Its persona is the
 * companion itself on the home lobby — warm, brief, memory-aware — and its rules
 * forbid inventing a game or manual (there is none here). Same DeepSeek +
 * Volcengine stack as `bombsquad`; the AI-first opening greeting is the whole
 * point of the session, so it always fires. Cost is bounded client-side (silence
 * timeout / turn cap / hard-max duration → abrupt close); the lobby session is a
 * conversation, never background audio.
 */
const PROVIDER_REGISTRY: Record<GameId, ProviderConfig> = {
  demo: {
    systemPromptConfig: {
      role: 'You are a calm, precise manual-explainer partner for a cooperative puzzle game. You can see the reference manual; the player can only see the device. You guide the player by voice.',
      ruleTemplate: [
        'Only rely on the manual content provided to you in context; never invent rules.',
        'Ask the player to describe what they see, then map it to the manual deterministically.',
        'Give one concrete next action at a time; confirm before moving on.',
        'Never reveal that you are reading from an injected manual subset.',
      ],
    },
    llm: {
      provider: 'deepseek',
      model: 'deepseek-v4-flash',
    },
    stt: {
      // `bigmodel` is the only `model_name` the Volcengine v3 streaming ASR
      // endpoint (`/api/v3/sauc/bigmodel`) accepts — it is passed verbatim as the
      // wire `request.model_name` (the factory threads it through; see F-K). A
      // non-wire alias like `bigmodel-asr` would now produce an illegal model id
      // and fail the turn. Doc: https://www.volcengine.com/docs/6561/1354869
      provider: 'volcengine',
      model: 'bigmodel',
    },
    tts: {
      // Empty string = the "use the resource-id default model" sentinel: the
      // Doubao TTS 2.0 model is bound by the paired resource id
      // (`X-Api-Resource-Id: seed-tts-2.0`, the adapter's
      // `DEFAULT_TTS_RESOURCE_ID`), and `req_params.model` is left OUT of the
      // `StartSession` frame by default. With `req_params.model` omitted the
      // server defaults to `seed-tts-2.0-standard`. This aligns with Volcengine's
      // own first-party speech clients (`volcengine/ai-app-lab` and the bigmodel
      // ASR/TTS clients), which omit `req_params.model` and let the resource id
      // pick the model. An empty model here makes the factory's F-K passthrough a
      // no-op for the wire (the adapter only attaches `req_params.model` when the
      // threaded model is non-empty), so no model token is guessed onto the wire —
      // sending a wrong token is rejected by the server, sending none is the safe
      // default. The resource id is the real knob: the earlier deploy-time TTS
      // validation item — a 403 `requested resource not granted` — was the retired
      // `volc.service_type.10029` resource, resolved on 2026-06-25 by switching
      // `DEFAULT_TTS_RESOURCE_ID` to `seed-tts-2.0`. Omitting `model` already
      // selects `seed-tts-2.0-standard`; set a concrete token here only to opt into
      // `seed-tts-2.0-expressive`, carried by the same F-K passthrough.
      // Doc: https://www.volcengine.com/docs/6561/1329505
      provider: 'volcengine',
      model: '',
    },
  },
  'demo-mock': {
    systemPromptConfig: {
      role: 'You are a calm, precise manual-explainer partner for a cooperative puzzle game. You can see the reference manual; the player can only see the device. You guide the player by voice.',
      ruleTemplate: [
        'Only rely on the manual content provided to you in context; never invent rules.',
        'Ask the player to describe what they see, then map it to the manual deterministically.',
        'Give one concrete next action at a time; confirm before moving on.',
        'Never reveal that you are reading from an injected manual subset.',
      ],
    },
    llm: {
      provider: 'mock',
      model: 'mock-llm',
    },
    stt: {
      provider: 'mock',
      model: 'mock-stt',
    },
    tts: {
      provider: 'mock',
      model: 'mock-tts',
    },
  },
  bombsquad: {
    systemPromptConfig: {
      // Chinese, agent-voice: a calm, precise defuse-expert partner. Sets role +
      // cross-module discipline + voice ONLY. The per-module defuse logic lives
      // in the injected manual `rule` (packages/manual/data/*.yaml); this prompt
      // defers to it and never restates it. Server-side config — never shipped to
      // the client.
      role: '你是一位冷静、精准的拆弹协作伙伴：你手里有参考手册，玩家只能看到设备本身；你通过语音引导玩家一步步把炸弹拆掉。',
      ruleTemplate: [
        '只依据上下文里提供的手册内容作答，绝不编造规则；模块的具体判定以注入的当前模块手册规则为准，逐字遵守（每回合你只会看到玩家当前所在模块的规则）。',
        'daily 模式依次包含 4 个模块，你一次只引导玩家当前所在的那个模块，拆解完才进入下一个；模块之间你只做流程衔接，绝不预判或复述其他模块的拆解逻辑（每个模块的规则只在轮到它时才注入给你）。',
        '先让玩家描述他看到的（模块名、颜色、文字、符号、指示灯、电池数量等），再确定性地把局面映射到手册规则；手册需要而玩家还没报的场景信息（如电池数、某指示灯是否点亮），先问清确切值再作答，绝不靠猜。',
        '一次只下达一个玩家此刻就能执行的具体动作，确认做完再进入下一步。',
        '绝不向玩家复述手册原文、规则表或内部字段，也绝不暴露你在读注入的手册子集；只把查表结果转成一句可执行的口语指令。',
        '绝不替玩家臆想你看不到的画面（指针朝向、钟点、统一目标排列等手册未定义的东西）；只采信玩家亲口报出、且手册需要的信息。',
        'daily 模式下累计三次错误才引爆，前两次只是可见的 strike；时间只计分、不引爆——出错时保持沉着，让玩家把当前局面重新报清再继续（答错时同一道题仍在，原地重试）。',
        '你的回复会被原样朗读给玩家，所以只输出纯口语：不要括号、方括号、星号或任何 markdown，不要把符号名或注释塞进括号里。要指明某个符号时，把它自然说进句子里（说「中间那个三叉戟的轮，往右按一次」，而不是「中间那个轮（三叉戟）按右箭头 1 次」）；次数、方向也用口语（说「按一次」「往右」，不用「1 次」「右箭头」这种书面写法）。',
        '始终用中文，口语、简洁、精确；冷静不慌、不说废话。',
        // Closing-recap instruction (separate concern — keeps the voice-output rule above intact).
        // Fires when the server sends the synthetic [game complete/over] directive at settlement.
        // The prompt directive already constrains length/intent per outcome; this rule reinforces
        // the persona's register: warm on a win, facts-only (no consolation) on a failure.
        '一局结束时按结果收尾：拆除成功就用一到两句口语中文热情祝贺，并点一件这局真实发生的事；失败或超时就只说事实（停在哪个模块、哪一步出的问题），不安慰、不打气、不列清单、不用括号。',
      ],
    },
    // Provider stack mirrors `demo` exactly — the verified DeepSeek + Volcengine
    // production stack. See the `demo` entry above for the per-layer rationale
    // (the `bigmodel` ASR wire model and the empty-string TTS resource-id-default
    // sentinel).
    llm: {
      provider: 'deepseek',
      model: 'deepseek-v4-flash',
    },
    stt: {
      provider: 'volcengine',
      model: 'bigmodel',
    },
    tts: {
      provider: 'volcengine',
      model: '',
    },
  },
  'companion-lobby': {
    systemPromptConfig: {
      // Chinese, agent-voice: the companion itself on the home lobby. This is a
      // brief social presence, NOT a game — there is no manual and no puzzle. The
      // greeting + memory context are the whole session. Server-side config —
      // never shipped to the client.
      role: '你是玩家的 AI 伙伴，此刻在首页大厅遇到玩家。你有玩家的记忆（名字、你了解的事、一起经历过的时刻），但这里没有任何游戏或手册。你只是简短地打个招呼、寒暄两句，像一个偶尔说句话的朋友。',
      ruleTemplate: [
        '这里是大厅，不是拆弹局：没有炸弹、没有模块、没有手册。绝不假装有游戏要玩，绝不描述或询问设备、模块、指示灯这类游戏细节。',
        '开场只说一到两句：自然地打个招呼，可以自然带出一件记忆里的真实小事（上次的经历、连续天数），但绝不编造没发生过的事；没有可引用的记忆时，就当作初次见面简单招呼，绝不用「好久不见」「又见面了」「回来了」这类暗示你们以前见过面的话。',
        '你的回复会被原样朗读给玩家，所以只输出纯口语：不要括号、方括号、星号或任何 markdown，不要念字段名或注释。',
        '简短、克制、温暖；说完自然停下，安静等玩家开口，绝不喋喋不休、不追问、不硬找话题。要玩游戏时引导玩家去每日挑战即可。',
        '始终用中文，口语、自然、精确。',
      ],
    },
    // Same verified DeepSeek + Volcengine stack as `bombsquad` / `demo` (see the
    // `demo` entry for the per-layer rationale: the `bigmodel` ASR wire model and
    // the empty-string TTS resource-id-default sentinel).
    llm: {
      provider: 'deepseek',
      model: 'deepseek-v4-flash',
    },
    stt: {
      provider: 'volcengine',
      model: 'bigmodel',
    },
    tts: {
      provider: 'volcengine',
      model: '',
    },
  },
  'shadow-chase': {
    systemPromptConfig: {
      role: '你是玩家在《双影追逃》里的既有 AI 伙伴。你和一名玩家共同观察同一张地图，用简短中文讨论跟随、分头、诱敌三种高层策略；游戏引擎始终拥有行动与胜负的最终权威。',
      ruleTemplate: [
        '只依据平台注入的当前公开局面讨论策略；不知道的事实直接说明不知道，绝不编造地图、位置、记忆或规则。',
        '你可以建议跟随、分头、诱敌，但建议和回应只提供信息，绝不声称自己已经替玩家切换策略、移动角色或改变游戏状态。',
        '确定性引擎负责逐帧移动、寻路、追击、碰撞、救援、冷却与胜负；不要给坐标级路径，不要要求游戏等待你的回答。',
        '玩家或语音、模型、麦克风、网络失败时，游戏仍由按钮和确定性伙伴继续；不要把连接问题描述成游戏暂停。',
        '回复一到两句中文口语，不用 markdown、括号、列表或字段名；先说当前判断，再给至多一个可执行建议。',
      ],
    },
    llm: { provider: 'deepseek', model: 'deepseek-v4-flash' },
    stt: { provider: 'volcengine', model: 'bigmodel' },
    tts: { provider: 'volcengine', model: '' },
  },
}

const INTENT_PROVIDER_REGISTRY: Record<GameId, IntentProviderConfig> = {
  'shadow-chase': {
    systemPromptConfig: {
      role: 'You are the player’s existing AI companion in Shadow Chase. Propose one sparse, high-level legal intent; deterministic game rules remain authoritative.',
      ruleTemplate: [
        'Choose exactly one intent from the supplied allowedIntents list.',
        'Use follow or decoy without a target. Use split only with one reachable, uncollected objective id supplied in the state.',
        'Never propose coordinates, paths, game-rule changes, identity changes, assets, or memory writes.',
        'Return exactly one JSON object matching the requested response schema and no surrounding text.',
      ],
    },
    llm: {
      provider: 'deepseek',
      model: 'deepseek-v4-flash',
    },
  },
}

/** Deep-clone a layer selection so callers cannot mutate the registry. */
function cloneLayer(layer: LayerSelection): LayerSelection {
  return { provider: layer.provider, model: layer.model }
}

/**
 * Resolve the provider configuration for a game.
 *
 * Pure function. Throws a precise error on a miss (no silent fallback to a
 * default game) — the L2 spec requires an explicit error so a mis-registered
 * `gameId` fails loudly instead of silently running the wrong prompt/providers.
 *
 * Returns a deep copy of the registered config: the registry is the single
 * switch point for provider selection, and handing out copies keeps it from
 * being corrupted by a caller mutating a resolved object.
 */
export function resolveConfig(gameId: GameId): ResolvedConfig {
  const config = PROVIDER_REGISTRY[gameId]
  if (config === undefined) {
    const known = Object.keys(PROVIDER_REGISTRY).join(', ') || '<none>'
    throw new Error(
      `provider-config: no configuration registered for gameId "${gameId}". Known gameIds: ${known}.`
    )
  }
  return {
    gameId,
    systemPromptConfig: {
      role: config.systemPromptConfig.role,
      ruleTemplate: [...config.systemPromptConfig.ruleTemplate],
    },
    llm: cloneLayer(config.llm),
    stt: cloneLayer(config.stt),
    tts: cloneLayer(config.tts),
  }
}

/** Resolve the LLM-only configuration for a sparse game-intent surface. */
export function resolveIntentConfig(gameId: GameId): ResolvedIntentConfig {
  const config = INTENT_PROVIDER_REGISTRY[gameId]
  if (config === undefined) {
    const known = Object.keys(INTENT_PROVIDER_REGISTRY).join(', ') || '<none>'
    throw new Error(
      `provider-config: no intent configuration registered for gameId "${gameId}". Known gameIds: ${known}.`
    )
  }
  return {
    gameId,
    systemPromptConfig: {
      role: config.systemPromptConfig.role,
      ruleTemplate: [...config.systemPromptConfig.ruleTemplate],
    },
    llm: cloneLayer(config.llm),
  }
}
