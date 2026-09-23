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

/**
 * Check one stage's raw output text against its declared required sections.
 * Structured (JSON-returning) stages: every required_sections key must be present in the
 * parsed object. Freeform (text-returning) stages: the text must be non-empty - required
 * sections there name a single symbolic slot, not literal JSON keys to look up.
 */
export function validateDeliverable(stageKind, text) {
  const required = requiredSectionsFor(stageKind);
  if (!isStructuredStage(stageKind)) {
    if (typeof text === 'string' && text.trim().length > 0) return { ok: true };
    return { ok: false, missing: required, reason: 'empty or missing deliverable text' };
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
