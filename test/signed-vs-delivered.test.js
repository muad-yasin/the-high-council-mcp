// 0.8.2 item 4 (plan item 4 = A3 + F1/F7 of the ChatGPT reviews; owner 6 Oct 2026 ~18:55: LABEL only, the panel is NOT re-run on a changed text). Through the real CLI, $0:
// the sha256 of the draft the panel signed, the text delivered, what changed it, HANDOFF.md covered, `passed` untouched, and a degraded run no longer gets a clean handoff.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import Ajv2020 from 'ajv/dist/2020.js';
import { stopState } from '../src/handoff-from-run.js';
import { parseLock, checkLock } from '../src/criteria-lock.js';
import { runChain, setCache } from '../src/chain.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sha = s => createHash('sha256').update(s, 'utf8').digest('hex');
const validate = new Ajv2020({ allErrors: true, strict: false }).compile(JSON.parse(readFileSync(join(root, 'schemas/report-v1.json'), 'utf8')));

const seats = (over = {}) => ({
  criteria: { provider: 'mock', model: 'mock-criteria' }, builder: { provider: 'mock', model: 'mock-builder' }, reviser: { provider: 'mock', model: 'mock-builder' },
  critics: [{ provider: 'mock', model: 'mock-critic-a', lab: 'la' }, { provider: 'mock', model: 'mock-critic-b', lab: 'lb' }], ...over,
});
const config = (extra = {}, seatOver = {}) => ({ name: 'sv', description: 'test', maxRounds: 2, signoff: 'unanimous', handoff: true, estimate: { promptTokens: 100, draftTokens: 100, critiqueTokens: 100 }, seats: seats(seatOver), ...extra });

function go(cfg) {
  const dir = mkdtempSync(join(tmpdir(), 'thc-signed-'));
  mkdirSync(join(dir, 'tasks')); mkdirSync(join(dir, 'chains'));
  writeFileSync(join(dir, 'tasks', 't.md'), 'Plan a small reading list app.\n');
  writeFileSync(join(dir, 'chains', 'sv.json'), JSON.stringify(cfg));
  const r = spawnSync(process.execPath, [join(root, 'src/cli.js'), '--chain', 'sv', '--task', 'tasks/t.md'], { cwd: dir, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: dir }, timeout: 120_000 });
  const runs = join(dir, 'runs'); const id = readdirSync(runs)[0]; const run = join(runs, id);
  const read = f => (existsSync(join(run, f)) ? readFileSync(join(run, f), 'utf8') : null);
  return { dir, r, run, report: JSON.parse(read('report.json')), deliverable: read('deliverable.md'), handoff: read('HANDOFF.md'), board: read('BOARD.md'), clean: () => rmSync(dir, { recursive: true, force: true }) };
}

test('control: a signed run whose text no later stage changed - same_as_signed, hashes equal the files on disk, no banner, no new BOARD.md', () => {
  const w = go(config());
  try {
    assert.equal(w.r.status, 0, w.r.stdout + w.r.stderr);
    const { signed_text: s, delivered_text: d, handoff_text: h } = w.report;
    assert.equal(w.report.passed, true);
    assert.deepEqual([s.signed_off, s.label], [true, undefined]);
    assert.equal(d.same_as_signed, true); assert.deepEqual(d.changed_by, []); assert.deepEqual(d.harness_notes, []);
    assert.equal(d.sha256, sha(w.deliverable), 'delivered_text.sha256 is the sha256 of deliverable.md');
    assert.equal(s.sha256, d.sha256, 'nothing changed it, so the signed text is the delivered text');
    assert.equal(h.file_sha256, sha(w.handoff), 'handoff_text.file_sha256 is the sha256 of HANDOFF.md as written');
    assert.equal(h.made_from_signed, true); assert.equal(h.panel_reviewed, false);
    assert.ok(!w.handoff.startsWith('>'), 'no banner on a clean run');
    assert.equal(validate(w.report), true, JSON.stringify(validate.errors));
  } finally { w.clean(); }
});

