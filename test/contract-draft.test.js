// `council contract draft --from-run` (0.8.2 item 6d, plan M8): one call on the handoff seat, linted, written as contract/draft.json; its prompt (P12) is held until the one re-record, so a real seat is refused and a
// mock seat proves the path. Offline, $0.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import * as R from '../src/roles.js';
import { contractDraftPrompt, setContractDraftPromptForTest } from '../src/contract-draft.js';
import { answerGate, readGateAnswer } from '../src/gate.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(root, 'src/cli.js');
const council = (cwd, ...args) => spawnSync(process.execPath, [cli, ...args], { cwd, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: cwd }, timeout: 120_000 });

// A workspace with one finished mock run, and chains whose handoff seat is the one under test.
function workspace() {
  const dir = mkdtempSync(join(tmpdir(), 'thc-cd-'));
  mkdirSync(join(dir, 'tasks')); mkdirSync(join(dir, 'chains'));
  writeFileSync(join(dir, 'tasks', 't.md'), 'Plan a small reading list app.\n');
  const cfg = JSON.parse(readFileSync(join(root, 'chains', 'mock-debate.json'), 'utf8'));
  const withHandoff = (name, seat) => writeFileSync(join(dir, 'chains', `${name}.json`), JSON.stringify({ ...cfg, name, seats: { ...cfg.seats, handoff: seat } }));
  withHandoff('cd', { provider: 'mock', model: 'mock-contract-draft' });
  withHandoff('cd-bad', { provider: 'mock', model: 'mock-contract-draft-bad' });
  withHandoff('cd-invented', { provider: 'mock', model: 'mock-contract-draft-invented' });
  withHandoff('cd-real', { provider: 'anthropic', model: 'claude-sonnet-5-5' });
  withHandoff('cd-ext', { provider: 'external' });
  writeFileSync(join(dir, 'chains', 'plain.json'), JSON.stringify({ ...cfg, name: 'plain' }));
  const r = council(dir, '--chain', 'plain', '--task', 'tasks/t.md');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const id = readdirSync(join(dir, 'runs'))[0];
  return { dir, id, run: join(dir, 'runs', id), rel: `runs/${id}` };
}

test('contract draft with a mock seat: the run\'s criteria reach the seat as C1. lines, the reply is linted and written as contract/draft.json, the call is recorded, nothing else changes', () => {
  const { dir, run, rel } = workspace();
  const report = JSON.parse(readFileSync(join(run, 'report.json'), 'utf8'));
  const before = readdirSync(run).sort();
  const r = council(dir, 'contract', 'draft', '--from-run', rel, '--chain', 'cd');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /wrote .*contract\/draft\.json \(\d+ obligations?/);
  const draft = JSON.parse(readFileSync(join(run, 'contract', 'draft.json'), 'utf8'));
  assert.equal(draft.obligations.length, report.criteria.length, 'one obligation per criterion line the seat was shown');
  assert.deepEqual(draft.obligations.map(o => o.criterion), report.criteria.map((_, i) => `C${i + 1}`));
  for (const o of draft.obligations) assert.deepEqual(Object.keys(o).sort(), ['check', 'criterion', 'id', 'text'], 'only the four fields, in the lint\'s normal form');
  assert.ok(existsSync(join(run, 'contract', 'draft-reply.md')), 'the raw reply is kept');
  assert.ok(readdirSync(join(run, 'superseded')).some(f => /^contract-draft\.call-1\.usage\.json$/.test(f)), 'the call is on record like a handoff call');
  assert.deepEqual(readdirSync(run).sort().filter(f => !before.includes(f)).sort(), ['contract', 'superseded'].filter(f => !before.includes(f)), 'only the contract folder (and the call record) are new');
  assert.equal(existsSync(join(run, 'HANDOFF-from-run.md')), false, 'no HANDOFF file in draft mode');
  // and the draft goes on to a lock: waiting for a person (exit 3), nothing recorded as locked
  const lock = council(dir, 'contract', 'lock', rel);
  assert.equal(lock.status, 3, lock.stderr);
  assert.match(lock.stdout, new RegExp(`${draft.obligations.length} obligations?`));
});

