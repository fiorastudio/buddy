// src/lib/reasoning/index.ts
//
// Public API for buddy's insight-mode reasoning layer. Keeps the surface thin:
// everything that callers outside this folder need is re-exported here so
// the implementation files can be reshuffled without touching the rest
// of the codebase.

export { REASONING_CONFIG } from './config.js';
export { deriveSessionId, sessionDayStartMs, isValidSessionId } from './session.js';
export { sanitizeClaim } from './sanitize.js';
export { initReasoningSchema } from './schema.js';
export { writeClaims, loadRecentClaims, countClaims, type WriteResult } from './writer.js';
export { loadSessionGraph, type SessionGraph } from './graph.js';
export { loadSessionGraphCached, bumpGeneration, resetGraphCache, cacheStats } from './graph-cache.js';
export { runAllDetectors } from './detectors.js';
export { selectFinding, logFinding } from './findings.js';
export { buildExtractionInstruction } from './extract-prompt.js';
export { getStressedVoice } from './stressed-voice.js';
export { phraseFinding, claimSnippet } from './phrasings.js';
export { pruneOldSessions, purge, type PurgeScope, type PurgeResult } from './retention.js';
export { getAndBumpObserveSeq } from './observe-seq.js';
export { resolveProjectRoot, resetProjectRootMemo, type ResolvedRoot, type RootSource } from './project-root.js';
export { scrubReactionText, detectLeaks } from './scrub.js';
export {
  runInsightPipeline,
  type PipelineInputs, type PipelineOutputs, type PipelineOptions,
} from './pipeline.js';
export { planModeChange, formatModeResponse, type ModeInput, type ModePlan, type CurrentState } from './mode-handler.js';
export {
  type Finding, type FindingType, type Basis, type EdgeType,
  type ClaimInput, type EdgeInput, type StoredClaim, type StoredEdge,
  isCaution, CAUTION_FINDINGS, KUDOS_FINDINGS, BASIS_VALUES, EDGE_TYPES,
} from './types.js';
export * as telemetry from './telemetry.js';
