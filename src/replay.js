// v5 §1 candidate 9: a numbered, indented, step-by-step transcript of a
// run's reasoning - a CLI-native complement to the HTML export (candidate
// 8): CLI-stepped replay for a maintainer debugging a run, vs. a
// shareable artifact for a stranger. Read-only, derived from report.json.

/**
 * An ordered list of transcript steps from a run's report.json: proposals,
 * then each recorded stage, then the final verdict. Each step is
 * `{ n, kind, indent, text }` so a renderer can number and indent without
 * re-deriving structure.
 */
export function buildTranscript(report) {
  const steps = [];
  let n = 1;
  const push = (kind, indent, text) => steps.push({ n: n++, kind, indent, text });

  push('meta', 0, `Chain: ${report.chain || 'unknown'}${report.runId ? `, run: ${report.runId}` : ''}`);

  for (const p of report.proposals || []) {
    push('proposal', 0, `Proposal ${p.id} (${p.lab}): ${p.title}`);
    if (p.what) push('proposal-detail', 1, `What: ${p.what}`);
    if (p.withdrawn) push('proposal-detail', 1, `WITHDRAWN${p.replaced_by ? ` in favour of ${p.replaced_by}` : ''}`);
  }

  for (const s of report.stages || []) {
    push('stage', 0, `Stage ${s.label} (${s.provider}/${s.model})`);
  }

  for (const s of report.signoff || []) {
    push('signoff', 1, `${s.provider}: ${s.signedOff === null ? 'abstained' : s.signedOff ? 'signed off' : 'objected'}`);
  }

  push('verdict', 0, report.passed ? 'Verdict: PASSED - every lab signed off' : 'Verdict: OPEN OBJECTIONS');

  return steps;
}

export function renderTranscriptText(steps) {
  return steps.map(s => `${String(s.n).padStart(4)}. ${'  '.repeat(s.indent)}${s.text}`).join('\n');
}
