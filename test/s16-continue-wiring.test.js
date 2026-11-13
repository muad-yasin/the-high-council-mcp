// 0.8.4 S16 (D part b; C&C's item on beeb77dd and its correction of 09 Nov): the wiring of c_u in the MCP tool `stop_decide`, driven over a real stdio session on stops THE CHAIN MAKES. The chain is a mock layered chain with a layer-2 seat that is `mock-unreadable`
// (the shape of test/overseer-wiring.test.js W3): after the allowed silent passes the run stops at exit 23 (layer_bound, reason `unheard`), and each continue lets it run on to the next such stop. Offline, $0.
// (a) the handling session's THIRD continue at a stop for a seat with no usable reply is refused and records nothing; the first two are answered through the tool and the real CLI resumes the run each time.
// (b) the person's continue (a typed terminal choice, actor `unknown`) is counted in n_u only, never against c_u: after it the quote of the next stop says 0 of 2.
// No record is written by hand: every stop, entry and ledger line is the run's own.
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LEDGER_FILE } from '../src/gate-ledger.js';
import { cli, untilRunIdle } from './helpers/round-stop-project.js';
import { session } from './helpers/mcp-stdio-session.js';
import { thirdContinueRefusal } from '../src/stop-decision.js';

const projects = [];
afterEach(() => { while (projects.length) projects.pop().done(); });

const judge = (pattern, id, lab, layer) => ({ provider: 'mock', model: `mock-critic-script-${pattern}-${id}`, lab, layer });
function silentSeatProject(tag) {
  const dir = mkdtempSync(join(tmpdir(), 'c-u-wiring-'));
  mkdirSync(join(dir, 'chains')); mkdirSync(join(dir, 'tasks'));
  const critics = [judge('o', `${tag}a`, 'l1', 1), judge('o', `${tag}b`, 'l2', 2), { provider: 'mock', model: 'mock-unreadable', lab: 'l2b', layer: 2 }, judge('o', `${tag}c`, 'l3', 3)];
  writeFileSync(join(dir, 'chains', 'cu.json'), JSON.stringify({
    name: 'cu', signoff: 'unanimous', maxOverseerRounds: 5, layerRevisions: { 1: 2, 2: 1 }, estimate: { promptTokens: 500, draftTokens: 500, critiqueTokens: 200 },
    seats: { criteria: { provider: 'mock', model: 'mock-criteria' }, builder: { provider: 'mock', model: 'mock-builder', lab: 'author' }, reviser: { provider: 'mock', model: 'mock-builder', lab: 'author' }, critics },
  }));
  writeFileSync(join(dir, 'tasks', 't.md'), '# A plan\n');
  const run = args => spawnSync(process.execPath, [cli, ...args], { cwd: dir, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: dir } });
  const first = run(['--chain', 'cu', '--task', 'tasks/t.md']);
  assert.equal(first.status, 23, `premise: the chain stops at exit 23 for its silent seat: ${first.stdout}${first.stderr}`);
  const id = readdirSync(join(dir, 'runs'))[0];
  const runDir = join(dir, 'runs', id);
  const p = { dir, runDir, id, run, runJson: () => JSON.parse(readFileSync(join(runDir, 'run.json'), 'utf8')), partialStop: () => JSON.parse(readFileSync(join(runDir, 'report-partial.json'), 'utf8')).stop, done: () => rmSync(dir, { recursive: true, force: true }) };
  projects.push(p);
  return p;
}

const V = (person, unsettled, preference, reason = 'The record settles it.') => ({ person, unsettled_by_record: unsettled, preference, reason });
const PT_NO = { session: V('no', false, false), advisor: V('no', false, false, 'Agreed: a fact.') };
const ANSWER = { choice: 'continue', reason: 'One more pass for the silent seat is justified.', advisor: 'consulted', advisor_said: 'Agreed.', person_test: PT_NO };
const call = (p, args) => session(p.dir, [{ name: 'stop_decide', arguments: { run: p.id, ...args } }]).then(a => a[0]);
const snapshot = p => JSON.stringify([readdirSync(p.runDir).sort(), readFileSync(join(p.runDir, 'run.json'), 'utf8'), existsSync(join(p.runDir, LEDGER_FILE)) ? readFileSync(join(p.runDir, LEDGER_FILE), 'utf8').length : 0]);

async function sessionContinues(p, n) {
  for (let i = 0; i < n; i++) {
    const q = await call(p, { step: 'quote' });
    assert.equal(q.error, undefined, JSON.stringify(q).slice(0, 400));
    assert.match(q.text, new RegExp(`\\nContinues you have made at stops where a seat gave no usable reply: ${i} of 2\\.\\n`));
    const r = await call(p, { step: 'answer', gate: q.gate, shown: q.shown, ...ANSWER });
    assert.equal(r.error, undefined, JSON.stringify(r).slice(0, 400));
    assert.equal(r.resumed, true, JSON.stringify(r).slice(0, 400));
    await untilRunIdle(p.runDir);
    assert.deepEqual([p.partialStop().kind, p.partialStop().why], ['layer_bound', 'unheard'], `premise: the run stopped again after continue ${i + 1}`);
  }
}

