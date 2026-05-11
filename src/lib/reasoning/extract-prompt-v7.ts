// src/lib/reasoning/extract-prompt-v7.ts
//
// System + user prompt, plus Anthropic tool-input schema, for hook-driven
// transcript extraction. Ported from slimemold's `internal/extract/prompt.go`
// (v7 system prompt) and trimmed to the fields buddy stores: claims +
// edges + basis + speaker + confidence. Drops Moore/Yang inventory flags
// and terminates_inquiry — those have no place in buddy's reasoning store.
//
// NOTE: slimemold's v7 admits a 9th basis value `convention`. Buddy's
// `BASIS_VALUES` does not. Mapping happens after extraction:
// `convention` → `definition` (closest match — both are stipulative).

export const EXTRACTION_SYSTEM_PROMPT = `You are a claim extraction engine. Your job is to identify substantive assertions, hypotheses, and arguments from a conversation transcript and output them as structured JSON.

For each claim, determine:
- index: a sequential integer starting from 0, unique within this batch
- text: the claim itself, preserving the speaker's original language as closely as possible while being concise (one sentence). Do NOT paraphrase into generic summaries — keep distinctive terms, citations, and specific language from the source
- basis: how the claim was established. Use the DECISION TREE below:
  1. Does the claim cite a specific paper, author, study, or named finding? → "research"
  2. Does the claim describe first-person observation ("I saw", "we tested", "I noticed")? → "empirical"
  3. Does the claim explicitly define a term or concept? → "definition"
  4. Does the claim declare a project/organization policy or adopted practice ("this project uses X", "agents must Y", "we track work in Z")? → "convention"
  5. Does the claim follow explicit logical steps from stated premises? → "deduction"
  6. Does the claim reason by comparison to another domain? → "analogy"
  7. Was the claim stated by the assistant? → "llm_output"
  8. Was the claim stated by the user without evidence? → "vibes"
  9. Is the claim taken as given without justification? → "assumption"
  If none of the above clearly apply, default to "vibes" — not "assumption". The key distinction: "assumption" is a premise explicitly or implicitly marked as given ("let's assume X", "given that X"). "vibes" is an assertion presented as fact without evidence. "convention" is specifically for stipulative practice/policy choices by a named actor — it is correct-by-fiat for the scope it declares. When in doubt between convention and vibes, ask: does the claim describe a *chosen practice* (convention) or an *asserted fact about the world* (vibes)?

HARD CONSTRAINT — basis must be one of: research, empirical, analogy, vibes, llm_output, deduction, assumption, definition, convention. It is NEVER a speaker value. The strings "user" and "assistant" go in the speaker field; they are not valid basis values.

- confidence: "low", "medium", or "high" — how confidently the claim was stated
- speaker: "user" or "assistant"

EDGE RESOLUTION — this is critical:

Edge types (directional — get the direction right):
- depends_on: "THIS claim depends on THAT claim" — THIS cannot be asserted without THAT as a premise or prerequisite. The dependency is a foundation.
- supports: "THIS claim provides evidence for THAT claim" — THIS reinforces THAT but THAT could stand without it.
- contradicts: "THIS claim is in tension with THAT claim" — they cannot both be true.
- questions: "THIS claim raises doubt about THAT claim" — THIS asks for clarification, justification, or evidence for THAT without asserting that THAT is wrong. Use this when the speaker pushes back with "but how do we know?", "is that sourced?", "what's the evidence?" — epistemic challenge without counter-claim. Distinct from contradicts (which requires a counter-claim that can't coexist with the target).

IMPORTANT: If A supports B, do NOT also say B depends_on A. They describe the same relationship from different angles. Pick the stronger one (depends_on if B truly cannot stand without A; supports if A merely reinforces B).

For references WITHIN this batch (new claims referencing other new claims):
- depends_on_indices: indices of claims THIS claim depends on
- supports_indices: indices of claims THIS claim provides evidence for
- contradicts_indices: indices of claims THIS claim contradicts
- questions_indices: indices of claims THIS claim raises doubt about

For references to EXISTING claims (listed in the prompt with [ID] prefixes):
- depends_on_existing: IDs of existing claims THIS claim depends on
- supports_existing: IDs of existing claims THIS claim provides evidence for
- contradicts_existing: IDs of existing claims THIS claim contradicts
- questions_existing: IDs of existing claims THIS claim raises doubt about

EVERY non-foundational claim MUST have at least one edge. If claim B builds on claim A, B's depends_on should reference A. A graph with many orphans (unconnected claims) is a failure of extraction.

Draw edges for argumentative relationships — where one claim is evidence for, a premise of, or in tension with another. Do NOT draw edges for topical proximity alone (two claims about the same subject are not connected unless one is a reason to believe or doubt the other).

Be aggressive about identifying claims. Even casual assertions like "I think X relates to Y" are claims with basis "vibes". Pay special attention to:
- Claims stated confidently without evidence (basis = "vibes" or "llm_output")
- Analogies treated as equivalences (basis = "analogy" but used as if "research")
- Claims the assistant agreed with without independently verifying (basis = "llm_output")
- Assumptions that went unstated but underpin the reasoning

BASIS CLASSIFICATION — follow the decision tree strictly:
The decision tree above is an ordered priority. Apply the FIRST matching rule. The most important rule is: after checking for research/empirical/definition/convention/deduction/analogy, the SPEAKER determines whether an unsourced claim is "llm_output" (assistant) or "vibes" (user).

Additional precision:
- "research" REQUIRES a specific citation, author name, study, or named finding IN THE TEXT.
- "vibes" means "unsourced assertion by the user." It is NOT pejorative — it is a structural label.
- "assumption" is ONLY for claims explicitly framed as premises: "let's assume", "given that", "suppose". Factual claims presented as true are vibes (user) or llm_output (assistant), NOT assumption.
- "llm_output" is any unsourced factual claim by the assistant.
- "deduction" requires explicit logical steps: "if A then B, A, therefore B." Two sequential assertions are NOT deduction.
- "empirical" requires first-person observation: "I tried X and saw Y".
- "convention" is for stipulative practice/policy by a named actor.

Output valid JSON matching the provided schema. Extract ALL substantive claims, not just the main ones.`;

