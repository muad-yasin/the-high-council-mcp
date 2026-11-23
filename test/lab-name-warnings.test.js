// 0.8.4, S7-03 (his decision 12 of 28 Okt 2026: "Warn"): one model seated under two lab names among the critics is a WARNING printed by `council doctor --chain`, never a lint finding (a finding would read "will not run" and stop a
// paused run from resuming). "One model" is src/chain.js seatIdentity (the repo's rule for "is this the same agent"); a lab is labOf. Offline, $0.
// On a tree WITHOUT src/lab-name-warnings.js every helper test fails by construction (the module is missing: they import it inside the test, so each fails on its own); the DISCRIMINATING reds are DOC-2 (doctor) and RUN-1 (the run's first start).
// Rows: LNW-1..6 positives (two routes, :variant, case, no lab on either seat, the same model on two layers under two labs, two external critics naming one session); LNW-7 the sorted, exact output; LNW-8..12 controls
// (same lab on two layers, mock, builder/reviser, different models, odd shapes); DOC-1 (control) / DOC-2 / DOC-3 (control) the real verb `doctor --chain`; RUN-1 / RUN-2 (control) the run's own start and a resume; SCAN-1 no chain file of the package trips it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lintChain } from '../src/chain-lint.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const warn = async config => (await import('../src/lab-name-warnings.js')).modelLabWarnings(config);
const chainOf = critics => ({ name: 'two-labs', signoff: 'unanimous', maxRounds: 2, estimate: { promptTokens: 500, draftTokens: 500, critiqueTokens: 200 }, seats: { criteria: { provider: 'mock', model: 'mock-criteria' }, builder: { provider: 'mock', model: 'mock-builder', lab: 'author' }, reviser: { provider: 'mock', model: 'mock-builder', lab: 'author' }, critics } });
const labsOf = w => w.map(x => x.labs);

test('LNW-1 one model through two routes (OpenRouter and direct) under two lab names: one warning naming both seats', async () => {
  const w = await warn(chainOf([{ provider: 'openai', model: 'gpt-6', lab: 'a' }, { provider: 'openrouter', model: 'openai/gpt-6', lab: 'b' }, { provider: 'google', model: 'gemini-3.8-flash', lab: 'c' }]));
  assert.equal(w.length, 1);
  assert.deepEqual(w[0].labs, ['a', 'b']);
  assert.deepEqual(w[0].seats.map(s => s.path), ['seats.critics[0]', 'seats.critics[1]']);
});
test('LNW-2 a :variant of the model is the same model', async () => {
  assert.deepEqual(labsOf(await warn(chainOf([{ provider: 'openrouter', model: 'qwen/qwen3.7-plus', lab: 'a' }, { provider: 'openrouter', model: 'qwen/qwen3.7-plus:nitro', lab: 'b' }]))), [['a', 'b']]);
});
test('LNW-3 upper and lower case of the model string are the same model', async () => {
  assert.deepEqual(labsOf(await warn(chainOf([{ provider: 'openai', model: 'GPT-6', lab: 'a' }, { provider: 'openai', model: 'gpt-6', lab: 'b' }]))), [['a', 'b']]);
});
test('LNW-4 two seats with no lab: each seat\'s lab is its provider, so two providers are two labs', async () => {
  assert.deepEqual(labsOf(await warn(chainOf([{ provider: 'openai', model: 'gpt-6' }, { provider: 'openrouter', model: 'openai/gpt-6' }]))), [['openai', 'openrouter']]);
});
test('LNW-5 the same model on two layers under two lab names (the old -l2/-l3 case) is a warning', async () => {
  assert.deepEqual(labsOf(await warn(chainOf([{ provider: 'openai', model: 'gpt-6', lab: 'a', layer: 1 }, { provider: 'openai', model: 'gpt-6', lab: 'a-l2', layer: 2 }]))), [['a', 'a-l2']]);
});
test('LNW-6 two external critics that name one session under two labs are one agent', async () => {
  assert.deepEqual(labsOf(await warn(chainOf([{ provider: 'external', model: 'claude-code-session', lab: 'a' }, { provider: 'external', model: 'claude-code-session', lab: 'b' }]))), [['a', 'b']]);
});
test('LNW-7 the output is sorted by model and the sentence is exact', async () => {
  const w = await warn(chainOf([{ provider: 'openai', model: 'gpt-6', lab: 'a' }, { provider: 'google', model: 'gemini-3.8-flash', lab: 'c' }, { provider: 'openai', model: 'gpt-6', lab: 'b' }, { provider: 'google', model: 'gemini-3.8-flash', lab: 'd' }]));
  assert.deepEqual(w.map(x => x.identity), ['gemini-3.8-flash', 'gpt-6']);
  assert.equal(w[1].message, 'one model sits on judge seats under 2 lab names: seats.critics[0] (openai/gpt-6, lab "a"); seats.critics[2] (openai/gpt-6, lab "b"). THC counts independent labs by lab name, so this one model counts as 2 labs. Give these seats one lab name, or seat a different model.');
});

