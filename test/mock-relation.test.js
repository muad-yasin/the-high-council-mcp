// 0.8.4 S2 (W6, D18): once the relation wording (`relationRule`) is recorded, a failure a judge writes without a `relation` is an unreadable reply (src/chain.js, the `held('relationRule')` gate). The mock critics return fixed
// JSON without one, so the mock provider adds `relation: "new"` to a critic's failures when the prompt carries the relation sentence (src/providers.js echoRelation, the pattern of echoEnvelopeIds). This file drives REAL
// mock chains through the CLI (no hand-written records):
//   MR-1 every shipped unanimous mock chain that can finish offline (no external seat, no questions stage, not the cap test chain) writes no relation refusal and hears its reviewers; the three plain ones pass.
//   MR-3 a mock judge that repeats its own standing objection in a chain with answer_back CONTINUES it: the stall rule sees the repeat (exit 23) and no suffixed id (`#2`, `#r2`) is minted (the baseline, before the relation wording, minted none).
//   MR-3b the same check UNSCOPED over the 14 shipped unanimous mock chains (answer_back off, no relation asked).
//   MR-2 the ONE mock that keeps omitting the relation (a model name with `-norelation`) is still refused: the refusal path stays exercised offline.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(root, 'src', 'cli.js');

function drive(chain, chainFile) {
  const work = mkdtempSync(join(tmpdir(), 'mock-relation-'));
  writeFileSync(join(work, 'task.md'), 'Write a one-paragraph plan for a bake sale.\n');
  if (chainFile) { mkdirSync(join(work, 'chains')); writeFileSync(join(work, 'chains', `${chain}.json`), JSON.stringify(chainFile)); }
  const r = spawnSync(process.execPath, [cli, '--task', 'task.md', '--chain', chain], { cwd: work, encoding: 'utf8', input: '', timeout: 120_000 });   // closed stdin and a ceiling: a chain that waits (a questions or external stage) can never hold the suite
  let report = null; let log = '';
  try {
    const runs = join(work, 'runs');
    const runDir = join(runs, readdirSync(runs).sort().pop());
    try { report = JSON.parse(readFileSync(join(runDir, 'report.json'), 'utf8')); } catch { /* a run that stopped before a report */ }
    try { log = readFileSync(join(runDir, 'run.log'), 'utf8'); } catch { /* none */ }
  } catch { /* no run folder: the text of the process is all there is */ }
  return { status: r.status, report, text: `${r.stdout}\n${r.stderr}\n${log}` };
}

const shippedMock = readdirSync(join(root, 'chains')).filter(f => /^mock.*\.json$/.test(f)).map(f => ({ name: f.slice(0, -5), config: JSON.parse(readFileSync(join(root, 'chains', f), 'utf8')) }));
const seatsOf = c => Object.values(c.seats || {}).flatMap(s => (Array.isArray(s) ? s : [s])).filter(s => s && typeof s === 'object');
const offlineUnanimous = shippedMock.filter(({ name, config }) => config.signoff === 'unanimous' && name !== 'mock-budget' && !config.questions && !seatsOf(config).some(s => s.provider === 'external'));

test('MR-1 the shipped set is what the row reads: at least the three plain unanimous mock chains are in it', () => {
  const names = offlineUnanimous.map(c => c.name);
  for (const n of ['mock-open', 'mock-debate', 'mock-unanimous']) assert.ok(names.includes(n), `${n} is a shipped unanimous mock chain that can finish offline: ${names.join(', ')}`);
});

for (const { name } of offlineUnanimous) {
  test(`MR-1 ${name}: a real offline run hears its reviewers and writes no relation refusal`, () => {
    const r = drive(name);
    assert.doesNotMatch(r.text, /relation_missing|relation field cannot be used/, `${name}: a mock critic's failure without a relation was refused`);
    assert.doesNotMatch(r.text, /no reviewer was heard/, `${name}: no reviewer was heard`);
    if (['mock-open', 'mock-debate', 'mock-unanimous'].includes(name)) assert.equal(r.report?.passed, true, `${name}: the offline run passes (exit ${r.status})`);
  });
}

