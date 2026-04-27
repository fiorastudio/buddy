// src/lib/reasoning/mode-handler.ts
//
// Pure-function core of the buddy_mode tool handler. Extracted so the
// voice/insight/legacy-alias logic is unit-testable without the MCP
// transport. The server handler wraps this with DB I/O + writeBuddyStatus.

export type ModeInput = {
  voice?: unknown;
  insight?: unknown;
  max?: unknown;    // deprecated alias for insight
  mode?: unknown;   // deprecated alias for voice
};

export type CurrentState = {
  observer_mode: string | null;
  insight_mode: 0 | 1;
};

export type ModePlan =
  | { kind: 'error'; message: string }
  | {
      kind: 'update';
      newVoice?: 'backseat' | 'skillcoach' | 'both';
      newInsight?: 0 | 1;
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
  const { voice, insight, max, mode: legacyMode } = input;

  // Resolve voice: explicit `voice` wins, legacy `mode` as fallback.
  const legacyVoiceUsed = voice === undefined && legacyMode !== undefined;
  const proposedVoice = voice !== undefined ? voice : legacyMode;

  // Resolve insight: explicit `insight` wins, legacy `max` as fallback.
  const legacyMaxUsed = insight === undefined && max !== undefined;
  const proposedInsight = insight !== undefined ? insight : max;

  const legacyAliasUsed = legacyVoiceUsed || legacyMaxUsed;

  const changed: string[] = [];
  let newVoice: 'backseat' | 'skillcoach' | 'both' | undefined;
  let newInsight: 0 | 1 | undefined;

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

  if (proposedInsight !== undefined) {
    if (typeof proposedInsight !== 'boolean') {
      return {
        kind: 'error',
        message: `Invalid insight value "${String(proposedInsight)}". Must be boolean.`,
      };
    }
    newInsight = proposedInsight ? 1 : 0;
    changed.push(`insight → ${proposedInsight ? 'on' : 'off'}`);
  }

  if (changed.length === 0) {
    return { kind: 'status', legacyAliasUsed };
  }

  return { kind: 'update', newVoice, newInsight, legacyAliasUsed, changed };
}

export function formatModeResponse(
  plan: ModePlan,
  current: CurrentState,
): string {
  if (plan.kind === 'error') return plan.message;

  const currentVoice = current.observer_mode || 'both';
  const currentInsight = current.insight_mode === 1 ? 'on' : 'off';

  const notes: string[] = [];
  if (plan.legacyAliasUsed) {
    notes.push(`the 'mode' and 'max' fields are deprecated — use 'voice' and 'insight' in new calls.`);
  }
  const maybeNote = notes.length ? '\n\nnote: ' + notes.join(' ') : '';

  if (plan.kind === 'status') {
    return `Current settings:\n  voice:   ${currentVoice}\n  insight: ${currentInsight}\n\n`
      + `Voice modes: backseat (personality only) · skillcoach (code feedback) · both (combined)\n`
      + `Insight mode: when on, buddy notices structural reasoning patterns and weaves them into its reaction in character.`
      + maybeNote;
  }

  return `Updated: ${plan.changed.join(', ')}.\nNow: voice=${currentVoice}, insight=${currentInsight}.` + maybeNote;
}
