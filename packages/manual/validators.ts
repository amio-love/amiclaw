/**
 * Pure build-time validators for the manual pipeline. This file is
 * import-pure (no top-level side effects) so test code can import the
 * validators without triggering `build.ts`'s top-level `buildPage(...)`
 * loop. `build.ts` imports these validators and calls them inside
 * `buildPage`; the regression test in `data-validation.test.ts` imports
 * them directly to exercise the fail-loud contract.
 */

/**
 * Minimal shape a source-YAML-derived manual must satisfy for
 * `validateNoSourceAiInstructions` and `validateNoSourceSymbols` to inspect
 * it. Only the fields the validators actually read are typed here so the
 * file stays a thin pure module independent of `MinimalManual` in
 * `build.ts`. Each validator inspects exactly one optional field.
 */
export interface ManualForInstructionsValidation {
  meta?: { version?: string }
  ai_instructions?: unknown
  symbols?: unknown
}

/**
 * Fail loud if a source YAML carries its own `ai_instructions:` block.
 * `AI_INSTRUCTIONS` is owned by `build.ts` as the single source of truth
 * and is injected at build time; any source-level `ai_instructions:` key
 * would silently fight the hard-coded constant if the build merge ever
 * regressed, so we reject it at the gate. Mirrors the shape of
 * `validateReferencedSymbolsAgainstSSOT` (param: manual; return: void;
 * throws on failure with the manual version named for traceability).
 */
export function validateNoSourceAiInstructions(manual: ManualForInstructionsValidation): void {
  if (manual.ai_instructions !== undefined) {
    throw new Error(
      `Manual ${manual.meta?.version ?? '<unknown>'}: source YAML must not carry an \`ai_instructions\` block — that key is injected at build time from the hard-coded AI_INSTRUCTIONS constant; carrying it in source would silently override the trust-boundary and framing rules.`
    )
  }
}

/**
 * Fail loud if a source YAML carries its own `symbols:` block. The
 * `SYMBOLS` constant in `shared/symbols.ts` is the single source of truth
 * for symbol descriptions; `build.ts` injects them into the HTML-embedded
 * yaml only (Option C: source YAML + dist raw YAML both stay free of
 * `symbols:` so human-readable descriptions do not leak to the AI's
 * `?format=yaml` fetch path). A source-level `symbols:` block would both
 * shadow the SYMBOLS SSOT at build time and leak through the dist raw yaml
 * spread, so we reject it at the same gate where
 * `validateNoSourceAiInstructions` rejects its parallel. Together with
 * `validateReferencedSymbolsAgainstSSOT` (which checks every referenced
 * id is registered) this validator provides defense in depth on both the
 * registration check and the source-leak path.
 */
export function validateNoSourceSymbols(manual: ManualForInstructionsValidation): void {
  if (manual.symbols !== undefined) {
    throw new Error(
      `Manual ${manual.meta?.version ?? '<unknown>'}: source YAML must not carry a \`symbols\` block — symbol descriptions live only in the shared/symbols.ts SYMBOLS SSOT and are injected into the HTML-embedded yaml at build time; carrying \`symbols\` in source would shadow the SSOT and leak human-readable descriptions to the AI-readable dist raw yaml (\`?format=yaml\` path), violating the Option C invariant.`
    )
  }
}