test('(a) the handling session\'s THIRD continue at a stop for a seat with no usable reply is refused with the count sentence and records nothing; the quote says 2 of 2 and offers finish only', async () => {
  const p = silentSeatProject('wa');
  await sessionContinues(p, 2);
  assert.deepEqual(p.runJson().roundChoices.map(c => [c.choice, c.why, c.actor]), [['continue', 'unheard', 'handling_session'], ['continue', 'unheard', 'handling_session']]);
  const q = await call(p, { step: 'quote' });
  assert.equal(q.error, undefined, JSON.stringify(q).slice(0, 400));
  assert.match(q.text, /\nChoices: finish\.\n/);
  assert.match(q.text, /\nContinues you have made at stops where a seat gave no usable reply: 2 of 2\.\n/);
  assert.match(q.text, /That is as many as the handling session may decide on its own\. A further continue is the person's decision/);
  const before = snapshot(p);
  const r = await call(p, { step: 'answer', gate: q.gate, shown: q.shown, ...ANSWER });
  assert.equal(r.error, thirdContinueRefusal(true), JSON.stringify(r).slice(0, 400));
  assert.equal(snapshot(p), before, 'a refusal changes nothing: no ledger line, no entry, no CLI');
});

test('(b) the person\'s continue (a typed terminal choice: actor unknown, channel cli) is counted in n_u only, never against c_u: the session still has both of its continues and is offered continue', async () => {
  const p = silentSeatProject('wb');
  const typed = p.run(['--resume', p.runDir, '--continue']);
  assert.equal(typed.status, 23, `premise: the typed continue runs on to the next stop: ${typed.stdout}${typed.stderr}`);
  const entry = p.runJson().roundChoices[0];
  assert.deepEqual([entry.choice, entry.why, entry.actor, entry.channel], ['continue', 'unheard', 'unknown', 'cli']);
  const q = await call(p, { step: 'quote' });
  assert.equal(q.error, undefined, JSON.stringify(q).slice(0, 400));
  assert.match(q.text, /\nChoices: continue \| finish\.\n/);
  assert.match(q.text, /\nContinues you have made at stops where a seat gave no usable reply: 0 of 2\.\n/);
  assert.doesNotMatch(q.text, /That is as many as the handling session may decide on its own/);
});

// ---- 0.8.4 S16 fix round, rows T4g and T4i: the stop of T4d driven whole-run (stdio tool + real CLI): a LAYER-1 judge that is heard and objects (mock-exch-support-keep) beside a second LAYER-1 seat that never answers (mock-unreadable). The exchange needs two heard judges, so the objection is flagged not_debated and the run stops at exit 23 (layer_bound / unheard, layer 1). The price half of T4g (n_u) is S11's.
function loneHeardProject(tag, heardModel) {
  const dir = mkdtempSync(join(tmpdir(), 'c-u-lone-'));
  mkdirSync(join(dir, 'chains')); mkdirSync(join(dir, 'tasks'));
  const critics = [{ provider: 'mock', model: heardModel, lab: 'l1', layer: 1 }, { provider: 'mock', model: 'mock-unreadable', lab: 'l1b', layer: 1 }, judge('o', `${tag}b`, 'l2', 2), judge('o', `${tag}c`, 'l3', 3)];
  writeFileSync(join(dir, 'chains', 'lo.json'), JSON.stringify({
    name: 'lo', signoff: 'unanimous', maxOverseerRounds: 5, layerRevisions: { 1: 3, 2: 1 }, estimate: { promptTokens: 500, draftTokens: 500, critiqueTokens: 200 },
    seats: { criteria: { provider: 'mock', model: 'mock-criteria' }, builder: { provider: 'mock', model: 'mock-builder', lab: 'author' }, reviser: { provider: 'mock', model: 'mock-builder', lab: 'author' }, critics },
  }));
  writeFileSync(join(dir, 'tasks', 't.md'), '# A plan\n');
  const run = args => spawnSync(process.execPath, [cli, ...args], { cwd: dir, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: dir } });
  const first = run(['--chain', 'lo', '--task', 'tasks/t.md']);
  assert.equal(first.status, 23, `premise: the chain stops at exit 23 for its silent layer-1 seat: ${first.stdout}${first.stderr}`);
  const id = readdirSync(join(dir, 'runs'))[0];
  const runDir = join(dir, 'runs', id);
  const p = { dir, runDir, id, run, runJson: () => JSON.parse(readFileSync(join(runDir, 'run.json'), 'utf8')), partialStop: () => JSON.parse(readFileSync(join(runDir, 'report-partial.json'), 'utf8')).stop, done: () => rmSync(dir, { recursive: true, force: true }) };
  projects.push(p);
  return p;
}
const loneEntries = p => (p.runJson().roundChoices ?? []).map(c => [c?.choice, c?.why, c?.actor]);
const loneStop = p => { const s = p.partialStop(); return [s?.kind, s?.why, s?.layer, s?.passes, s?.reasks]; };
test('T4g: the stop of T4d (a heard layer-1 judge objecting, a second layer-1 seat still silent after each continue): the session chooses continue at each of the first two stops, two passes each, counted c_u 2; no continue runs by itself; the count stop offers finish only', async () => {
  const p = loneHeardProject('wg', 'mock-exch-support-keep');
  const made = 2;
  const q0 = await call(p, { step: 'quote' });
  assert.match(q0?.text ?? '', /\nChoices: continue\.\n/, `the corner: finish is the person's before the count: ${JSON.stringify(q0).slice(0, 400)}`);
  assert.match(q0?.text ?? '', /\nOpen objections a finish would hand over \(read from the last critique/, JSON.stringify(q0).slice(0, 400));
  // The lone-heard pass (one heard judge objecting, its peer silent) keeps the two re-ask passes it had before the ladder unit (the owner's "silent judge being asked twice", 10 Nov 2026), so the bars are the old ones: [.., 1, 3, 2]. (An earlier round had moved them to [1, 1, 0], the figure of an ordinary silent judge after its solo ask; moved back.)
  assert.deepEqual(loneStop(p), ['layer_bound', 'unheard', 1, 3, 2], 'the T4d stop: three passes, two re-ask passes before the stop')
  assert.deepEqual(loneEntries(p), [], 'no continue ran by itself, and a quote decided nothing');
  await sessionContinues(p, made);
  assert.deepEqual(loneEntries(p), [['continue', 'unheard', 'handling_session'], ['continue', 'unheard', 'handling_session']], 'the session\'s two continues are recorded, each by the handling session');
  // Back to the old bar (see above): 3 + 2 + 2 passes, 2 + 2 + 2 re-asks.
  assert.deepEqual(loneStop(p), ['layer_bound', 'unheard', 1, 7, 6], 'two passes per continue: 3 + 2 + 2 passes, 2 + 2 + 2 re-asks (overseer-rounds.js advance, defaultAdd)');
  const q = await call(p, { step: 'quote' });
  assert.equal(q?.error, undefined, JSON.stringify(q).slice(0, 400));
  assert.match(q?.text ?? '', /\nContinues you have made at stops where a seat gave no usable reply: 2 of 2\.\n/);
  assert.match(q?.text ?? '', /\nChoices: finish\.\n/);
  assert.ok(!existsSync(join(p.runDir, 'report.json')), 'the run has not ended and nothing continued it by itself');
  assert.deepEqual(loneStop(p), ['layer_bound', 'unheard', 1, 7, 6], 'the quote ran nothing');
});
test('T4i: at the count (two continues spent) with the heard judge\'s objection not_debated, the session\'s finish needs no E3(a) finding and is offered and accepted; the run ends not agreed and the layer-1 objection is flagged not_debated in the record; no continue is offered', async () => {
  const p = loneHeardProject('wi', 'mock-exch-support-keep');
  const spent = 2;
  const q0 = await call(p, { step: 'quote' });
  assert.match(q0?.text ?? '', /\nChoices: continue\.\n/, `the corner before the count: ${JSON.stringify(q0).slice(0, 400)}`);
  await sessionContinues(p, spent);
  const q = await call(p, { step: 'quote' });
  assert.equal(q?.error, undefined, JSON.stringify(q).slice(0, 400));
  assert.match(q?.text ?? '', /\nChoices: finish\.\n/, 'at the count a choice IS offered, and it is finish only');
  assert.doesNotMatch(q?.text ?? '', /\nChoices:[^\n]*continue/);
  const r = await call(p, { step: 'answer', gate: q.gate, shown: q.shown, ...ANSWER, choice: 'finish', reason: 'Two continues did not bring the silent seat back; ending here is the session\'s choice, and the objection stays on the record as not debated.' });
  assert.equal(r?.error, undefined, JSON.stringify(r).slice(0, 400));
  assert.deepEqual([r?.recorded?.choice, r?.recorded?.actor, r?.resumed], ['finish', 'handling_session', true], JSON.stringify(r).slice(0, 400));
  await untilRunIdle(p.runDir);
  assert.ok(existsSync(join(p.runDir, 'report.json')), 'the finish ended the run');
  const rep = JSON.parse(readFileSync(join(p.runDir, 'report.json'), 'utf8'));
  assert.equal(rep?.passed, false, 'not agreed');
  assert.deepEqual([rep?.stop?.kind, rep?.stop?.why, rep?.stop?.layer, rep?.stop?.chosen], ['layer_bound', 'unheard', 1, 'finish']);
  const rows = rep?.layer_debates ?? [];
  assert.ok(rows.length >= 1, 'the exchange could not run, and its rows are in the record');
  assert.deepEqual([...new Set(rows.map(d => d?.not_run))], ['fewer_than_two_heard']);
  assert.deepEqual([...new Set(rows.flatMap(d => (d?.objections ?? []).map(o => [o?.raised_by, o?.outcome, o?.posts?.length].join(':'))))], ['l1:not_debated:0'], 'the heard judge\'s objection is flagged not_debated, with no post, in every pass');
  assert.deepEqual(loneEntries(p), [['continue', 'unheard', 'handling_session'], ['continue', 'unheard', 'handling_session'], ['finish', 'unheard', 'handling_session']]);
});