test('LNW-8 (control) the same model on two layers under ONE lab is not a warning (the lab-identity unit allows it)', async () => {
  assert.deepEqual(await warn(chainOf([{ provider: 'openai', model: 'gpt-6', lab: 'a', layer: 1 }, { provider: 'openai', model: 'gpt-6', lab: 'a', layer: 2 }])), []);
});
test('LNW-9 (control) mock seats never match, whatever their names', async () => {
  assert.deepEqual(await warn(chainOf([{ provider: 'mock', model: 'mock-critic', lab: 'a' }, { provider: 'mock', model: 'mock-critic', lab: 'b' }])), []);
});
test('LNW-10 (control) only the critics are compared: the builder\'s and reviser\'s model under another lab is the self-review rule\'s', async () => {
  const c = chainOf([{ provider: 'openai', model: 'gpt-6', lab: 'a' }]);
  c.seats.builder = { provider: 'openai', model: 'gpt-6', lab: 'author' };
  assert.deepEqual(await warn(c), []);
});
test('LNW-11 (control) different models, and a model under the same name twice, are not a warning', async () => {
  assert.deepEqual(await warn(chainOf([{ provider: 'openai', model: 'gpt-6', lab: 'a' }, { provider: 'openai', model: 'gpt-6.1', lab: 'b' }, { provider: 'google', model: 'gemini-3.8-flash', lab: 'c' }, { provider: 'google', model: 'gemini-3.8-flash', lab: 'c' }])), []);
});
test('LNW-12 (control) odd shapes are skipped, not thrown on: no critics, a non-array, a null seat, a seat with no model', async () => {
  assert.deepEqual(await warn({}), []);
  assert.deepEqual(await warn({ seats: { critics: 'x' } }), []);
  assert.deepEqual(await warn(chainOf([null, { provider: 'openai', lab: 'a' }, { provider: 'openai', model: 'gpt-6', lab: 'b' }])), []);
});

// CHANGED ACCEPTED TEST (0.8.4 apply, recorded state): OLD: the warning read `the critics seat one model under N lab names`. NEW: `one model sits on judge seats under N lab names` in LNW-7, DOC-2, RUN-1 and the report pre_flight line (K5). WHY: the reviewed warning of src/lab-name-warnings.js (applied with the 0.8.4 wording).
// The real verb: `council doctor --chain <file>` on a scratch chain OUTSIDE chains/ whose critics seat one model under two lab names. It lints clean, so the exit code is 0 and the file is "no lint problems"; the warning is a line of its own.
const doctor = chain => {
  const dir = mkdtempSync(join(tmpdir(), 'lnw-'));
  const file = join(dir, 'two-labs.json');
  writeFileSync(file, JSON.stringify(chain));
  const r = spawnSync(process.execPath, [join(ROOT, 'src', 'cli.js'), 'doctor', '--chain', file], { cwd: dir, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: dir }, timeout: 60_000 });
  return { file, r, out: `${r.stdout}\n${r.stderr}` };
};
const TWO = chainOf([{ provider: 'openai', model: 'gpt-6', lab: 'a' }, { provider: 'openrouter', model: 'openai/gpt-6', lab: 'b' }, { provider: 'google', model: 'gemini-3.8-flash', lab: 'c' }]);
test('DOC-1 (control: holds with or without the warning) the chain lints clean: doctor --chain exits 0 and says there are no lint problems', () => {
  assert.deepEqual(lintChain(TWO, '/scratch/two-labs.json'), []);
  const { r, file } = doctor(TWO);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.ok(r.stdout.includes(`${file}: no lint problems.`), r.stdout);
});
test('DOC-2 doctor --chain prints exactly one WARNING line naming the model and its two lab names (the exit code stays 0)', () => {
  const { r } = doctor(TWO);
  const lines = r.stdout.split('\n').filter(l => l.startsWith('WARNING: one model sits on judge seats'));
  assert.equal(lines.length, 1, r.stdout);
  assert.ok(lines[0].includes('seats.critics[0] (openai/gpt-6, lab "a")') && lines[0].includes('seats.critics[1] (openrouter/openai/gpt-6, lab "b")'), lines[0]);
  assert.equal(r.status, 0);
});
test('DOC-3 (control: holds without the warning) a chain whose critics are one model per lab prints no such WARNING', () => {
  const { r } = doctor(chainOf([{ provider: 'openai', model: 'gpt-6', lab: 'a' }, { provider: 'google', model: 'gemini-3.8-flash', lab: 'c' }]));
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(r.stdout.includes('one model sits on judge seats'), false);
});

