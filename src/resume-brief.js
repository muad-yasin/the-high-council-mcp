// Resume-brief mechanism (v2 plan §5, DEEPSEEK-4 / GLM-4 / MISTRAL-4 merged design).
//
// A short, deterministic, regenerable summary of one run's state, so a driving session
// returning after time away - possibly with fully fresh context - can re-enter the run
// by reading one short file instead of reconstructing state from raw board files.
//
// Load-bearing property: RESUME.md is never itself authoritative. It is always
// regenerable from the run's actual state on disk (run.json + which stage files exist),
// so a deleted, stale, or hand-edited copy can never become a lying source of truth -
// the next call just rebuilds it identically. No LLM call: an LLM-generated brief could
// itself hallucinate state and become a new silent-failure vector, which this project has
// already been burned by once (the lab-dropout incident) and does not want a second version of.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { stageKindOf, stageKindsFor } from './stage-contract.js';
import { checkClaimStaleness } from './peer-claim.js';

// Mirrors src/mcp/server.js's waiting(dir), duplicated rather than imported: server.js is
// the MCP entrypoint (constructs and owns the server instance as a side effect of import),
// not a library other modules should pull in just to read run-folder state.
function pendingStage(dir) {
  if (!existsSync(dir)) return null;
  const w = readdirSync(dir).filter(f => f.startsWith('NEEDS-')).map(f => f.slice(6, -3)).filter(l => !existsSync(join(dir, `${l}.md`)));
  return w[0] || null;
}

function oneLineTaskSummary(taskPath) {
  if (!taskPath || !existsSync(taskPath)) return '(task file not found on disk)';
  const text = readFileSync(taskPath, 'utf8').trim();
  const firstLine = text.split('\n').find(l => l.trim().length > 0) || text;
  const clean = firstLine.replace(/^#+\s*/, '').trim();
  return clean.length > 140 ? `${clean.slice(0, 137)}...` : clean;
}

/**
 * Which stage-kind labels have at least one completed stage file on disk, in the order
 * chain.js would have run them (per stageKindsFor). A "completed" label is any file
 * `<label>.md` in the run folder whose label maps to a known stage kind - dedup by kind
 * since chain.js emits one label per lab/round for several kinds.
 */
function completedKinds(dir, chainConfig) {
  if (!existsSync(dir)) return [];
  const files = readdirSync(dir).filter(f => f.endsWith('.md') && !f.startsWith('NEEDS-') && f !== 'RESUME.md' && f !== 'BOARD.md' && f !== 'HANDOFF.md' && f !== 'deliverable.md' && f !== 'WARNINGS.md' && f !== 'proposals.md' && f !== 'proposals-pool.md');
  const seen = new Set();
  for (const f of files) {
    const kind = stageKindOf(f.replace(/\.md$/, ''));
    if (kind) seen.add(kind);
  }
  // Preserve chain-run order rather than filesystem order, so the brief reads as a timeline.
  return stageKindsFor(chainConfig).filter(k => seen.has(k));
}

/**
 * Build the resume brief for one run. Pure given its inputs: same run.json + same files on
 * disk always produce the same text (aside from being able to note new files appearing).
 */
export function generateResumeBrief({ runId, dir, runMeta, chainConfig }) {
  const kindsInOrder = chainConfig ? stageKindsFor(chainConfig) : [];
  const done = chainConfig ? completedKinds(dir, chainConfig) : [];
  const pending = pendingStage(dir);
  const deliverableDone = existsSync(join(dir, 'deliverable.md'));

  const lines = [];
  lines.push(`# RESUME BRIEF — run ${runId}`);
  lines.push(`Task: ${oneLineTaskSummary(runMeta?.task)}`);
  lines.push(`Status: ${deliverableDone ? kindsInOrder.length : done.length} of ${kindsInOrder.length || '?'} stages complete`);
  lines.push('');
  lines.push('## Decided so far');
  if (done.length === 0) lines.push('- (nothing completed yet)');
  else for (const kind of done) lines.push(`- ${kind}: complete`);
  // v3 §2: a declared scope amendment goes on the record here - the one block every
  // subsequent stage's prompt already reads - so a critic sees it instead of an
  // unexplained late requirement.
  const amendmentsPath = join(dir, 'AMENDMENTS.md');
  if (existsSync(amendmentsPath)) {
    lines.push('- Scope amendment(s) recorded, see below:');
    lines.push(readFileSync(amendmentsPath, 'utf8').trim());
  }
  lines.push('');
  lines.push('## Currently pending');
  if (deliverableDone) {
    lines.push('Stage: none - run is complete');
  } else if (pending) {
    lines.push(`Stage: ${pending}`);
    lines.push('Waiting on: an external seat\'s reply (see NEEDS-<stage>.md, or dispatch it with prepare_stage_prompt)');
    // v3 plan §1: surfaced here too, not only from external_prompt, so a returning session
    // sees a stalled or contested claim without an extra tool call.
    const claim = checkClaimStaleness(dir, pending);
    lines.push(`Claim: ${claim ? claim.type : 'none'}`);
  } else {
    lines.push('Stage: in progress or between stages');
    lines.push('Waiting on: nothing external right now');
  }
  lines.push(`Warnings: ${existsSync(join(dir, 'WARNINGS.md')) ? 'see WARNINGS.md' : 'none recorded'}`);
  // v5 §1 candidate 3: read back from report.json rather than recomputing -
  // by the time this runs (post-deliverable), the ledger is already settled
  // and recorded there; a resume brief has no reason to duplicate the walk.
  const reportPath = join(dir, 'report.json');
  if (existsSync(reportPath)) {
    try {
      const report = JSON.parse(readFileSync(reportPath, 'utf8'));
      if (report.orphanSections?.length) {
        lines.push(`Orphaned withdrawals: ${report.withdrawalCycles} cycle(s), no surviving owner for ${report.orphanSections.join(', ')} - see BOARD.md`);
      }
    } catch { /* malformed report.json: say nothing rather than guess */ }
  }
  lines.push('');
  lines.push('## Next action for the driving session');
  if (deliverableDone) lines.push(`Run is complete. Deliverable at ${join(dir, 'deliverable.md')}.`);
  else if (pending) lines.push(`Call prepare_stage_prompt(${JSON.stringify(runId)}, ${JSON.stringify(pending)}), or answer it directly and call submit_stage.`);
  else lines.push(`Call resume_run(${JSON.stringify(runId)}) or run_status(${JSON.stringify(runId)}) to check current progress.`);

  return `${lines.join('\n')}\n`;
}
