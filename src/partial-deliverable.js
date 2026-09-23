// Partial-deliverable detection (v2 plan §7.1, GLM-6 primary design with DEEPSEEK-6's
// schema/required-field validation approach).
//
// Same class of bug as the lab-dropout incident this project already fixed: a stage's
// submitted deliverable is missing a required section, is truncated JSON, or fails
// structural validation, but the harness marks the stage complete anyway and passes it
// downstream - a broken foundation that still looks complete, propagating further before
// anyone notices. This validates a stage's raw output against the same required_sections
// field the stage contract (§2.2) already declares, reused for free.
//
// This is a defense-in-depth check at the disk-persistence boundary in src/cli.js, not a
// change to chain.js's own control flow - the debate/proposal/reply/blind-panel mechanism
// is untouched (§11), and this module has no dependency on it.
import { parseJson } from './chain.js';
import { requiredSectionsFor, isStructuredStage } from './stage-contract.js';
import { parseFences } from './quote-check.js';

/**
 * Check one stage's raw output text against its declared required sections.
 * Structured (JSON-returning) stages: every required_sections key must be present in the
 * parsed object. Freeform (text-returning) stages: the text must be non-empty - required
 * sections there name a single symbolic slot, not literal JSON keys to look up.
 */
export function validateDeliverable(stageKind, text, usage = null) {
  const required = requiredSectionsFor(stageKind);
  // Pre-release audit 2026-09-23 (PreRelease_Audit_revise #1): a reply the provider reports as cut
  // off at its token cap is partial whatever its shape - a truncated draft is still non-empty text.
  if (usage && (usage.stop === 'length' || usage.stop === 'max_tokens')) {
    return { ok: false, missing: required, reason: `cut off at the token cap (stop: ${usage.stop})` };
  }
  if (!isStructuredStage(stageKind)) {
    if (!(typeof text === 'string' && text.trim().length > 0)) return { ok: false, missing: required, reason: 'empty or missing deliverable text' };
    const mid = endsMidStructure(text);
    return mid ? { ok: false, missing: [], reason: `the text ends mid-structure (${mid}) - it may be truncated` } : { ok: true };
  }
  const parsed = parseJson(text);
  if (!parsed || typeof parsed !== 'object') {
    return { ok: false, missing: required, reason: 'deliverable is not readable as JSON' };
  }
  // Present means present with a value: `{"criteria": null}` used to pass as a complete
  // deliverable (bug audit 2026-09-23, GuardLayer backlog).
  const missing = required.filter(key => parsed[key] === undefined || parsed[key] === null);
  if (missing.length) {
    return { ok: false, missing, reason: `missing required field(s): ${missing.join(', ')}` };
  }
  return { ok: true };
}

// A freeform draft whose last line leaves a structure open: a code fence never closed, a table row
// never finished, a heading or list marker with nothing after it. These are the shapes a reply cut
// off mid-generation leaves behind when a provider reports no stop reason. A heuristic, so it only
// ever produces a warning here; the hard stop for a cut-off draft is chain.js's DraftTruncated.
// Returns a short description, or null when the text ends cleanly.
export function endsMidStructure(text) {
  const src = String(text || '');
  if (parseFences(src).some(b => b.closed === false)) return 'a code block is never closed';
  const lines = src.replace(/\r/g, '').split('\n').map(l => l.trimEnd()).filter(l => l.trim().length);
  const last = lines[lines.length - 1] || '';
  if (/^\s*\|/.test(last) && !/\|\s*$/.test(last)) return 'the last table row is unfinished';
  if (/^\s{0,3}#{1,6}\s+\S/.test(last)) return 'it ends on a heading with nothing under it';
  if (/^\s*([-*+]|\d+[.)])\s*$/.test(last)) return 'it ends on an empty list item';
  return null;
}