// A judge is shown its own ids only in the answer-back section (chain.js, `answer_back.enabled`), so MR-3 drives a chain that has it. No shipped mock chain does: a mock judge of such a chain cannot name an id (the open ruling).
// The chain is the one of test/stall-stop.test.js TS-9a (layers 1 and 2 sign off, layer 3's `-keep-always` judge objects to every draft): its repeated objection must keep ONE id, so the stall rule sees the repeat and stops the run (exit 23).
const SUFFIXED = /\bO-[0-9a-f]{8}#r?[0-9]+/;
test('MR-3 a mock judge that repeats its own objection in a chain with answer_back CONTINUES it: the stall rule sees the repeat (exit 23) and the run mints no suffixed id (#2 / #r2)', () => {
  const seat = (model, lab, layer) => ({ provider: 'mock', model, lab, layer });
  const chain = {
    name: 'mr3', maxRounds: 6, signoff: 'unanimous', answer_back: { enabled: true }, dispute: { enabled: true, stall_rounds: 2 }, estimate: { promptTokens: 500, draftTokens: 500, critiqueTokens: 200 },
    seats: { criteria: { provider: 'mock', model: 'mock-criteria' }, builder: { provider: 'mock', model: 'mock-builder', lab: 'author' }, reviser: { provider: 'mock', model: 'mock-builder', lab: 'author' },
      critics: [seat('mock-exch-support-keep-clean', 'mr31', 1), seat('mock-exch-support-keep-clean', 'mr32', 2), seat('mock-exch-support-keep-always', 'mr33', 3)] },
  };
  const r = drive('mr3', chain);
  const body = `${JSON.stringify(r.report ?? {})}\n${r.text}`;   // the report and the run's own log lines
  assert.doesNotMatch(body, SUFFIXED, 'a repeated objection was read as a new one (a suffixed id was minted)');
  assert.equal(r.status, 23, `the repeated objection stalls the run (exit 23): ${r.text.slice(-400)}`);
});

// MR-3b (C&C GO answer back off): the no-#2 check UNSCOPED over every shipped unanimous mock chain, all of which have answer_back off. A judge there is not asked for a relation, a repeated objection keeps its id the 0.8.3 way, and no report or log of any of them carries a suffixed objection id (the baseline 449cb4a3 had none).
const allUnanimousMock = shippedMock.filter(({ config }) => config.signoff === 'unanimous');
test('MR-3b the shipped unanimous mock chains (answer_back off): none writes a suffixed objection id into its report or log, and the mock writes no relation where the prompt asks for none', () => {
  assert.equal(allUnanimousMock.length, 14, `the 14 shipped unanimous mock chains: ${allUnanimousMock.map(c => c.name).join(', ')}`);
  let withIds = 0;
  for (const { name, config } of allUnanimousMock) {
    assert.ok(!config.answer_back?.enabled, `${name}: answer_back is off`);
    const r = drive(name);
    assert.notEqual(r.status, null, `${name}: the run ended on its own (no timeout)`);
    const body = `${JSON.stringify(r.report ?? {})}\n${r.text}`;
    assert.doesNotMatch(body, SUFFIXED, `${name}: a suffixed objection id (a repeated objection read as a new one)`);
    assert.doesNotMatch(body, /relation_missing|relation field cannot be used|continues_not_standing/, `${name}: a relation was asked for or refused`);
    if (/\bO-[0-9a-f]{8}\b/.test(body)) withIds += 1;
  }
  assert.ok(withIds >= 1, 'precondition: at least one of the chains puts objection ids on the record, so this check can fail');
});

test('MR-2 the one mock that omits the relation is still refused: the refusal path stays exercised offline', () => {
  const chain = {
    name: 'mr2', maxRounds: 3, signoff: 'unanimous', answer_back: { enabled: true }, estimate: { promptTokens: 500, draftTokens: 500, critiqueTokens: 200 },
    seats: { criteria: { provider: 'mock', model: 'mock-criteria' }, builder: { provider: 'mock', model: 'mock-builder', lab: 'author' }, reviser: { provider: 'mock', model: 'mock-builder', lab: 'author' },
      critics: [{ provider: 'mock', model: 'mock-critic-norelation', lab: 'la' }, { provider: 'mock', model: 'mock-critic-norelation-2', lab: 'lb' }] },
  };
  const r = drive('mr2', chain);
  assert.match(r.text, /relation field cannot be used \(relation_missing\)/, 'the refusal sentence is written');
  assert.notEqual(r.report?.passed, true, 'a run whose critics never write a relation does not pass');
});
