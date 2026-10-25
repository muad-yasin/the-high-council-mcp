// T1-14 (13 Oct 2026): `council digest --run <folder> --provider P --model M` was the one paid call made outside invoke(): no cap, no projection, no unpriced-seat refusal, no reservation, no usage record, and every error became the free
// template. Now it goes through runSingleStage under the money rules of `handoff --from-run` (the run's total counts toward --max-usd, `none` lifts it), needs a typed --max-usd and a --model, refuses a tree member's folder and
// lets a refusal (cap, unpriced, denied, key-shaped) through instead of swallowing it. Offline: the mock provider, `mock-priced` carries fixture prices ($36.10 worst case at the 36,000-token seat cap), $0.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateDigestText } from '../src/dissent-digest.js';
import { runSpentUsd } from '../src/spend.js';
import { smallestCapThatPasses, wouldBreach } from '../src/cost.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(root, 'src', 'cli.js');
const ENV = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/API_KEY/i.test(k)));
const REPORT = { outcome: 'no_consensus', disagreement_groups: [{ on: 'p1', title: 'whether to build item 4', posts: [{ by: 'deepseek', stance: 'object', text: 'adds a script' }] }] };
function runDir(extra = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'thc-digest-spend-'));
  writeFileSync(join(dir, 'report.json'), JSON.stringify(REPORT));
  for (const [f, v] of Object.entries(extra)) writeFileSync(join(dir, f), typeof v === 'string' ? v : JSON.stringify(v));
  return dir;
}
const digest = (dir, args, env = ENV) => spawnSync(process.execPath, [cli, 'digest', '--run', dir, ...args], { encoding: 'utf8', env, timeout: 60_000 });
const withDir = (extra, fn) => { const dir = runDir(extra); try { return fn(dir); } finally { rmSync(dir, { recursive: true, force: true }); } };
const PRICED = ['--provider', 'mock', '--model', 'mock-priced'];

test('DS-1 (T5b, old: --provider without --max-usd was refused with exit 2) a digest on a FREE seat (mock) needs no flag any more; a paid seat takes its typed limit instead (test/post-run-cap-gate.test.js)', () => withDir({}, dir => {
  const r = digest(dir, PRICED);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.doesNotMatch(r.stderr, /needs --max-usd/);
  assert.match(readFileSync(join(dir, 'digest.md'), 'utf8'), /MOCK DELIVERABLE for model mock-priced/);
}));

test('DS-2 --provider without --model is refused (exit 2); a model used to go out as undefined', () => withDir({}, dir => {
  const r = digest(dir, ['--provider', 'mock', '--max-usd', '5']);
  assert.equal(r.status, 2, r.stdout + r.stderr);
  assert.equal(r.stderr.trim(), 'digest: --provider needs --model (the model to call). Nothing was sent.');
  assert.equal(existsSync(join(dir, 'digest.md')), false);
}));

