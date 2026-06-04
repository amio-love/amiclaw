/**
 * Recommended opening prompt the player pastes into their AI partner. It sets
 * the AI's role as the manual expert and explains the turn-based voice loop, so
 * the AI has full context before the run starts. Sent together with the manual
 * URL in a single clipboard payload from the connect flow.
 *
 * Kept as a multi-line template literal so it stays copy-pastable verbatim (no
 * smart-quote / formatting drift). Single source of truth for both the connect
 * flow (ConnectPage) and the compatibility page (CompatibilityPage).
 */
export const OPENING_PROMPT = `等会儿我会发你一个 URL，里面是 YAML 拆弹手册。请打开它读完整本手册，告诉我"读完了"。
然后我开始描述拆弹面板的画面，你根据手册告诉我下一步该怎么做。
每次只回复一步指令，不要一口气说完，等我执行完再继续。
如果我念出一个奇怪的中文短句（暗号），请准确听写下来并念回给我确认。
读完整本手册后请把它记在记忆里，整局都别再重新打开这个链接，后面我描述画面时你直接凭记忆查规则。`
