// 0.8.4 D9/D38 (plan A T5.1, T5.3): the excerpt block in a run's prompts. runChain takes the run's excerpts as an argument (src/chain.js does no file I/O; the CLI reads excerpts.jsonl); an entry is shown in
// every prompt from the stage AFTER the one its `answered_stage` names, as ONE cumulative block, and only once the block's words are recorded (held name `excerptsBlock`). Proved here through the real run on a
// mock chain, with the prompt spy: (1) a live run with and without the excerpt (the resume proof is the spawned-CLI test of the D38 commit): every prompt up to and including `first_stage` is byte-identical to the run without the excerpt, the later ones differ by exactly the block; (2) two entries at two
// stages give ONE block that grows (the heading once); (3) the held words unrecorded: nothing changes; (4) the excerpt text is not fenced source (a source scan: fencedSource is a const set once). The mock provider ignores prompt text, so no model answer is
// implied. Offline, $0. The block's words are test data (test/held-prompts/held-084-a.js), hidden by an override that survives the release apply.
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runChain, setPromptSpy, setCache, setBudget } from '../src/chain.js';
import { setHeldForTest } from '../src/held-roles.js';
import { buildExcerptEntry, excerptBlockFor } from '../src/excerpt-record.js';
import { excerptsBlock } from './held-prompts/held-084-a.js';
import { readChainFile } from './helpers/chain-file.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
afterEach(() => { setPromptSpy(null); setCache(null); setBudget(null); setHeldForTest(null); });
const WORDS = { excerptsBlock };
const HELD = { excerptsBlock: undefined };   // hides the name whether or not src/roles.js records it
const AT = '2026-11-09T05:00:00.000Z';
const entry = (n, answered_stage, over = {}) => buildExcerptEntry(n, {
  request_kind: 'session_read', requested_by: null, objection_id: null, why: 'To write the answer.', source_kind: 'repository_file', path: `src/f${n}.js`, lines: '1-2', text: `EXCERPT-${n}-line one\nEXCERPT-${n}-line two`,
  file_sha256: null, edited: false, pasted_by: null, advisor: null, advisor_said: null, answered_stage, scans: { key_shape: 'clear', personal_data: 'not_scanned' },
  approval: { status: 'not_required', actor: null, channel: null, at: AT, reason: null }, ...over,
});

const request = 'Plan a tea service.';
const config = () => ({ ...readChainFile(root, 'mock-unanimous') });
async function prompts(excerpts) {
  const seen = [];
  setPromptSpy(({ label, user }) => { seen.push({ label, user }); });
  await runChain({ request, config: config(), log: () => {}, runId: 'r-excerpt-block', ...(excerpts ? { excerpts } : {}) });
  setPromptSpy(null);
  return seen;
}
const times = (s, sub) => String(s).split(sub).length - 1;

test('premise: two runs of the chain without an excerpt send the same prompts in the same order (else the rows below compare noise), and there are stages on both sides of a middle one', async () => {
  setHeldForTest(WORDS);
  const a = await prompts(null); const b = await prompts(null);
  assert.deepEqual(a, b);
  assert.ok(a.length >= 5, `the chain asked ${a.length} times`);
});

test('LIVE RUN with and without the excerpt: prompts up to and including the answered stage are byte-identical; every later prompt differs from the run without the excerpt by exactly the block; at least one later prompt carries it', async () => {
  setHeldForTest(WORDS);
  const base = await prompts(null);
  const k = Math.floor(base.length / 2);
  const at = base[k].label;
  const first = base.findIndex(s => s.label === at);
  const entryStage = at;   // the answered stage the entry names; the rows below expect the block only after `at`
  const e = entry(1, entryStage);
  const block = excerptBlockFor([e]);
  assert.ok(block.includes('EXCERPT-1-line one'), 'the block carries the recorded text');
  const run = await prompts([e]);
  assert.equal(run.length, base.length, 'the same stages ran');
  let carrying = 0;
  run.forEach((s, i) => {
    assert.equal(s.label, base[i].label, `stage ${i}`);
    if (i <= first) assert.equal(s.user, base[i].user, `${s.label} (stage ${i}, up to and including ${at}) is byte-identical`);
    else {
      assert.equal(s.user.replace(`\n\n${block}`, ''), base[i].user, `${s.label} differs from the run without the excerpt by exactly the block`);
      if (s.user.includes(block)) { carrying++; assert.equal(times(s.user, block), 1, `${s.label} carries the block once`); }
    }
  });
  assert.ok(carrying > 0, 'a later prompt carries the block (else this passes vacuously)');
});

test('placement (option I): in a judge\'s prompt the block sits below the draft and directly after the prompt\'s head; in a prompt with no head it is the true end of the text', async () => {
  setHeldForTest(WORDS);
  const base = await prompts(null);
  const at = base[1].label;
  const e = entry(1, at); const block = excerptBlockFor([e]);
  const run = await prompts([e]);
  const panel = run.filter(s => /^panel-/.test(s.label) && s.user.includes(block));
  assert.ok(panel.length > 0, 'a judge\'s prompt carries the block (else the next lines prove nothing)');
  for (const s of panel) {
    assert.ok(s.user.indexOf('# Draft under review') < s.user.indexOf(block), `${s.label}: below the draft`);
    assert.ok(s.user.indexOf('# Acceptance criteria') < s.user.indexOf(block), `${s.label}: after the request and the criteria`);
  }
  for (const s of run.filter(x => /^(revise|build|skeleton|debate)-?/.test(x.label) && x.user.includes(block))) assert.ok(s.user.endsWith(block), `${s.label}: the true end of the text`);
});

