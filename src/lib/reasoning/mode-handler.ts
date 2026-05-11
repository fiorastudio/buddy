// src/lib/reasoning/mode-handler.ts
//
// Pure-function core of the buddy_mode tool handler. Extracted so the
// voice/guard/legacy-alias logic is unit-testable without the MCP
// transport. The server handler wraps this with DB I/O + writeBuddyStatus.

export type ModeInput = {
  voice?: unknown;
  guard?: unknown;
  insight?: unknown;  // deprecated alias for guard
  max?: unknown;      // deprecated alias for guard
  mode?: unknown;     // deprecated alias for voice
};

export type CurrentState = {
  observer_mode: string | null;
  guard_mode: 0 | 1;
  /**
   * `precise` — extraction key resolved, hook-driven extraction is active.
   * `lossy`   — guard mode is on but no extraction key found; falls back
   *             to model-driven extraction via buddy_observe.
   * `n/a`     — guard mode is off, extraction state irrelevant.
   * Optional so old callers (and tests) work unchanged.
   */
  extraction_mode?: 'precise' | 'lossy' | 'n/a';
  /**
   * Whether the companion is currently muted (mood='muted'). When true and
   * extraction_mode is 'precise', the Stop hook is paused so extraction
   * isn't actually running — surfacing this lets the user understand why
   * the graph isn't growing despite "precise" being shown.
   */
  muted?: boolean;
};

export type ModePlan =
  | { kind: 'error'; message: string }
  | {
      kind: 'update';
      newVoice?: 'backseat' | 'skillcoach' | 'both';
      newGuard?: 0 | 1;
      legacyAliasUsed: boolean;
      changed: string[];
    }
  | {
      kind: 'status';
      legacyAliasUsed: boolean;
    };

const VALID_VOICE_MODES = ['backseat', 'skillcoach', 'both'] as const;

function isValidVoice(v: unknown): v is (typeof VALID_VOICE_MODES)[number] {
  return typeof v === 'string' && (VALID_VOICE_MODES as readonly string[]).includes(v);
}

export function planModeChange(input: ModeInput): ModePlan {
  const { voice, guard, insight, max, mode: legacyMode } = input;

  // Resolve voice: explicit `voice` wins, legacy `mode` as fallback.
  const legacyVoiceUsed = voice === undefined && legacyMode !== undefined;
  const proposedVoice = voice !== undefined ? voice : legacyMode;

  // Resolve guard: explicit `guard` wins, `insight` as first fallback, `max` as second.
  const legacyInsightUsed = guard === undefined && insight !== undefined;
  const legacyMaxUsed = guard === undefined && insight === undefined && max !== undefined;
  const proposedGuard = guard !== undefined ? guard : (insight !== undefined ? insight : max);

  const legacyAliasUsed = legacyVoiceUsed || legacyInsightUsed || legacyMaxUsed;

  const changed: string[] = [];
  let newVoice: 'backseat' | 'skillcoach' | 'both' | undefined;
  let newGuard: 0 | 1 | undefined;

  if (proposedVoice !== undefined) {
    if (!isValidVoice(proposedVoice)) {
      return {
        kind: 'error',
        message: `Invalid voice "${String(proposedVoice)}". Choose: backseat, skillcoach, or both.`,
      };
    }
    newVoice = proposedVoice;
    changed.push(`voice → ${proposedVoice}`);
  }

  if (proposedGuard !== undefined) {
    if (typeof proposedGuard !== 'boolean') {
      return {
        kind: 'error',
        message: `Invalid guard value "${String(proposedGuard)}". Must be boolean.`,
      };
    }
    newGuard = proposedGuard ? 1 : 0;
    changed.push(`guard → ${proposedGuard ? 'on' : 'off'}`);
  }

  if (changed.length === 0) {
    return { kind: 'status', legacyAliasUsed };
  }

  return { kind: 'update', newVoice, newGuard, legacyAliasUsed, changed };
}

export function formatModeResponse(
  plan: ModePlan,
  current: CurrentState,
): string {
  if (plan.kind === 'error') return plan.message;

  const currentVoice = current.observer_mode || 'both';
  const currentGuard = current.guard_mode === 1 ? 'on' : 'off';

  const notes: string[] = [];
  if (plan.legacyAliasUsed) {
    notes.push(`the 'mode', 'max', and 'insight' fields are deprecated — use 'voice' and 'guard' in new calls.`);
  }
  const maybeNote = notes.length ? '\n\nnote: ' + notes.join(' ') : '';

  // Surface extraction mode only when guard mode is on — otherwise it's
  // noise. When `extraction_mode` is omitted (older callers / tests), no
  // extraction line is shown. Muted state is appended when relevant so
  // the user understands why a "precise" buddy isn't actually extracting
  // (Stop hook skips while muted).
  const showExtraction = current.guard_mode === 1 && current.extraction_mode && current.extraction_mode !== 'n/a';
  let extractionLine = '';
  if (showExtraction) {
    const suffixes: string[] = [];
    if (current.extraction_mode === 'lossy') suffixes.push('set BUDDY_EXTRACTION_KEY for precise');
    if (current.muted) suffixes.push('paused: muted');
    const suffix = suffixes.length > 0 ? ` (${suffixes.join(', ')})` : '';
    extractionLine = `\n  extraction: ${current.extraction_mode}${suffix}`;
  }

  if (plan.kind === 'status') {
    return `Current settings:\n  voice: ${currentVoice}\n  guard: ${currentGuard}${extractionLine}\n\n`
      + `Voice modes: backseat (personality only) · skillcoach (code feedback) · both (combined)\n`
      + `Guard mode: when on, buddy notices structural reasoning patterns and weaves them into its reaction in character.`
      + maybeNote;
  }

  return `Updated: ${plan.changed.join(', ')}.\nNow: voice=${currentVoice}, guard=${currentGuard}${extractionLine}.` + maybeNote;
}