test('M8 exit check as ONE sequence on a real mock run: draft, lock (waits), a person approves the gate, lock (exit 0), check (exit 0), a tampered v1.json makes check exit non-zero', () => {
  const { dir, run, rel } = workspace();
  assert.equal(council(dir, 'contract', 'draft', '--from-run', rel, '--chain', 'cd').status, 0);
  assert.equal(council(dir, 'contract', 'lock', rel).status, 3);
  const g = readGateAnswer(run, 'g1');
  assert.equal(answerGate(run, 'g1', { channel: 'cli', shownSha256: g.gate.sha256, decision: 'approved', actor: 'test', tty: true }).ok, true);
  const locked = council(dir, 'contract', 'lock', rel); assert.equal(locked.status, 0, locked.stderr);
  const ok = council(dir, 'contract', 'check', rel);
  assert.equal(ok.status, 0, ok.stdout + ok.stderr);
  assert.match(ok.stdout, /contract v1: record, approval and ledger agree/);
  assert.match(ok.stdout, /sealed|checks held/, 'the run\'s thin contract (a real run has one) is checked in the same command');
  const v1 = join(run, 'contract', 'v1.json');
  writeFileSync(v1, readFileSync(v1, 'utf8').replace('Satisfy:', 'Skip:'));
  const bad = council(dir, 'contract', 'check', rel);
  assert.equal(bad.status, 1, bad.stdout + bad.stderr);
  assert.match(bad.stderr, /does not match its own sha256/);
});

test('a reply the lint refuses (a field named like an identity field) leaves no draft, keeps only the reply, and fails the command', () => {
  const { dir, run, rel } = workspace();
  const r = council(dir, 'contract', 'draft', '--from-run', rel, '--chain', 'cd-bad');
  assert.equal(r.status, 16, r.stdout + r.stderr);
  assert.match(r.stderr, /refused by the lint/); assert.match(r.stderr, /version: a field named like an identity field/);
  assert.equal(existsSync(join(run, 'contract', 'draft.json')), false);
  assert.match(readFileSync(join(run, 'contract', 'draft-reply.md'), 'utf8'), /"version":7/);
});

test('the prompt is recorded: a real seat is given it, and an external seat is told to write the draft itself', () => {
  const { dir, rel } = workspace();
  const ext = council(dir, 'contract', 'draft', '--from-run', rel, '--chain', 'cd-ext');
  assert.equal(ext.status, 2); assert.match(ext.stderr, /external.*contract lock .*--draft/s);
});

test('usage: --from-run is required; handoff --from-run still says "handoff"', () => {
  const { dir, rel } = workspace();
  const r = council(dir, 'contract', 'draft'); assert.equal(r.status, 2); assert.match(r.stderr, /contract draft: --from-run <run folder> is required/);
  const h = council(dir, 'handoff'); assert.equal(h.status, 2); assert.match(h.stderr, /handoff: --from-run <run folder> is required/);
  const h2 = council(dir, 'handoff', '--from-run', rel, '--chain', 'cd-bad');
  assert.equal(h2.status, 0, h2.stderr); assert.match(h2.stdout, /handoff: wrote /, 'the handoff path is unchanged');
});