test('DS-3 a cap below the call\'s worst case refuses (exit 4), naming what the run cost, the worst case and the smallest figure that passes; nothing is written or reserved', () => withDir({}, dir => {
  const r = digest(dir, [...PRICED, '--max-usd', '1']);
  assert.equal(r.status, 4, r.stdout + r.stderr);
  assert.match(r.stderr, /^digest: stopped by the spend cap: this run's total so far is \$0\.0000, this call could cost up to \$36\.10, and the cap is \$1\.00\. The smallest cap that passes this check is \$36\.10\. Nothing was sent\.$/m);
  assert.equal(existsSync(join(dir, 'digest.md')), false, 'a refusal writes nothing');
  assert.equal(existsSync(join(dir, 'spend-reservations.jsonl')), false); assert.equal(existsSync(join(dir, 'superseded')), false);
  assert.equal(digest(dir, [...PRICED, '--max-usd', '36.10']).status, 0, 'the figure the refusal names as the smallest that passes does pass');
}));

test('DS-4 a paid digest leaves its money on record: a reservation (reserved, settled) and a usage record in the run folder, counted by the run\'s spend', () => withDir({}, dir => {
  const r = digest(dir, [...PRICED, '--max-usd', '40']);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(readFileSync(join(dir, 'digest.md'), 'utf8'), /MOCK DELIVERABLE for model mock-priced/);
  const lines = readFileSync(join(dir, 'spend-reservations.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l));
  assert.deepEqual(lines.map(l => [l.event, l.label ?? null]).filter(x => x[0] === 'reserved'), [['reserved', 'digest']]);
  assert.ok(lines.some(l => l.event === 'settled'));
  const rec = JSON.parse(readFileSync(join(dir, 'superseded', 'digest.call-1.usage.json'), 'utf8'));
  assert.equal(rec.model, 'mock-priced'); assert.ok(rec.usd > 0);
  assert.ok(runSpentUsd(dir) > 0, 'the run\'s own spend sees it');
}));

test('DS-5 --max-usd is the RUN\'s total, as on handoff: a second digest counts what the first one cost', () => withDir({}, dir => {
  assert.equal(digest(dir, [...PRICED, '--max-usd', '40']).status, 0);
  const spent = runSpentUsd(dir);
  assert.ok(spent > 0);
  const r = digest(dir, [...PRICED, '--max-usd', '36.10']);                                    // 36.10 covers one call's worst case ($36.097), not that plus the first call's cost
  assert.equal(r.status, 4, r.stdout + r.stderr);
  assert.match(r.stderr, /this run's total so far is \$0\.0390, this call could cost up to \$36\.10, and the cap is \$36\.10\. The smallest cap that passes this check is \$36\.14\./);
  assert.equal(digest(dir, [...PRICED, '--max-usd', '36.14']).status, 0, 'the figure the refusal names as the smallest that passes does pass');
  assert.equal(digest(dir, [...PRICED, '--max-usd', 'none']).status, 0, '`none` lifts the cap, as on handoff');
}));

test('DS-6 control: without --provider the digest is the free template: no key, no call, no record', () => withDir({}, dir => {
  const r = digest(dir, []);
  assert.equal(r.status, 0, r.stderr);
  assert.match(readFileSync(join(dir, 'digest.md'), 'utf8'), /^The panel disagreed on: whether to build item 4\. Objections raised: deepseek: adds a script\. Final verdict: no_consensus\.$/m);
  assert.equal(existsSync(join(dir, 'superseded')), false); assert.equal(existsSync(join(dir, 'spend-reservations.jsonl')), false);
}));

test('DS-7 generateDigestText lets a control-flow refusal through (cap, unpriced, denied, key-shaped) and keeps the template for a plain failure, telling the caller which', async () => {
  const refusal = Object.assign(new Error('over the cap'), { controlFlow: true });
  await assert.rejects(generateDigestText({ report: REPORT, call: async () => { throw refusal; }, provider: 'mock', model: 'mock-priced' }), e => e === refusal);
  const notes = [];
  const text = await generateDigestText({ report: REPORT, call: async () => { throw new Error('boom'); }, provider: 'mock', model: 'mock-priced', note: n => notes.push(n) });
  assert.match(text, /^The panel disagreed on:/); assert.deepEqual(notes, [{ kind: 'failed', message: 'boom' }]);
  const empty = [];
  await generateDigestText({ report: REPORT, call: async () => ({ text: '  ' }), provider: 'mock', model: 'mock-priced', note: n => empty.push(n) });
  assert.deepEqual(empty, [{ kind: 'empty' }]);
  const secret = [];
  await generateDigestText({ report: { ...REPORT, outcome: `sk-or-v1-${'a1b2c3d4e5'.repeat(4)}` }, call: async () => { throw new Error('must not be called'); }, provider: 'mock', model: 'mock-priced', note: n => secret.push(n) });
  assert.deepEqual(secret, [{ kind: 'secret_shaped' }]);
});

test('DS-8 a call that fails after it was sent writes the template and says a call was made (exit 0)', () => withDir({}, dir => {
  const r = digest(dir, ['--provider', 'mock', '--model', 'mock-provider-error', '--max-usd', 'none']);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stderr, /^digest: a model call was made and failed \(.+\), so the template was written instead\. Any spend is on record in the run folder\.$/m);
  assert.match(readFileSync(join(dir, 'digest.md'), 'utf8'), /^The panel disagreed on:/);
}));

test('DS-9 a tree member\'s folder is refused (exit 2): the call would run outside the member\'s post-run claim and lifetime cap; the free template still works there', () => withDir({ 'run.json': { chain: 'x', tree: { treeId: 'T', node: 'R/M1', generation: 1 } } }, dir => {
  const r = digest(dir, [...PRICED, '--max-usd', '40']);
  assert.equal(r.status, 2, r.stdout + r.stderr);
  assert.match(r.stderr, /is a member of a recursive-councils tree; a paid digest call there would run outside the tree's accounting \(the member's post-run claim and its lifetime cap\)\. Nothing was sent\. Run it without --provider for the free template\./);
  assert.equal(existsSync(join(dir, 'digest.md')), false);
  assert.equal(digest(dir, []).status, 0);
}));

// a CONTROL, no red of its own: the preflight (refuseUnpricedOrExit) and invoke()'s UnpricedSeat backstop both refuse, so removing either alone leaves the exit 5; red-testing it against the old code would make a real network call with a fake key
test('DS-10 control: a seat with no price row under a cap is refused before anything is sent (exit 5), as everywhere', () => withDir({}, dir => {
  const r = digest(dir, ['--provider', 'openrouter', '--model', 'vendor/not-in-the-table', '--max-usd', '5'], { ...ENV, OPENROUTER_API_KEY: 'sk-or-v1-' + 'b'.repeat(40) });
  assert.equal(r.status, 5, r.stdout + r.stderr);
  assert.match(r.stderr, /no price|unpriced|price/i);
  assert.equal(existsSync(join(dir, 'digest.md')), false);
}));

test('DS-11 the figure a cap refusal names as the smallest that passes does pass, and one cent less does not (float noise included)', () => {
  for (const [spent, projected] of [[0, 36.097], [0.039, 36.097], [0.07, 0.01], [0.1 + 0.2, 0.4], [1.005, 2.675], [13, 0.01], [0.29, 0.01]]) {
    const cap = smallestCapThatPasses(spent, projected);
    assert.equal(wouldBreach({ spent, cap, projected }).breach, false, `${spent}+${projected}: ${cap} passes`);
    assert.equal(wouldBreach({ spent, cap: Math.round((cap - 0.01) * 100) / 100, projected }).breach, true, `${spent}+${projected}: one cent less does not`);
  }
});
