// A recorded change to ONE pass of the ladder (B3 prototype, 30 Okt 2026): the next pass starts at layer 3 although the ladder's own count would start it lower. Pure of the clock, the disk and the terminal: cli.js reads the run
// folder's file names, calls these, and writes the entry to run.json `ladderSteps` ([{ pass, floor: 3, at, via }]); chain.js reads the entries at the one place that sets a pass's first layer (stepOf).
// The pass number is FIXED when the entry is written (a later resume replays every pass from pass 1 and re-derives the ladder state, so an entry keyed to "the next pass" at each resume would re-ask a different layer for a pass
// whose stages are on disk). The stage cache replays a stage only for an identical prompt, so the entry must never reach a pass that already has a stage on disk.

/** The stage files that belong to pass `pass` (labels panel-<pass>-<seat>[...], ldebate-/lreply-<pass>[-x<k>]-<seat>, rule-<pass>-<n>, critique-<pass>[...]). `files` = the run folder's file names. */
export const PASS_STAGE_FAMILIES = Object.freeze(['panel', 'ldebate', 'lreply', 'rule', 'critique']);
export function stagesOfPass(files, pass) {
  const re = new RegExp(`^(?:${PASS_STAGE_FAMILIES.join('|')})-${pass}(?:-|\\.)`);
  return files.filter(f => re.test(f));
}

/**
 * Which pass the person is about to start: the pause the handler is answering. Needs a run that is waiting at a reviser pause whose answer is on disk and nothing else unanswered.
 * -> { ok: true, after, pass } (after = the revise pause N, pass = N + 1) | { ok: false, why: 'pending' | 'none', label? }
 */
export function pauseBefore(files) {
  const set = new Set(files);
  const pending = files.map(f => /^NEEDS-(.+)\.md$/.exec(f)?.[1]).filter(l => l && !set.has(`${l}.md`));
  if (pending.length) return { ok: false, why: 'pending', label: pending.sort()[0] };
  const nums = files.map(f => /^NEEDS-revise-(\d+)\.md$/.exec(f)?.[1]).filter(Boolean).map(Number);
  if (!nums.length) return { ok: false, why: 'none' };
  const after = Math.max(...nums);
  return { ok: true, after, pass: after + 1 };
}

/** A usable ladderSteps entry. Anything else in run.json is refused by the caller (run.json is project-writable text). */
export const stepOk = s => !!s && typeof s === 'object' && Number.isInteger(s.pass) && s.pass >= 1 && s.floor === 3;
/** The entry for `pass`, or null. */
export const stepOf = (steps, pass) => (Array.isArray(steps) ? steps.find(s => stepOk(s) && s.pass === pass) ?? null : null);