// The run's own start (src/cli.js, the pre-flight list beside judgePersonaWarnings): a FIRST start prints it as a PRE-FLIGHT WARNING and writes it to WARNINGS.md (a run record); a resume does not print it again. Two external critics
// naming one session under two lab names are one agent (seatIdentity), and an external seat needs no key: the run pauses at exit 3 once the warning is out. Real verb, $0.
const EXT = { ...chainOf([{ provider: 'external', model: 'claude-code-session', lab: 'a' }, { provider: 'external', model: 'claude-code-session', lab: 'b' }]), name: 'ext-two-labs' };
const project = () => {
  const dir = mkdtempSync(join(tmpdir(), 'lnw-run-'));
  mkdirSync(join(dir, 'chains')); mkdirSync(join(dir, 'tasks'));
  writeFileSync(join(dir, 'chains', 'ext-two-labs.json'), JSON.stringify(EXT));
  writeFileSync(join(dir, 'tasks', 't.md'), '# A plan\n');
  const run = args => spawnSync(process.execPath, [join(ROOT, 'src', 'cli.js'), ...args], { cwd: dir, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: dir }, timeout: 60_000 });
  return { dir, run };
};
test('RUN-1 a first start prints the PRE-FLIGHT WARNING once and writes it to WARNINGS.md; the run pauses at the external critics (exit 3)', () => {
  const p = project();
  const r = p.run(['--chain', 'ext-two-labs', '--task', 'tasks/t.md']);
  assert.equal(r.status, 3, r.stdout + r.stderr);
  const lines = `${r.stdout}\n${r.stderr}`.split('\n').filter(l => l.includes('PRE-FLIGHT WARNING: one model sits on judge seats'));
  assert.equal(lines.length, 1, r.stdout + r.stderr);
  const runDir = join(p.dir, 'runs', readdirSync(join(p.dir, 'runs'))[0]);
  const text = readFileSync(join(runDir, 'WARNINGS.md'), 'utf8');
  assert.equal(text.split('\n').filter(l => l.startsWith('- pre_flight: one model sits on judge seats under 2 lab names: seats.critics[0] (external/claude-code-session, lab "a"); seats.critics[1] (external/claude-code-session, lab "b")')).length, 1, text);
});
test('RUN-2 (control: holds without the warning) a resume prints no PRE-FLIGHT WARNING again and leaves WARNINGS.md as it was', () => {
  const p = project();
  assert.equal(p.run(['--chain', 'ext-two-labs', '--task', 'tasks/t.md']).status, 3);
  const runDir = join(p.dir, 'runs', readdirSync(join(p.dir, 'runs'))[0]);
  const before = existsSync(join(runDir, 'WARNINGS.md')) ? readFileSync(join(runDir, 'WARNINGS.md'), 'utf8') : null;
  const r = p.run(['--resume', runDir]);
  assert.equal(`${r.stdout}\n${r.stderr}`.includes('PRE-FLIGHT WARNING: one model sits on judge seats'), false);
  assert.equal(existsSync(join(runDir, 'WARNINGS.md')) ? readFileSync(join(runDir, 'WARNINGS.md'), 'utf8') : null, before);
});

test('SCAN-1 (control today) no chain file of the package, shipped or archived, trips it (a chain added later that does would turn this red)', async () => {
  let n = 0;
  for (const d of ['chains', join('chains', 'outdated')]) {
    for (const f of readdirSync(join(ROOT, d)).filter(f => f.endsWith('.json'))) {
      n++;
      assert.deepEqual(labsOf(await warn(JSON.parse(readFileSync(join(ROOT, d, f), 'utf8')))), [], `${d}/${f}`);
    }
  }
  assert.ok(n >= 60, `${n} chain files scanned`);
});
