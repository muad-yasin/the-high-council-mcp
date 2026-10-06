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
// 0.8.1 FX-10 (DR-11): how each criterion is checked has its own fingerprint, in a second marker after the first. The
// first marker and criteria_sha256 are unchanged, so a 0.8.0 reader still reads the block and a 0.8.0 file still passes.
export const CHECKS_MARKER = 'the-high-council:criteria-checks';

const oneLine = s => String(s ?? '').replace(/\s+/g, ' ').trim();

/** sha256 (64 hex) over the criteria list, each criterion collapsed to one line. Order counts. */
export function criteriaHash(criteria) {
  const list = (Array.isArray(criteria) ? criteria : []).map(oneLine);
  return createHash('sha256').update(JSON.stringify(list), 'utf8').digest('hex');
}

/**
 * One entry per criterion, index-aligned: { check, on } when a named check settles it (criteria_kinds' checkable items),
 * else null. `kinds` is report.json's criteria_kinds (or the run's criteriaKinds); absent means no checks at all.
 */
export function checksOf(criteria, kinds) {
  return (Array.isArray(criteria) ? criteria : []).map((_, i) => {
    const k = Array.isArray(kinds) ? kinds[i] : null;
    return k && k.kind === 'checkable' && k.check ? { check: oneLine(k.check), on: oneLine(k.on) } : null;
  });
}

/** sha256 (64 hex) over how each criterion is checked, index-aligned, null for a criterion with no check. Order counts. */
export function checksHash(checks) {
  const list = (Array.isArray(checks) ? checks : []).map(c => (c && c.check ? [oneLine(c.check), oneLine(c.on)] : null));
  return createHash('sha256').update(JSON.stringify(list), 'utf8').digest('hex');
}

/** The block appended to HANDOFF.md; '' when there are no criteria to lock. `checks`: checksOf()'s list, index-aligned. */
export function lockBlock(criteria, { runId, checks } = {}) {
  const pairs = (Array.isArray(criteria) ? criteria : []).map((c, i) => ({ text: oneLine(c), check: Array.isArray(checks) ? checks[i] ?? null : null })).filter(p => p.text);
  const list = pairs.map(p => p.text);
  if (!list.length) return '';
  const hash = criteriaHash(list);
  const checkList = pairs.map(p => (p.check && p.check.check ? { check: oneLine(p.check.check), on: oneLine(p.check.on) } : null));
  return [
    '',
    '---',
    '',
    LOCK_HEADING,
    '',
    `The council settled these ${list.length} acceptance criteria before it drafted. The harness wrote this block, not a model.`,
    `Fingerprint ${hash.slice(0, 12)}. To check that a copy of this file still carries them: \`council check-lock <this file>\`.`,
    '',
    ...pairs.flatMap((p, i) => [`C${i + 1}. ${p.text}`, ...(checkList[i] ? [`   check: ${checkList[i].check} (on: ${checkList[i].on})`] : [])]),
    '',
    `<!-- ${LOCK_MARKER} sha256=${hash} count=${list.length}${runId ? ` run=${runId}` : ''} -->`,
    `<!-- ${CHECKS_MARKER} sha256=${checksHash(checkList)} count=${checkList.filter(Boolean).length} -->`,
    '',
  ].join('\n');
}

/**
 * The text without a trailing lock block (0.8.1 FX-9): on a case-insensitive disk the cached `handoff` stage file
 * (handoff.md) and the final HANDOFF.md are one file, so a replay of the stage would carry the block into the model's
 * text. Cuts from the block's separator and heading, only when a criteria marker follows; anything else is unchanged.
 */
export function stripLockBlock(text) {
  const t = String(text ?? '');
  const norm = t.replace(/\r\n?/g, '\n');
  const i = norm.lastIndexOf(`---\n\n${LOCK_HEADING}`);
  if (i === -1 || !norm.slice(i).includes(`<!-- ${LOCK_MARKER} `)) return t;
  return `${norm.slice(0, i).replace(/\s+$/, '')}\n`;
}

