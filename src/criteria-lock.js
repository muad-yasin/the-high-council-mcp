// Locked criteria (0.8.0, roadmap "Debate, criteria, milestones" item 1). The acceptance criteria are
// settled before anything is drafted, and a HANDOFF.md is read by a build session that has to treat
// them as the definition of done. This module gives them a fingerprint the harness writes, not a
// model: a hash over the exact list, a block appended to HANDOFF.md, and a $0 check that a copy of
// that file (the run's, or the project's own) still carries the criteria the run settled.
//
// It protects against accidental drift and a careless edit. It is not a signature: anyone who can edit
// the file can edit the block and the hash together, and the check says nothing about who did.
import { createHash } from 'node:crypto';

export const LOCK_HEADING = '## Locked criteria';
export const LOCK_MARKER = 'the-high-council:criteria-lock';

const oneLine = s => String(s ?? '').replace(/\s+/g, ' ').trim();

/** sha256 (64 hex) over the criteria list, each criterion collapsed to one line. Order counts. */
export function criteriaHash(criteria) {
  const list = (Array.isArray(criteria) ? criteria : []).map(oneLine);
  return createHash('sha256').update(JSON.stringify(list), 'utf8').digest('hex');
}

/** The block appended to HANDOFF.md; '' when there are no criteria to lock. */
export function lockBlock(criteria, { runId } = {}) {
  const list = (Array.isArray(criteria) ? criteria : []).map(oneLine).filter(Boolean);
  if (!list.length) return '';
  const hash = criteriaHash(list);
  return [
    '',
    '---',
    '',
    LOCK_HEADING,
    '',
    `The council settled these ${list.length} acceptance criteria before it drafted. The harness wrote this block, not a model.`,
    `Fingerprint ${hash.slice(0, 12)}. To check that a copy of this file still carries them: \`council check-lock <this file>\`.`,
    '',
    ...list.map((c, i) => `C${i + 1}. ${c}`),
    '',
    `<!-- ${LOCK_MARKER} sha256=${hash} count=${list.length}${runId ? ` run=${runId}` : ''} -->`,
    '',
  ].join('\n');
}

/** Read the block back out of a file's text: { found, criteria, sha256, count, run } (last block wins). */
export function parseLock(text) {
  const t = String(text ?? '');
  const re = new RegExp(`<!-- ${LOCK_MARKER} sha256=([0-9a-f]{64}) count=(\\d+)(?: run=(\\S+))? -->`, 'g');
  let m; let last = null;
  while ((m = re.exec(t)) !== null) last = m;
  if (!last) return { found: false, criteria: [], sha256: null, count: 0, run: null };
  // The criteria lines are the numbered C<n>. lines between the heading before the marker and the marker.
  const head = t.lastIndexOf(LOCK_HEADING, last.index);
  const body = head === -1 ? '' : t.slice(head, last.index);
  const criteria = [];
  for (const line of body.split('\n')) {
    const c = line.match(/^C(\d+)\. (.*)$/);
    if (c) criteria.push({ n: Number(c[1]), text: c[2] });
  }
  return { found: true, criteria, sha256: last[1], count: Number(last[2]), run: last[3] ?? null, hasHeading: head !== -1 };
}

/**
 * Does this file's lock block still describe the criteria it claims? `expected` is optional: the list
 * the run settled (report.json's criteria), for the stronger check that the file and the run agree.
 * Returns { ok, problems[] }; `problems` is empty when ok. Never throws.
 */
export function checkLock(text, { expected } = {}) {
  const lock = parseLock(text);
  if (!lock.found) return { ok: false, found: false, problems: ['no criteria-lock block in this file'] };
  const problems = [];
  if (!lock.hasHeading) problems.push(`the "${LOCK_HEADING}" heading is missing`);
  const inOrder = lock.criteria.every((c, i) => c.n === i + 1);
  if (!inOrder) problems.push('the criteria are not numbered C1, C2, ... in order');
  if (lock.criteria.length !== lock.count) problems.push(`the block says ${lock.count} criteria but lists ${lock.criteria.length}`);
  const listed = lock.criteria.map(c => c.text);
  if (criteriaHash(listed) !== lock.sha256) problems.push('the listed criteria no longer match the fingerprint: a criterion was edited, added, removed or reordered');
  if (Array.isArray(expected)) {
    if (criteriaHash(expected) !== lock.sha256) problems.push('the criteria this run settled (report.json) differ from the ones in this file');
  }
  return { ok: problems.length === 0, found: true, problems, run: lock.run, sha256: lock.sha256 };
}
