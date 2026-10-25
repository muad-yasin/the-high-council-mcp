// v3 plan §1: the three warn-only checks `submit_stage` runs on a peer-submitted stage answer (and, since 14 Oct 2026, one REFUSING check before them: the credential-shape input scan, below)
// before accepting it as the stage's final one, factored out of src/mcp/server.js's tool handler
// so they're independently testable without spinning up the MCP transport (see
// test/peer-claim.test.js). Pure file-based logic, no network, no subprocess.
import { existsSync } from 'node:fs';
import { writeRunFileAtomic } from './run-files.js';
import { join, basename } from 'node:path';
import { stageKindOf } from './stage-contract.js';
import { validateDeliverable } from './partial-deliverable.js';
import { writeClaim, readClaimFor } from './peer-claim.js';
import { words } from './ui/parse.js';
import { secretShapesIn } from './outbound-scan.js';

// 0.8.3 harness (a): the usage record of a session answer names no tool. Older run folders hold 'claude-code-session' here; every reader takes any string (a golden-folder test pins that), and nothing maps the old name to this one.
export const SESSION_MODEL = 'session';

/** "2 key-shaped strings (named credential assignment, Bearer token; lines 3, 7)": what a refusal says about findings of `secretShapesIn`. Names the formats and the lines, NEVER the value. */
export function credentialSentence(found) {
  const formats = [...new Set(found.map(f => f.name))].join(', ');
  const lines = [...new Set(found.map(f => f.line))];
  return `${found.length} key-shaped string${found.length === 1 ? '' : 's'} (${formats}; line${lines.length === 1 ? '' : 's'} ${lines.join(', ')})`;
}

/** prepare_stage_prompt's refusal (E 146 b/c), or null when the bundle is clean. The task file is scanned on its own first so the line numbers are the task file's; then the whole bundle. Lives here, not in server.js, so the reserved-host exemption is asked for in one small refusal-only file (RES-7). */
export function stageBundleRefusal(taskText, bundle) {
  const inTask = secretShapesIn(taskText, { exemptReservedHosts: true });
  if (inTask.length) return `stage_prompt.md was not written: the task file holds ${credentialSentence(inTask)}, and the bundle goes to a fresh subagent. Take them out of the task file, then call prepare_stage_prompt again.`;
  const inBundle = secretShapesIn(bundle, { exemptReservedHosts: true });
  if (inBundle.length) return `stage_prompt.md was not written: the stage bundle holds ${credentialSentence(inBundle)}, and the bundle goes to a fresh subagent. Take them out of what it quotes (the task file, the plan or the criteria), then call prepare_stage_prompt again.`;
  return null;
}

/**
 * Evaluate and write one stage answer. The three checks of v3 plan §1 never reject: each produces a warning,
 * not a refusal. ONE check does refuse (14 Oct 2026): an answer that holds a credential-shaped string is not written and this throws (the handler returns the message); and the existing required-arguments/return-shape contract for a caller that
 * omits `claimedBy` is unchanged (see the caller in src/mcp/server.js).
 *
 * @param {string} dir - the run folder.
 * @param {string} stage - the stage label (e.g. "build", "criteria").
 * @param {string} content - the submitted answer text.
 * @param {{ claimedBy?: string, chainConfig?: object, declaredAnswer?: object }} opts - declaredAnswer: the answerer's own declaration (built in src/mcp/server.js from the MCP handshake and the answered_model argument), stored in the usage record as `answered_by`; never checked
 * @returns {{ warnings: Array<object>, writtenFile: string, isDuplicate: boolean }}
 */
export function submitStageAnswer(dir, stage, content, { claimedBy, chainConfig, declaredAnswer = null } = {}) {
  // 14 Oct 2026 (Haiku batch 4 A10 F2; Muad 12 Oct 06:19 "the check should go everywhere"): an answer a person or a peer session types for an external stage goes into the prompts of the seats that come after it. invoke()'s send-time scan reads only the DISTINCTIVE key
  // formats (it runs on prompts that carry model output), so a Bearer header, a URL password or `NAME=secret` in an answer passed. An answer is INPUT: it gets the full input scan, here, BEFORE anything is written or claimed. No override over MCP. Names stage, formats and lines, never the value.
  const found = secretShapesIn(content, { exemptReservedHosts: true });
  if (found.length) throw new Error(`the answer for "${stage}" was not written: it holds ${credentialSentence(found)}. Take them out of the answer, then submit it again.`);
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

  // 0.8.2 item 2: written without following a symbolic link (src/run-files.js); a refusal stops the submission before anything is accepted.
  // Usage record FIRST, answer text LAST, both atomic (temp file + rename): the main run's order (src/stage-cache.js, src/cli.js onStage). The text file is what makes a stage "answered", so a refused or failed write of either file
  // leaves no truncated answer behind; a usage file whose text never landed is the cache's orphan case, handled on resume.
  const usage = writeRunFileAtomic(dir, basename(usageFile), JSON.stringify({ provider: 'external', model: SESSION_MODEL, ...(declaredAnswer ? { answered_by: declaredAnswer } : {}), usage: { input: 0, output: words(content) }, usd: 0, ms: 0 }));
  if (usage.refusal) throw new Error(usage.refusal);
  const text = writeRunFileAtomic(dir, basename(writtenFile), content);
  if (text.refusal) throw new Error(text.refusal);

  return { warnings, writtenFile, isDuplicate };
}
