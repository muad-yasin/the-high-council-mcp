// Writes the contract fixtures of test/fixtures/contract/ (0.8.2 item 6d, plan M8, persistence register P16) with the real contract code and a fixed clock, so they are byte-stable and
// test/contract-record.test.js can rebuild them and compare. Run: node scripts/contract-fixtures.mjs   (refuses if a target folder already exists; move the old one aside first).
//
//   run-v1/   a contract locked at version 1 (two obligations), one amendment request still open. check holds.
//   run-v2/   run-v1 plus: a request approved (version 2 names version 1), a second request declined (a recorded refusal), a third request that went stale. check holds.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { answerGate } from '../src/gate.js';
import { prepareLock, ensureGate, commitLock, requestAmendment, prepareAmendment, commitAmendment, declineAmendment, GATE_KIND_LOCK, GATE_KIND_AMEND } from '../src/contract-record.js';

export const FIXTURE_T0 = Date.parse('2026-10-07T09:00:00.000Z');
export const FIXTURE_DRAFT = {
  obligations: [
    { id: 'O1', text: 'The export command writes the file atomically: a crash never leaves a half-written file.', criterion: 'C1', check: 'node --test test/export.test.js' },
    { id: 'O2', text: 'Every error path prints one line naming the file and the reason.' },
  ],
};
const REPORT = { passed: true, thin_contract: { task_sha256: 'a'.repeat(64), criteria_sha256: 'b'.repeat(64), signed_text_sha256: 'c'.repeat(64), sha256: 'd'.repeat(64) } };

const clock = () => { let t = FIXTURE_T0; return () => (t += 1000); };
const ok = r => { if (!r.ok) throw new Error(`${r.code}: ${r.message}`); return r; };
const person = (dir, gate, sha, decision, now) => ok(answerGate(dir, gate, { channel: 'cli', shownSha256: sha, decision, actor: 'fixture', tty: true }, { now }));

/** Locks FIXTURE_DRAFT in `dir` (a run folder with a report.json) and returns { now } so a caller can carry on with the same clock. */
export function writeLocked(dir, now = clock()) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'report.json'), `${JSON.stringify(REPORT, null, 2)}\n`);
  const p = ok(prepareLock(dir, FIXTURE_DRAFT, { criteriaIds: ['C1', 'C2'] }));
  const g = ok(ensureGate(dir, { kind: GATE_KIND_LOCK, rel: p.rel, sha256: p.sha256 }, { now }));
  person(dir, g.gate, p.sha256, 'approved', now);
  ok(commitLock(dir, { content: p.content, gate: g.gate, sha256: p.sha256, rel: p.rel }, { now }));
  return { now };
}

// A request written against version 1 (every request here is, before version 2 exists).
const askV1 = (dir, now, obligation, proposed, reason) => ok(requestAmendment(dir, { version: 1, obligation_id: obligation, reason, proposed_text: proposed }, { now })).seq;

export function writeContractFixtures(root) {
  for (const name of ['run-v1', 'run-v2']) if (existsSync(join(root, name))) throw new Error(`${join(root, name)} exists; move it aside before regenerating`);
  // run-v1: locked, one request open
  { const dir = join(root, 'run-v1'); const { now } = writeLocked(dir); askV1(dir, now, 'O2', 'Every error path prints one line naming the file, the line and the reason.', 'The line number is what a person needs to find the cause.'); }
  // run-v2: request A approved (v2); requests B and C were filed against version 1 and read stale once version 2 exists; a fresh request D against version 2 is declined (a recorded refusal)
  {
    const dir = join(root, 'run-v2'); const { now } = writeLocked(dir);
    const a = askV1(dir, now, 'O2', 'Every error path prints one line naming the file, the line and the reason.', 'The line number is what a person needs to find the cause.');
    askV1(dir, now, 'O1', 'The export command writes the file atomically and says so in its output.', 'Printing it makes the guarantee visible.');
    askV1(dir, now, 'O1', 'The export command writes the file atomically (rename over the target).', 'A narrower wording of the same promise.');
    const pa = ok(prepareAmendment(dir, a));
    const ga = ok(ensureGate(dir, { kind: GATE_KIND_AMEND, rel: pa.rel, sha256: pa.sha256 }, { now }));
    person(dir, ga.gate, pa.sha256, 'approved', now);
    ok(commitAmendment(dir, { request: pa.request, prior: pa.prior, gate: ga.gate, sha256: pa.sha256, rel: pa.rel }, { now }));
    // B and C name version 1, which version 2 replaced: stale, not decidable. D names version 2 and a person declines it.
    const d = ok(requestAmendment(dir, { version: 2, obligation_id: 'O1', reason: 'Printing it makes the guarantee visible.', proposed_text: 'The export command writes the file atomically and says so in its output.' }, { now }));
    const pd = ok(prepareAmendment(dir, d.seq));
    const gd = ok(ensureGate(dir, { kind: GATE_KIND_AMEND, rel: pd.rel, sha256: pd.sha256 }, { now }));
    person(dir, gd.gate, pd.sha256, 'declined', now);
    ok(declineAmendment(dir, { requestSeq: d.seq, gate: gd.gate }, { now }));
  }
}

if (process.argv[1] && process.argv[1].endsWith('contract-fixtures.mjs')) {
  const { fileURLToPath } = await import('node:url');
  const { dirname, join: j } = await import('node:path');
  writeContractFixtures(j(dirname(fileURLToPath(import.meta.url)), '..', 'test', 'fixtures', 'contract'));
  console.log('wrote test/fixtures/contract/{run-v1,run-v2}');
}
