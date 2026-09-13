// v3 plan §1: the three warn-only checks `submit_stage` runs on a peer-submitted stage answer
// before accepting it as the stage's final one, factored out of src/mcp/server.js's tool handler
// so they're independently testable without spinning up the MCP transport (see
// test/peer-claim.test.js). Pure file-based logic, no network, no subprocess.
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { stageKindOf } from './stage-contract.js';
import { validateDeliverable } from './partial-deliverable.js';
import { writeClaim, readClaimFor } from './peer-claim.js';
import { words } from './ui/parse.js';

/**
 * Evaluate and write one stage answer. Never rejects: every check below produces a warning,
 * not a refusal, and the existing required-arguments/return-shape contract for a caller that
 * omits `claimedBy` is unchanged (see the caller in src/mcp/server.js).
 *
 * @param {string} dir - the run folder.
 * @param {string} stage - the stage label (e.g. "build", "criteria").
 * @param {string} content - the submitted answer text.
 * @param {{ claimedBy?: string, chainConfig?: object }} opts
 * @returns {{ warnings: Array<object>, writtenFile: string, isDuplicate: boolean }}
 */
export function submitStageAnswer(dir, stage, content, { claimedBy, chainConfig } = {}) {
  const warnings = [];

  // (1) claim_mismatch: claimedBy given, differs from an existing claim's claimed_by.
  const existingClaim = readClaimFor(dir, stage);
  if (claimedBy && existingClaim && existingClaim.claimed_by !== claimedBy) {
    warnings.push({ type: 'claim_mismatch', stage, claimed_by: claimedBy, claim_holder: existingClaim.claimed_by });
  }
  if (claimedBy) writeClaim(dir, stage, claimedBy);

  // (2) stage_validation_failed: reuse v2's own required-sections machinery
  // (stage-contract.js/partial-deliverable.js), not a new validator.
  const kind = stageKindOf(stage);
  if (chainConfig && kind) {
    const check = validateDeliverable(kind, content);
    if (!check.ok) warnings.push({ type: 'stage_validation_failed', stage, reason: check.reason, missing: check.missing });
  }

  // (3) duplicate_answer: <stage>.md already exists - never silently overwrite (that would
  // silently discard whichever peer answered first). Keep both; the harness picks neither.
  const answerFile = join(dir, `${stage}.md`);
  const isDuplicate = existsSync(answerFile);
  const writtenFile = isDuplicate ? join(dir, `${stage}.late.md`) : answerFile;
  const usageFile = isDuplicate ? join(dir, `${stage}.late.usage.json`) : join(dir, `${stage}.usage.json`);
  if (isDuplicate) warnings.push({ type: 'duplicate_answer', stage, kept: [`${stage}.md`, `${stage}.late.md`] });

  writeFileSync(writtenFile, content);
  writeFileSync(usageFile, JSON.stringify({ provider: 'external', model: 'claude-code-session', usage: { input: 0, output: words(content) }, usd: 0, ms: 0 }));

  return { warnings, writtenFile, isDuplicate };
}