test('a final edit after the sign-off is NAMED, not re-reviewed; HANDOFF.md carries the banner above the model text and the lock block stays last; passed is unchanged', () => {
  const plain = go(config());
  const w = go(config({}, { finalist: { provider: 'mock', model: 'mock-finalist' } }));
  try {
    assert.equal(w.r.status, 0, w.r.stdout + w.r.stderr);
    assert.equal(w.report.passed, plain.report.passed, 'a label never moves `passed`');
    assert.equal(w.report.delivered_text.same_as_signed, false);
    assert.deepEqual(w.report.delivered_text.changed_by, ['final_edit']);
    assert.equal(w.report.delivered_text.re_reviewed, false);
    assert.equal(w.report.delivered_text.sha256, sha(w.deliverable));
    assert.notEqual(w.report.signed_text.sha256, w.report.delivered_text.sha256);
    assert.equal(w.report.signed_text.sha256, plain.report.delivered_text.sha256, 'the signed text is the very draft the same chain delivers when no final edit runs (item 4 review: pinned to the reviewed draft, not only to "different")');
    assert.match(w.handoff, /^> \*\*Not the signed text\.\*\* After the panel's last review the final edit changed the plan, and no panel re-read it\. Written by the harness, not a model\./);
    assert.equal(w.report.handoff_text.file_sha256, sha(w.handoff));
    assert.equal(w.report.handoff_text.made_from_signed, false);
    // The lock block is the LAST thing in the file and the real parser and checker still accept the file with the banner above it (item 4 review: the old regex matched any "<!--" anywhere).
    assert.ok(w.handoff.trimEnd().endsWith('-->'), 'the file ends with the lock marker');
    assert.equal(parseLock(w.handoff).found, true);
    assert.equal(checkLock(w.handoff).ok, true, JSON.stringify(checkLock(w.handoff).problems));
    assert.equal(validate(w.report), true, JSON.stringify(validate.errors));
  } finally { plain.clean(); w.clean(); }
});

test('an unsigned run reads "not accepted, N open objections"; the dispute pass that changed the text is named; BOARD.md and HANDOFF.md say so', () => {
  const base = JSON.parse(readFileSync(join(root, 'chains', 'mock-dispute.json'), 'utf8'));
  const w = go({ ...base, name: 'sv', handoff: true });
  try {
    assert.equal(w.report.passed, false);
    assert.equal(w.report.signed_text.signed_off, false);
    assert.equal(w.report.signed_text.label, 'not_accepted');
    assert.ok(w.report.signed_text.open_objections >= 1, JSON.stringify(w.report.signed_text));
    assert.ok(w.report.delivered_text.changed_by.includes('dispute'), JSON.stringify(w.report.delivered_text));
    assert.ok(w.report.delivered_text.harness_notes.includes('dissent_block'));
    assert.match(w.handoff, /^> \*\*Not a signed-off plan\.\*\*/);
    // Item 4 review (6 Oct 2026): the unsigned banner is the 0.8.1 one, unchanged: nothing was signed, so no "Not the signed text" line is added to it (the BOARD and report.json carry the change).
    assert.doesNotMatch(w.handoff, /Not the signed text/);
    assert.match(w.handoff.split('\n').slice(0, 3).join('\n'), /> The run .*The panel did not sign off on the plan below/);
    assert.equal(w.board, null, 'a chain with no debate has no BOARD.md, and the label does not create one');
    assert.equal(validate(w.report), true, JSON.stringify(validate.errors));
  } finally { w.clean(); }
});

test('BOARD.md of a debate chain carries the signed/delivered section when the plan is not accepted', () => {
  const base = JSON.parse(readFileSync(join(root, 'chains', 'mock-debate.json'), 'utf8'));
  const w = go({ ...base, name: 'sv', maxRounds: 3, dispute: { enabled: true, stall_rounds: 2 }, seats: { ...base.seats, critics: [{ provider: 'mock', model: 'mock-critic-holdout', lab: 'hold' }] } });
  try {
    assert.equal(w.report.passed, false);
    assert.ok(w.board, 'a debate chain has a BOARD.md');
    assert.match(w.board, /## Signed text and delivered text\n\n\*\*Not accepted:\*\* the panel did not sign off \(\d+ open objections? when it stopped/);
  } finally { w.clean(); }
});

test('a degraded run (one verdict, the other seat stated a pass) reads passed:true, outcome degraded: it NO LONGER gets a clean handoff, and stopState says so (F7)', () => {
  const w = go(config({ freedoms: { pass: true } }, { critics: [{ provider: 'mock', model: 'mock-critic-cut-signoff-then-fits', lab: 'la' }, { provider: 'mock', model: 'mock-critic-passer', lab: 'lb' }] }));
  try {
    assert.equal(w.report.passed, true, 'unchanged: the report contract keeps passed as it was');
    assert.equal(w.report.outcome, 'degraded');
    assert.match(w.handoff, /^> \*\*Not a clean sign-off\.\*\*/);
    assert.doesNotMatch(w.handoff.split('\n').slice(0, 4).join('\n'), /did not sign off on the plan below/);
    const st = stopState(w.run);
    assert.equal(st.signedOff, false); assert.equal(st.degraded, true);
  } finally { w.clean(); }
});

test('a cold-reader block above an unchanged body is a NOTE, not a change: same_as_signed stays true, the file hash differs from the body hash, and the handoff gets no changed-text banner', () => {
  const w = go(config({ coldRead: { enabled: true } }, { coldRead: { provider: 'mock', model: 'mock-cold-read-yes', lab: 'cold' } }));
  try {
    assert.equal(w.report.delivered_text.same_as_signed, true);
    assert.deepEqual(w.report.delivered_text.harness_notes, ['cold_read_block']);
    assert.notEqual(w.report.delivered_text.sha256, w.report.delivered_text.body_sha256);
    assert.equal(w.report.delivered_text.sha256, sha(w.deliverable));
    assert.match(w.deliverable, /^## Cold-reader findings/);
    assert.ok(!/Not the signed text/.test(w.handoff));
  } finally { w.clean(); }
});

test('open_objections is the number the dissent block lists: a round nobody was heard in does not erase the objections of the round before (item 4 review)', async () => {
  const cfg = JSON.parse(readFileSync(join(root, 'chains', 'mock-dispute.json'), 'utf8'));
  cfg.seats.critics = [{ provider: 'mock', model: 'mock-network-error', lab: 'mock-x' }];
  const round1 = { text: JSON.stringify({ meets: false, criteria: [], failures: [{ criterion: 'C1: it names its assumptions', problem: 'No assumptions section.', fix: 'Add one.' }] }), usage: { input: 1, output: 1 }, usd: 0 };
  setCache({ get: l => (l === 'panel-1-mock-x' ? round1 : null) });
  let r;
  try { r = await runChain({ request: 'Write a short plan.', config: cfg, log: () => {} }); } finally { setCache(null); }
  assert.equal(r.passed, false);
  assert.equal(r.dispute.open_objections.length, 1, 'control: the dispute block lists the one carried objection');
  assert.equal(r.signedText.open_objections, 1, 'the label says the same number as the dissent block (it read 0 before the fix: the empty last round overwrote the list)');
});

test('first mode: the labels exist, the signed text is the delivered text, and a final edit is named there too', () => {
  const w = go(config({ signoff: 'first' }));
  const e = go(config({ signoff: 'first' }, { finalist: { provider: 'mock', model: 'mock-finalist' } }));
  try {
    assert.equal(w.r.status, 0, w.r.stdout + w.r.stderr);
    assert.equal(w.report.delivered_text.same_as_signed, true);
    assert.equal(w.report.signed_text.sha256, sha(w.deliverable));
    assert.deepEqual(e.report.delivered_text.changed_by, ['final_edit']);
    assert.equal(e.report.passed, w.report.passed);
    assert.equal(validate(e.report), true, JSON.stringify(validate.errors));
  } finally { w.clean(); e.clean(); }
});

test('an unsigned run: signed_text.sha256 is the hash of the last draft the panel looked at, and a damaged report (same_as_signed:false, no changed_by) is read without throwing', () => {
  const base = JSON.parse(readFileSync(join(root, 'chains', 'mock-debate.json'), 'utf8'));
  const w = go({ ...base, name: 'sv', maxRounds: 2, seats: { ...base.seats, critics: [{ provider: 'mock', model: 'mock-critic-holdout', lab: 'hold' }] } });
  try {
    assert.equal(w.report.passed, false);
    assert.equal(w.report.delivered_text.same_as_signed, true, 'no dispute: nothing changed the draft after the review');
    assert.equal(w.report.signed_text.sha256, w.report.delivered_text.body_sha256);
    const damaged = JSON.parse(JSON.stringify(w.report)); damaged.delivered_text = { same_as_signed: false };
    writeFileSync(join(w.run, 'report.json'), JSON.stringify(damaged));
    assert.doesNotThrow(() => stopState(w.run));
  } finally { w.clean(); }
});