test('two entries at two stages: ONE cumulative block that grows; the heading appears once; the later prompts carry both', async () => {
  setHeldForTest(WORDS);
  const base = await prompts(null);
  const l1 = base[1].label; const l2 = base[Math.floor((base.length * 2) / 3)].label;
  assert.notEqual(l1, l2);
  const e1 = entry(1, l1); const e2 = entry(2, l2);
  const heading = excerptBlockFor([e1]).split('\n')[0];
  const group = label => (/^(panel-\d+)-/.exec(label) || [])[1] ?? label;   // the seats of one panel round are asked together
  const run = await prompts([e1, e2]);
  const i1 = base.findIndex(s => s.label === l1); const i2 = base.findIndex(s => s.label === l2);
  run.forEach((s, i) => {
    const has1 = s.user.includes('EXCERPT-1-line one'); const has2 = s.user.includes('EXCERPT-2-line one');
    if (i <= i1) { assert.equal(has1 || has2, false, `${s.label}: before the first entry`); }
    else if (i <= i2) { assert.equal(has2, false, `${s.label}: before the second entry`); if (has1) assert.equal(s.user.replace(`\n\n${excerptBlockFor([e1])}`, ''), base[i].user, s.label); }
    else if (group(s.label) === group(l2)) { assert.equal(has2, false, `${s.label}: a call made at the same time as the stage that carried the second entry cannot show it`); assert.equal(has1, true, `${s.label}: and shows the first`); }   // the seats of one panel round start together: they read the block before any of them answers
    else if (has1 || has2) { assert.equal(has1 && has2, true, `${s.label}: both entries together`); assert.equal(times(s.user, heading), 1, `${s.label}: the heading once`); assert.equal(s.user.replace(`\n\n${excerptBlockFor([e1, e2])}`, ''), base[i].user, s.label); }
  });
  assert.ok(run.some((s, i) => i > i2 && s.user.includes('EXCERPT-2-line one')), 'a prompt after the second entry carries it');
});

test('the held words unrecorded: nothing changes, whatever the entries say (the whole channel is gated on the words)', async () => {
  setHeldForTest(WORDS);
  const base = await prompts(null);
  setHeldForTest(HELD);
  const run = await prompts([entry(1, base[1].label), entry(2, base[2].label)]);
  assert.deepEqual(run, base);
});

test('an entry that is not shown (a refused or unanswered request has no text) adds nothing', async () => {
  setHeldForTest(WORDS);
  const base = await prompts(null);
  const refused = buildExcerptEntry(1, {
    request_kind: 'seat_request', requested_by: 'lab-a', objection_id: 'O-1a2b3c4d', origin: 'panel-1-lab-a', why: 'To judge the claim.', source_kind: 'repository_file', path: 'src/a.js', lines: '1-2', text: null, answered_stage: base[1].label,
    approval: { status: 'refused', actor: 'alice', channel: 'cli', at: AT, reason: 'No.' },
  });
  assert.deepEqual(await prompts([refused]), base);
});

test('source scan: the excerpt text is NOT fenced source: `fencedSource` is a const set once from the request as it came in, never extended', () => {
  const src = readFileSync(resolve(root, 'src', 'chain.js'), 'utf8');
  assert.equal(src.match(/\bconst fencedSource = /g).length, 1, 'one const');
  assert.equal(src.match(/fencedSourceOf\(request\)/g).length, 1, 'one call, on `request`');
  assert.doesNotMatch(src, /\blet fencedSource\b|\bfencedSource\s*\+=/, 'never reassigned or extended');
  assert.match(src, /const fencedSource = fencedSourceOf\(request\);/);
});

test('deterministic (C&C 09 Nov, condition 2): a prompt\'s block depends only on the excerpts whose answered stage completed before it: adding a LATER excerpt leaves every prompt up to and including that stage as it was, and the same input twice gives the same prompts', async () => {
  setHeldForTest(WORDS);
  const base = await prompts(null);
  const l1 = base[1].label; const l2 = base[Math.floor((base.length * 2) / 3)].label;
  assert.notEqual(l1, l2);
  const one = await prompts([entry(1, l1)]);
  const two = await prompts([entry(1, l1), entry(2, l2)]);
  const again = await prompts([entry(1, l1), entry(2, l2)]);
  assert.deepEqual(again, two, 'the same excerpts, the same prompts');
  const i2 = base.findIndex(s => s.label === l2);
  for (let i = 0; i <= i2; i++) assert.equal(two[i].user, one[i].user, `${two[i].label}: up to and including ${l2} it is as with the first excerpt alone`);
  assert.ok(two.some((s, i) => i > i2 && s.user !== one[i].user), 'a later prompt does carry the second excerpt (else this passes vacuously)');
});