/** Read the block back out of a file's text: { found, criteria, sha256, count, run } (last block wins). */
export function parseLock(text) {
  // Line endings are normalised first (0.8.1 FX-4): a copy saved with CRLF, or partly CRLF, is the same file, and each
  // criterion line would otherwise keep a carriage return that changes its hash.
  const t = String(text ?? '').replace(/\r\n?/g, '\n');
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
    if (c) { criteria.push({ n: Number(c[1]), text: c[2], check: null }); continue; }
    // A check line belongs to the criterion above it (FX-10). The last "(on: ...)" ends it, so a check may contain parentheses.
    const k = line.match(/^ {3}check: (.*) \(on: ([^()]*)\)$/);
    if (k && criteria.length) criteria[criteria.length - 1].check = { check: k[1], on: k[2] };
  }
  // The checks marker, when the block has one, comes after the criteria marker.
  const cre = new RegExp(`<!-- ${CHECKS_MARKER} sha256=([0-9a-f]{64}) count=(\\d+) -->`, 'g');
  cre.lastIndex = last.index;
  let cm; let checksMarker = null;
  while ((cm = cre.exec(t)) !== null) checksMarker = cm;
  return {
    found: true, criteria, sha256: last[1], count: Number(last[2]), run: last[3] ?? null, hasHeading: head !== -1,
    checksSha256: checksMarker ? checksMarker[1] : null, checksCount: checksMarker ? Number(checksMarker[2]) : null,
  };
}

/**
 * Does this file's lock block still describe the criteria it claims? `expected` is optional: the list
 * the run settled (report.json's criteria), for the stronger check that the file and the run agree.
 * Returns { ok, problems[] }; `problems` is empty when ok. Never throws.
 */
export function checkLock(text, { expected, expectedChecksSha256 } = {}) {
  const lock = parseLock(text);
  if (!lock.found) return { ok: false, found: false, problems: ['no criteria-lock block in this file'] };
  const problems = [];
  const notes = [];
  if (!lock.hasHeading) problems.push(`the "${LOCK_HEADING}" heading is missing`);
  const inOrder = lock.criteria.every((c, i) => c.n === i + 1);
  if (!inOrder) problems.push('the criteria are not numbered C1, C2, ... in order');
  if (lock.criteria.length !== lock.count) problems.push(`the block says ${lock.count} criteria but lists ${lock.criteria.length}`);
  const listed = lock.criteria.map(c => c.text);
  if (criteriaHash(listed) !== lock.sha256) problems.push('the listed criteria no longer match the fingerprint: a criterion was edited, added, removed or reordered');
  if (Array.isArray(expected)) {
    if (criteriaHash(expected) !== lock.sha256) problems.push('the criteria this run settled (report.json) differ from the ones in this file');
  }
  // How each criterion is checked (FX-10). A block written before 0.8.1 has no checks marker: it passes, with a note.
  if (lock.checksSha256) {
    const listed = lock.criteria.map(c => c.check);
    if (checksHash(listed) !== lock.checksSha256) problems.push('the listed checks no longer match the checks fingerprint: a check or its `on` was edited, added or removed');
    if (listed.filter(Boolean).length !== lock.checksCount) problems.push(`the block says ${lock.checksCount} checks but lists ${listed.filter(Boolean).length}`);
    if (typeof expectedChecksSha256 === 'string' && expectedChecksSha256 !== lock.checksSha256) problems.push('the checks this run settled (report.json checks_sha256) differ from the ones in this file');
  } else if (typeof expectedChecksSha256 === 'string') {
    // M2 review: the run recorded a checks fingerprint, so a block without one lost it (deleted, or copied from elsewhere).
    problems.push('the run recorded a checks fingerprint (report.json checks_sha256), but this file\'s block has none: the checks marker was removed');
  } else {
    notes.push('this block carries no checks fingerprint (written before 0.8.1): how each criterion is checked is not covered');
  }
  return { ok: problems.length === 0, found: true, problems, notes, run: lock.run, sha256: lock.sha256, checksSha256: lock.checksSha256 };
}