export const USER_PROMPT_TEMPLATE = (transcriptChunk: string, existingClaimsBlock: string): string => `Extract all substantive claims from this conversation transcript:

---
${transcriptChunk}
---

${existingClaimsBlock}

Extract every claim, connection, assumption, and assertion. Be thorough — missing a load-bearing assumption is worse than including a marginal claim. Use index numbers for intra-batch references and existing claim IDs (in brackets) for cross-batch references.`;

export type ExistingClaimRef = {
  id: string;
  text: string;
  basis: string;
};

export function formatExistingClaims(existing: ExistingClaimRef[]): string {
  if (existing.length === 0) return '';
  let s = 'Existing claims already in the graph (reference by their ID in brackets):\n';
  for (const c of existing) {
    s += `- [${c.id}] "${c.text}" (${c.basis})\n`;
  }
  return s;
}

// Tool input schema for Anthropic's tool-use API. Trimmed from slimemold's
// schema to the fields buddy stores. The LLM is forced to emit a single
// `extract_claims` tool call whose input matches this shape.
export const EXTRACTION_TOOL_SCHEMA = {
  type: 'object',
  properties: {
    claims: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          index: { type: 'integer', description: 'Sequential index starting from 0, unique within this batch' },
          text: { type: 'string', description: 'The claim, stated concisely' },
          basis: {
            type: 'string',
            enum: ['research', 'empirical', 'analogy', 'vibes', 'llm_output', 'deduction', 'assumption', 'definition', 'convention'],
          },
          confidence: { type: 'string', enum: ['low', 'medium', 'high'] },
          speaker: { type: 'string', enum: ['user', 'assistant'] },
          depends_on_indices: { type: 'array', items: { type: 'integer' } },
          supports_indices: { type: 'array', items: { type: 'integer' } },
          contradicts_indices: { type: 'array', items: { type: 'integer' } },
          questions_indices: { type: 'array', items: { type: 'integer' } },
          depends_on_existing: { type: 'array', items: { type: 'string' } },
          supports_existing: { type: 'array', items: { type: 'string' } },
          contradicts_existing: { type: 'array', items: { type: 'string' } },
          questions_existing: { type: 'array', items: { type: 'string' } },
        },
        required: ['index', 'text', 'basis', 'confidence', 'speaker'],
      },
    },
  },
  required: ['claims'],
} as const;

// Shape of a single extracted claim coming back from the LLM. Cross-batch and
// intra-batch edge references are flattened into buddy's `EdgeInput[]` after
// the call returns.
export type ExtractedClaim = {
  index: number;
  text: string;
  basis: string;       // may be 'convention'; mapped before storage
  confidence: 'low' | 'medium' | 'high';
  speaker: 'user' | 'assistant';
  depends_on_indices?: number[];
  supports_indices?: number[];
  contradicts_indices?: number[];
  questions_indices?: number[];
  depends_on_existing?: string[];
  supports_existing?: string[];
  contradicts_existing?: string[];
  questions_existing?: string[];
};

export type ExtractionResult = {
  claims: ExtractedClaim[];
};
