// src/lib/reasoning/sanitize.ts
//
// Claim text comes from the host (which got it from the user or LLM output).
// We neutralize structural prompt-injection attempts before storing or
// re-injecting into a prompt.
//
// Scope: "structural break prevention," not adversarial robustness. We aim
// to prevent a claim from accidentally or lazily restructuring a downstream
// prompt (code fences closing early, role markers appearing to start a new
// turn, header-style separators dividing sections, free-standing quotes
// unbalancing the snippet delimiter we use in prompts). We do NOT defend
// against a motivated attacker who controls the host — that's the host's
// job. If guard mode is off, sanitize is never invoked.

import { REASONING_CONFIG } from './config.js';

// Minimal HTML-entity decode table — covers the cases that would re-form
// a structural separator after our strip passes (e.g. `&lt;system&gt;`
// surviving the XML-tag strip). Not a full HTML parser.
const HTML_ENTITIES: Record<string, string> = {
  '&lt;': '<',
  '&gt;': '>',
  '&amp;': '&',
  '&quot;': '"',
  '&apos;': "'",
  '&#39;': "'",
  '&#x27;': "'",
  '&#60;': '<',
  '&#62;': '>',
  '&#x3c;': '<',
  '&#x3e;': '>',
  '&#x3C;': '<',
  '&#x3E;': '>',
};

function decodeHtmlEntities(s: string): string {
  // Iterate until the string stops changing. Handles double-encoded inputs
  // like `&amp;lt;` → `&lt;` → `<`. Bounded by SANITIZE_DECODE_MAX_PASSES
  // (in config.ts) so a pathological input can't loop forever. Adversarial
  // depth and base64-wrapped entities remain out of scope per the header.
  let prev = s;
  for (let i = 0; i < REASONING_CONFIG.SANITIZE_DECODE_MAX_PASSES; i++) {
    const next = prev.replace(/&(?:lt|gt|amp|quot|apos|#x?[0-9a-fA-F]+);/g, (m) => {
      return HTML_ENTITIES[m] ?? HTML_ENTITIES[m.toLowerCase()] ?? m;
    });
    if (next === prev) return next;
    prev = next;
  }
  return prev;
}

// Role markers, including unicode-lookalike variants for the common
// "lazy copy-paste" cases. The char class on each variant covers ASCII
// + the full-width form + the most common cross-script lookalike (Greek,
// Cyrillic). Not exhaustive by design — see sanitize.ts header for scope.
const ROLE_MARKERS = [
  /\b[HHΗН]uman:/gi,       // H (ASCII), Ｈ (full-width), Η (Greek eta), Н (Cyrillic En)
  /\b[AAΑА]ssistant:/gi,   // A (ASCII), Ａ (full-width), Α (Greek alpha), А (Cyrillic A)
  /\b[SSЅ]ystem:/gi,        // S (ASCII), Ｓ (full-width), Ѕ (Cyrillic Dze)
  /\b[UUՍ]ser:/gi,          // U (ASCII), Ｕ (full-width), Ս (Armenian Seh — rough, catches lazy)
  // Chat-template markers (OpenAI / Llama / generic `<|...|>` family).
  /<\|im_start\|>/gi,
  /<\|im_end\|>/gi,
  /<\|start_header_id\|>/gi,
  /<\|end_header_id\|>/gi,
  /<\|eot_id\|>/gi,
  /<\|begin_of_text\|>/gi,
  /<\|end_of_text\|>/gi,
  /<\|[a-z_]+\|>/gi,        // generic chat-template marker fallback
];

// Structural separators that could end a prompt section or open a new one.
const STRUCTURAL_BREAKS = [
  /```+/g,                  // fenced code (backticks)
  /~~~+/g,                  // fenced code (tildes)
  /"""/g,                   // python-style triple quote
  /'''/g,                   // python-style single triple quote
  /^\s*#{1,6}\s+/gm,         // markdown headers at line start
  /^\s*-{3,}\s*$/gm,         // horizontal-rule divider
  /^\s*={3,}\s*$/gm,         // setext-style divider
  // XMLish role / instruction tags. Covers system/user/assistant plus
  // common prompt-engineering wrappers (instructions, context, role, task,
  // example, document, tool_call, thinking).
  /<\/?(system|user|assistant|instructions?|context|role|task|example|document|tool_call|thinking)\b[^>]*>/gi,
];

export function sanitizeClaim(text: string | undefined): string {
  if (!text) return '';
  let s = text;

  // Decode HTML entities BEFORE the structural-break strips, so
  // `&lt;system&gt;` becomes `<system>` and gets caught. Without this,
  // a lazy host could bypass the XML-tag strip by HTML-escaping.
  s = decodeHtmlEntities(s);

  // Structural separators are matched first — some are anchored to line
  // starts (markdown headers, HR dividers), which require newlines still
  // to be present. We replace them with a space so surrounding words
  // don't fuse after the subsequent whitespace collapse.
  for (const re of STRUCTURAL_BREAKS) s = s.replace(re, ' ');

  // Now collapse newlines/tabs to spaces — claims are single-line
  // assertions. (Done before control-char strip because \n/\r/\t are
  // themselves control chars and would otherwise be deleted outright,
  // fusing adjacent words.)
  s = s.replace(/[\n\r\t]+/g, ' ');

  // Strip unicode control / format / private-use chars (what's left is
  // non-whitespace).
  s = s.replace(/[\p{Cf}\p{Cc}\p{Co}]/gu, '');

  // Strip role markers.
  for (const re of ROLE_MARKERS) s = s.replace(re, '');

  // Replace ASCII double quotes with single quotes so the surrounding
  // `"{claim}"` delimiter in phrasings and the observer prompt stays
  // balanced, and so the output reads naturally (rather than using
  // typographic quotes that render as two LEFT marks regardless of
  // position). Single quotes are safe — nothing in our prompts uses
  // single-quote delimiters.
  s = s.replace(/"/g, "'");

  // Collapse runs of whitespace.
  s = s.replace(/\s{2,}/g, ' ');

  s = s.trim();

  if (s.length > REASONING_CONFIG.MAX_CLAIM_TEXT_LENGTH) {
    s = s.slice(0, REASONING_CONFIG.MAX_CLAIM_TEXT_LENGTH - 1) + '…';
  }

  return s;
}
