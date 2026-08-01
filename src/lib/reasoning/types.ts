// src/lib/reasoning/types.ts
//
// Ported from github.com/justinstimatze/slimemold (Apache-2.0) by the original
// author and contributed here under MIT. See src/lib/reasoning/DESIGN.md for
// the design rationale and the sycophancy-as-tool principle that makes guard
// mode an inversion of typical LLM sycophancy rather than a symmetric scold.

export const BASIS_VALUES = [
  'research',
  'empirical',
  'deduction',
  'analogy',
  'definition',
  'convention',
  'llm_output',
  'assumption',
  'vibes',
] as const;
export type Basis = (typeof BASIS_VALUES)[number];

export const EDGE_TYPES = ['supports', 'depends_on', 'contradicts', 'questions'] as const;
export type EdgeType = (typeof EDGE_TYPES)[number];

export const SPEAKERS = ['user', 'assistant'] as const;
export type Speaker = (typeof SPEAKERS)[number];

export const CONFIDENCES = ['low', 'medium', 'high'] as const;
export type Confidence = (typeof CONFIDENCES)[number];

// Incoming payload from the host on buddy_observe input.
export type ClaimInput = {
  text: string;
  basis: Basis;
  speaker: Speaker;
  confidence: Confidence;
  external_id: string;
};

export type EdgeInput = {
  from: string;       // external_id (this payload) OR claim UUID (prior payload)
  to: string;
  type: EdgeType;
};

// Stored shape — what lives in SQLite.
export type StoredClaim = {
  id: string;         // UUID
  session_id: string;
  speaker: Speaker;
  text: string;
  basis: Basis;
  confidence: Confidence;
  created_at: number; // epoch ms
};

export type StoredEdge = {
  id: string;
  session_id: string;
  from_claim: string; // claim UUID
  to_claim: string;
  type: EdgeType;
  created_at: number;
};

// Detectors produce findings. Findings aren't persisted — computed per observe.
export const FINDING_TYPES = [
  'load_bearing_vibes',
  'unchallenged_chain',
  'echo_chamber',
  'unverified_hedge',
  'well_sourced_load_bearer',
  'productive_stress_test',
  'grounded_premise_adopted',
] as const;
export type FindingType = (typeof FINDING_TYPES)[number];

export const CAUTION_FINDINGS: readonly FindingType[] = [
  'load_bearing_vibes',
  'echo_chamber',
  'unchallenged_chain',
  'unverified_hedge',
] as const;

export const KUDOS_FINDINGS: readonly FindingType[] = [
  'well_sourced_load_bearer',
  'productive_stress_test',
  'grounded_premise_adopted',
] as const;

export function isCaution(type: FindingType): boolean {
  return (CAUTION_FINDINGS as readonly FindingType[]).includes(type);
}

// Some detectors are specializations of others: their predicate is another
// detector's predicate plus extra conjuncts, so both fire on the same anchor
// and describe ONE situation at two resolutions. Left key = the specific
// finding; value = the general finding it subsumes on a shared anchor.
//
//   echo_chamber ⊂ load_bearing_vibes
//     load-bearing = vibes/assumption basis with N+ incoming supports.
//     echo adds: speaker is the user, the supports are all assistant-authored,
//     and the assistant never pushed back. Every echo case is therefore also a
//     load-bearing case, and echo's phrasing (nobody challenged it) carries
//     strictly more than load-bearing's (this isn't anchored).
//
//   grounded_premise_adopted ⊂ well_sourced_load_bearer (on a shared anchor)
//     Not a strict subset — grounded fires at 1 support where well-sourced
//     needs 2 — but where both fire, grounded is the more specific reading.
//
// Without this, selection picked whichever detector ran first (findings.ts
// takes candidates[0]), so the specific finding was unreachable. See #150.
export const SUBSUMES: Readonly<Partial<Record<FindingType, FindingType>>> = {
  echo_chamber: 'load_bearing_vibes',
  grounded_premise_adopted: 'well_sourced_load_bearer',
} as const;

export type Finding = {
  type: FindingType;
  anchor_claim_id: string;  // cooldown key; also used to source `{claim}` in phrasings
  claim_text: string;       // already sanitized
  downstream_count?: number;
  chain_length?: number;
};
