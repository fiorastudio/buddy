// src/lib/reasoning/mode-handler.ts
//
// Pure-function core of the buddy_mode tool handler. Extracted so the
// voice/max/legacy-alias logic is unit-testable without the MCP
// transport. The server handler wraps this with DB I/O + writeBuddyStatus.

export type ModeInput = {
  voice?: unknown;
  max?: unknown;
  mode?: unknown; // legacy alias for voice
};

export type CurrentState = {
  observer_mode: string | null;
  max_mode: 0 | 1;
};

export type ModePlan =
  | { kind: 'error'; message: string }
  | {
      kind: 'update';
      newVoice?: 'backseat' | 'skillcoach' | 'both';
      newMax?: 0 | 1;
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
  const { voice, max, mode: legacyMode } = input;

  // Resolve voice: explicit `voice` wins, legacy `mode` as fallback.
  const legacyUsed = voice === undefined && legacyMode !== undefined;
  const proposedVoice = voice !== undefined ? voice : legacyMode;

  const changed: string[] = [];
  let newVoice: 'backseat' | 'skillcoach' | 'both' | undefined;
  let newMax: 0 | 1 | undefined;

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

  if (max !== undefined) {
    if (typeof max !== 'boolean') {
      return {
        kind: 'error',
        message: `Invalid max value "${String(max)}". Must be boolean.`,
      };
    }
    newMax = max ? 1 : 0;
    changed.push(`max → ${max ? 'on' : 'off'}`);
  }

  if (changed.length === 0) {
    return { kind: 'status', legacyAliasUsed: legacyUsed };
  }

  return { kind: 'update', newVoice, newMax, legacyAliasUsed: legacyUsed, changed };
}

export function formatModeResponse(
  plan: ModePlan,
  current: CurrentState,
): string {
  if (plan.kind === 'error') return plan.message;

  const currentVoice = current.observer_mode || 'both';
  const currentMax = current.max_mode === 1 ? 'on' : 'off';

  const maybeNote = plan.legacyAliasUsed
    ? `\n\nnote: the 'mode' field is deprecated — use 'voice' in new calls.`
    : '';

  if (plan.kind === 'status') {
    return `Current settings:\n  voice: ${currentVoice}\n  max:   ${currentMax}\n\n`
      + `Voice modes: backseat (personality only) · skillcoach (code feedback) · both (combined)\n`
      + `Max mode: when on, buddy notices structural reasoning patterns and weaves them into its reaction in character.`
      + maybeNote;
  }

  return `Updated: ${plan.changed.join(', ')}.\nNow: voice=${currentVoice}, max=${currentMax}.` + maybeNote;
}
