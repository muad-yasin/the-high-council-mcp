// `council handoff --from-run <folder>` (0.8.0, roadmap "Debate, criteria, milestones" item 3): a
// HANDOFF.md for a run that never got to write one - it stopped at the spend cap, paused and was
// abandoned, or crashed - from the latest draft the run left on disk. Everything that decides WHAT to
// hand over lives here as pure functions over a run folder; src/cli.js does the one model call.
//
// What it will not do: pretend the plan was signed off. A run that has no report.json gets a banner,
// written by the harness at the top of the file, saying where the run stopped and that no panel signed
// off on the draft below it.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = p => { try { return readFileSync(p, 'utf8'); } catch { return null; } };
const readJson = p => { const t = read(p); if (t == null) return null; try { return JSON.parse(t); } catch { return null; } };

/**
 * The most finished draft the run folder holds: deliverable.md, else final.md, else the highest
 * revise-N.md, else build.md. { name, text } or null. An empty file does not count.
 */
export function pickDraft(runDir) {
  const names = existsSync(runDir) ? readdirSync(runDir) : [];
  const revise = names.filter(n => /^revise-\d+\.md$/.test(n)).sort((a, b) => Number(b.match(/\d+/)[0]) - Number(a.match(/\d+/)[0]));
  for (const name of ['deliverable.md', 'final.md', ...revise, 'build.md']) {
    if (!names.includes(name)) continue;
    const text = read(join(runDir, name));
    if (text && text.trim()) return { name, text };
  }
  return null;
}

/** The criteria the run settled: report.json, else report-partial.json, else the criteria stage's reply. [] when none. */
export function readCriteria(runDir) {
  for (const f of ['report.json', 'report-partial.json']) {
    const r = readJson(join(runDir, f));
    if (Array.isArray(r?.criteria) && r.criteria.length) return r.criteria.map(c => (typeof c === 'string' ? c : String(c?.criterion ?? c?.text ?? ''))).filter(Boolean);
  }
  const stage = read(join(runDir, 'criteria.md'));
  if (stage) {
    const first = stage.indexOf('{'); const last = stage.lastIndexOf('}');
    try {
      const j = JSON.parse(stage.slice(first, last + 1));
      if (Array.isArray(j?.criteria)) return j.criteria.map(c => (typeof c === 'string' ? c : String(c?.criterion ?? c?.text ?? ''))).filter(Boolean);
    } catch { /* not JSON: no criteria from here */ }
  }
  return [];
}

/**
 * Where the run stopped, from the marker files it left. { finished, signedOff, reason } where
 * `finished` means report.json exists (a full run: no banner needed unless the panel did not sign off).
 */
export function stopState(runDir) {
  const report = readJson(join(runDir, 'report.json'));
  if (report) return { finished: true, signedOff: report.passed === true, reason: report.passed === true ? 'signed off' : 'finished with open objections' };
  const has = f => existsSync(join(runDir, f));
  if (has('STOPPED-budget.json')) {
    const b = readJson(join(runDir, 'STOPPED-budget.json'));
    return { finished: false, signedOff: false, reason: `stopped at the spend cap${b?.stoppedAt ? ` before stage "${b.stoppedAt}"` : ''}` };
  }
  if (has('STOPPED-truncated.json') || has('STOPPED-truncated.md')) return { finished: false, signedOff: false, reason: 'a draft was cut off at its token cap' };
  if (has('STOPPED-error.md') || has('STOPPED-error.json')) return { finished: false, signedOff: false, reason: 'stopped at an error' };
  if (has('STOPPED-preflight.md')) return { finished: false, signedOff: false, reason: 'the task was refused before any stage' };
  if (readdirSync(runDir).some(n => n.startsWith('NEEDS-'))) return { finished: false, signedOff: false, reason: 'paused at an external seat and never answered' };
  return { finished: false, signedOff: false, reason: 'ended without a report (crashed or killed)' };
}

/** The harness-written note that goes above a handoff whose plan no panel signed off. '' when it did. */
export function partialBanner({ state, draftName, runId }) {
  if (state.signedOff) return '';
  return [
    `> **Not a signed-off plan.** Written by the harness, not a model, from the latest draft of run ${runId || '(unnamed)'} (\`${draftName}\`).`,
    `> The run ${state.reason}. The panel did not sign off on the plan below: treat every part of it as a proposal, and read the run's BOARD.md or report.json for what was left open.`,
    '',
    '',
  ].join('\n');
}

/** The prompt file for an external handoff seat (a Claude Code session), to paste or hand over. */
export function externalPromptText({ system, user, runDir, target }) {
  return `# Handoff prompt (external seat)\n\nThe chain's handoff seat is a session you run yourself. Give it the system prompt and the user message below, and save what it returns as \`${target}\` (the harness adds no lock block or banner to a file you write yourself; \`council check-lock\` needs the block).\n\nRun folder: ${runDir}\n\n## System prompt\n\n${system}\n\n## User message\n\n${user}\n`;
}