test('the door for the recorded prompt: any seat is given roles.js\'s text (the request, the criteria as C1. lines, the plan, the handoff only when there is one); an injected prompt still wins', () => {
  const real = contractDraftPrompt({ provider: 'anthropic', request: 'r', draft: 'the plan', handoff: 'the handoff', criteria: ['first', 'second'] });
  assert.equal(real.ok, true); assert.equal(real.system, R.CONTRACT_DRAFT_SYSTEM);
  assert.equal(real.user, '# Request\n\nr\n\n# Criteria\n\nC1. first\nC2. second\n\n# The plan\n\nthe plan\n\n# The handoff\n\nthe handoff');
  assert.equal(contractDraftPrompt({ provider: 'anthropic', request: 'r', draft: 'the plan', criteria: ['first'] }).user.includes('# The handoff'), false, 'no handoff, no heading');
  const mock = contractDraftPrompt({ provider: 'mock', request: 'r', draft: 'the plan', criteria: ['first', 'second'] });
  assert.equal(mock.ok, true); assert.match(mock.user, /# Criteria\n\nC1\. first\nC2\. second\n\n# The plan\n\nthe plan/);
  const seen = [];
  setContractDraftPromptForTest({ system: 'SYS', user: a => { seen.push(a); return 'USER'; } });
  try {
    const p = contractDraftPrompt({ provider: 'anthropic', request: 'req', draft: 'the plan', handoff: 'the handoff', criteria: ['first'] });
    assert.deepEqual(p, { ok: true, system: 'SYS', user: 'USER' });
    assert.deepEqual(seen, [{ request: 'req', draft: 'the plan', handoff: 'the handoff', criteria: ['first'] }]);
  } finally { setContractDraftPromptForTest(null); }
});

// ---- the review of the contract-draft prompt (7 Oct 2026): the lint stays the authority; what a run with no criteria and a draft with gaps must do ----
test('a run with no readable criteria refuses a draft that names a criterion (the lint gets [], not "unknown"): an invented C1 does not pass', () => {
  const { dir, run, rel } = workspace();
  const report = JSON.parse(readFileSync(join(run, 'report.json'), 'utf8'));
  writeFileSync(join(run, 'report.json'), JSON.stringify({ ...report, criteria: [] }));
  for (const f of ['criteria.md', 'report-partial.json']) if (existsSync(join(run, f))) writeFileSync(join(run, f), f.endsWith('.json') ? '{}' : '');
  const r = council(dir, 'contract', 'draft', '--from-run', rel, '--chain', 'cd-invented');
  assert.equal(r.status, 16, r.stdout + r.stderr);
  assert.match(r.stderr, /refused by the lint/);
  assert.match(r.stderr, /obligations\[0\]\.criterion/);
  assert.equal(existsSync(join(run, 'contract', 'draft.json')), false);
});

test('the same draft passes on a run that has criteria (the control: only the unknown label is refused)', () => {
  const { dir, run, rel } = workspace();
  const r = council(dir, 'contract', 'draft', '--from-run', rel, '--chain', 'cd-invented');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(JSON.parse(readFileSync(join(run, 'contract', 'draft.json'), 'utf8')).obligations[0].criterion, 'C1');
});

test('contract lock lists the criteria no obligation names and the UNRESOLVED obligations (a listing for the person, never a refusal)', () => {
  const { dir, run, rel } = workspace();
  const n = JSON.parse(readFileSync(join(run, 'report.json'), 'utf8')).criteria.length;
  assert.ok(n >= 3);
  const draft = join(dir, 'd.json');
  writeFileSync(draft, JSON.stringify({ obligations: [{ id: 'O1', text: 'Build the first thing.', criterion: 'C1' }, { id: 'O2', text: 'UNRESOLVED: the plan names no owner; a person must decide.' }] }));
  const r = council(dir, 'contract', 'lock', rel, '--draft', draft);
  assert.equal(r.status, 3, r.stdout + r.stderr);
  assert.match(r.stdout, new RegExp(`criteria no obligation names: C2, C3${n > 3 ? ', ' : ''}`));
  assert.match(r.stdout, /1 obligation is marked UNRESOLVED .*: O2/);
  // nothing flagged when every criterion is named and nothing is unresolved
  const all = join(dir, 'all.json');
  writeFileSync(all, JSON.stringify({ obligations: Array.from({ length: n }, (_, i) => ({ id: `O${i + 1}`, text: `Serve criterion ${i + 1}.`, criterion: `C${i + 1}` })) }));
  const ok = council(dir, 'contract', 'lock', rel, '--draft', all);
  assert.doesNotMatch(ok.stdout, /no obligation names|UNRESOLVED/);
});
