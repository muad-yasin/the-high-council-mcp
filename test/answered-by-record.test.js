// 0.8.3 harness (a): the record of who answered a session seat, end to end. submit_stage over the real MCP transport (a mock-external run, $0), the usage file,
// the replay row, report.json (validated against the published schema), the BOARD section, the NEEDS-file sentence, and a golden run folder written by the
// older versions (its usage file still says claude-code-session) that spend and the report assembly must read unchanged.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import { submitStageAnswer, SESSION_MODEL } from '../src/stage-submission.js';
import { declaredAnswerer, askedForSentence, answerNoteOf, undeclaredNoteOf } from '../src/answered-by.js';
import { buildStageContract, renderStagePromptBundle } from '../src/stage-contract.js';
import { runChain, setBudget, setCache } from '../src/chain.js';
import { reportJsonShape, renderBoardMd } from '../src/report-shape.js';
import { spendReport, costToday } from '../src/spend.js';
import { malformedProviderKeys } from './helpers/no-real-keys.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(root, 'src/cli.js');
const schema = JSON.parse(readFileSync(join(root, 'schemas', 'report-v1.json'), 'utf8'));
const ajv = new Ajv2020({ allErrors: true, allowUnionTypes: true });
ajv.addKeyword({ keyword: 'x-stability', schemaType: 'string' });
const validate = ajv.compile(schema);

function mcp(cwd, calls, clientInfo) {
  return new Promise((done, fail) => {
    const child = spawn(process.execPath, [cli, '--mcp'], { cwd, env: { PATH: process.env.PATH, HOME: cwd, ...malformedProviderKeys() } });
    const byId = new Map(); let buf = '';
    const timer = setTimeout(() => { child.kill(); fail(new Error(`timed out; got ids ${[...byId.keys()]}`)); }, 60_000);
    child.stdout.on('data', d => {
      buf += d; let nl;
      while ((nl = buf.indexOf('\n')) !== -1) { const line = buf.slice(0, nl); buf = buf.slice(nl + 1); try { const m = JSON.parse(line); if (m.id !== undefined) byId.set(m.id, m); } catch { /* not JSON */ } }
      if (calls.every((_, i) => byId.has(i + 2))) { clearTimeout(timer); child.stdin.end(); child.kill(); done(calls.map((_, i) => byId.get(i + 2))); }
    });
    child.stdin.write([
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo } },
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      ...calls.map((c, i) => ({ jsonrpc: '2.0', id: i + 2, method: 'tools/call', params: c })),
    ].map(x => JSON.stringify(x)).join('\n') + '\n');
  });
}
const payload = m => { const t = m?.result?.content?.[0]?.text; try { return JSON.parse(t); } catch { return { raw: t ?? JSON.stringify(m) }; } };

function pausedRun() {
  const work = mkdtempSync(join(tmpdir(), 'thc-answeredby-')); mkdirSync(join(work, 'tasks'), { recursive: true });
  writeFileSync(join(work, 'tasks', 't.md'), '# A plan\n\nPlan a small note-taking app.\n');
  const p = spawnSync(process.execPath, [cli, '--chain', 'mock-external', '--task', 'tasks/t.md', '--max-usd', 'none'], { cwd: work, env: { PATH: process.env.PATH, HOME: work }, encoding: 'utf8' });
  assert.equal(p.status, 3, `fixture: the run paused at its external stage: ${p.stdout}${p.stderr}`);
  const id = readdirSync(join(work, 'runs'))[0]; const dir = join(work, 'runs', id);
  const stage = readdirSync(dir).find(f => /^NEEDS-.*\.md$/.test(f)).replace(/^NEEDS-|\.md$/g, '');
  return { work, id, dir, stage };
}

test('PROBE submit_stage over the MCP transport: the usage file records the client the server saw and the model the session declared; the neutral model string; nothing about it comes back to the caller', async () => {
  const w = pausedRun();
  const [r] = await mcp(w.work, [{ name: 'submit_stage', arguments: { run: w.id, stage: w.stage, content: '# Plan\n\nA small note-taking app.\n', answered_model: 'gpt-6.1' } }], { name: 'codex-probe‮', version: '9.9' });
  const a = payload(r);
  assert.equal(a.written, `${w.stage}.md`, JSON.stringify(a));
  const u = JSON.parse(readFileSync(join(w.dir, `${w.stage}.usage.json`), 'utf8'));
  assert.equal(u.provider, 'external'); assert.equal(u.model, 'session', 'the record no longer names Claude Code whoever answered'); assert.equal(u.usd, 0);
  assert.deepEqual(u.answered_by, { client: { name: 'codex-probe', version: '9.9' }, model: 'gpt-6.1', declared_by: 'caller' });
  assert.ok(!JSON.stringify(a).includes('codex-probe'), 'the declared strings are not echoed to the caller');
});

test('PROBE submit_stage with no answered_model records the client only (declared_by client)', async () => {
  const w = pausedRun();
  const [r1] = await mcp(w.work, [{ name: 'submit_stage', arguments: { run: w.id, stage: w.stage, content: '# Plan\n\nFirst.\n' } }], { name: 'claude-code', version: '2.1.199' });
  assert.equal(payload(r1).written, `${w.stage}.md`);
  const first = JSON.parse(readFileSync(join(w.dir, `${w.stage}.usage.json`), 'utf8'));
  assert.deepEqual(first.answered_by, { client: { name: 'claude-code', version: '2.1.199' }, model: null, declared_by: 'client' });
});

test('submitStageAnswer: no declaredAnswer writes no field (a caller of the module that never heard of it); a refused answer writes no usage file at all', () => {
  const dir = mkdtempSync(join(tmpdir(), 'thc-answeredby-unit-'));
  submitStageAnswer(dir, 'build', '# Plan\n\nText.\n');
  const u = JSON.parse(readFileSync(join(dir, 'build.usage.json'), 'utf8'));
  assert.equal(u.model, SESSION_MODEL); assert.equal('answered_by' in u, false);
  assert.throws(() => submitStageAnswer(dir, 'revise-1', 'Authorization: Bearer abcdefghij0123456789xyz', { declaredAnswer: declaredAnswerer({ model: 'gpt-6.1' }) }), /key-shaped/);
  assert.equal(existsSync(join(dir, 'revise-1.usage.json')), false);
  // a second answer for the same stage is kept beside the first, with its own record
  const second = submitStageAnswer(dir, 'build', '# Plan\n\nSecond.\n', { declaredAnswer: declaredAnswerer({ clientInfo: { name: 'cline', version: '3' }, model: 'claude-opus-5-5' }) });
  assert.equal(second.isDuplicate, true);
  const late = JSON.parse(readFileSync(join(dir, 'build.late.usage.json'), 'utf8'));
  assert.equal(late.model, 'session'); assert.deepEqual(late.answered_by, { client: { name: 'cline', version: '3' }, model: 'claude-opus-5-5', declared_by: 'caller' });
  assert.equal('answered_by' in JSON.parse(readFileSync(join(dir, 'build.usage.json'), 'utf8')), false, 'the first answer\'s file is untouched');
});

const external = { provider: 'external', model: 'subscription:opus-5.5', lab: 'opus5.5-sub' };
const cfg = () => ({ name: 'answeredby', maxRounds: 1, criteria: ['It exists.'], seats: { builder: external, reviser: { provider: 'mock', model: 'mock-builder' }, critics: [{ provider: 'mock', model: 'mock-critic-a' }] } });
const hitOf = extra => ({ get: l => (l === 'build' ? { text: '# Plan\n\nDo the thing.\n', provider: 'external', model: 'session', usage: { input: 0, output: 4 }, usd: 0, ms: 0, ...extra } : null), warn() {}, invalidate() {} });

test('replay row, report.json and BOARD: a session seat answered by another company\'s model is reported as it was declared; the run itself is unchanged (not a dropout, same outcome)', async () => {
  setBudget(null);
  const said = declaredAnswerer({ clientInfo: { name: 'codex', version: '1' }, model: 'gpt-6.1' });
  setCache(hitOf({ answered_by: said })); const withRecord = await runChain({ request: 'Req.', config: cfg(), log: () => {} });
  setCache(hitOf({})); const without = await runChain({ request: 'Req.', config: cfg(), log: () => {} });
  setCache(null);
  const row = withRecord.stages.find(s => s.label === 'build');
  assert.equal(row.asked_for, 'subscription:opus-5.5'); assert.deepEqual(row.answered_by, said); assert.equal(row.lab, 'opus5.5-sub', 'labOf is untouched: the lab is still the chain\'s own');
  assert.equal(withRecord.stages.find(s => s.provider === 'mock')?.asked_for, undefined, 'a model-API seat\'s row has no new field');
  // nothing the run DECIDED moved
  assert.equal(withRecord.passed, without.passed); assert.deepEqual(withRecord.dropouts, without.dropouts); assert.deepEqual(withRecord.stages.map(s => s.label), without.stages.map(s => s.label));
  const rep = reportJsonShape({ runId: 'x', chain: 'c', task: 't', result: withRecord, config: cfg() });
  assert.ok(validate(rep), JSON.stringify(validate.errors, null, 2));
  assert.equal(rep.roster_answers.seats[0].status, 'different'); assert.equal(rep.roster_answers.seats[0].company, 'openai');
  assert.equal(rep.outcome, reportJsonShape({ runId: 'x', chain: 'c', task: 't', result: without, config: cfg() }).outcome, 'a different-model answer does not change the outcome');
  const repNo = reportJsonShape({ runId: 'x', chain: 'c', task: 't', result: without, config: cfg() });
  assert.ok(validate(repNo), JSON.stringify(validate.errors, null, 2));
  assert.equal(repNo.roster_answers.seats[0].status, 'not-declared'); assert.equal(repNo.roster_answers.seats[0].answered_by, null);
  const board = renderBoardMd({ runId: 'x', result: withRecord });
  assert.match(board, /## Who answered the session seats/); assert.match(board, /As declared by the client and the session, never verified\./);
  assert.match(board, /- build: seated as subscription:opus-5.5; answered by codex 1 as gpt-6\.1 \(openai\)/);
  assert.match(renderBoardMd({ runId: 'x', result: without }), /answered by a client that gave no name as not declared \(company not known\)/);
});

test('a run with no session seat has no roster_answers key and no BOARD section (byte for byte what it was)', async () => {
  setBudget(null); setCache(null);
  const mockOnly = { name: 'plain', maxRounds: 1, criteria: ['It exists.'], seats: { builder: { provider: 'mock', model: 'mock-builder' }, reviser: { provider: 'mock', model: 'mock-builder' }, critics: [{ provider: 'mock', model: 'mock-critic-a' }] } };
  const r = await runChain({ request: 'Req.', config: mockOnly, log: () => {} });
  assert.equal('roster_answers' in reportJsonShape({ runId: 'x', chain: 'c', task: 't', result: r, config: mockOnly }), false);
  assert.doesNotMatch(renderBoardMd({ runId: 'x', result: r }), /Who answered the session seats/);
});

test('S3 (the sentence helper) and the dispatch bundle: the same approved words, once, in RETURN; a bundle for a seat that asks for no model is byte for byte what it was', () => {
  assert.equal(askedForSentence('subscription:opus-5.5'), 'This seat is asked for subscription:opus-5.5. If a different model answers, say so with answered_model.\n\n');
  assert.equal(askedForSentence('claude-code-session'), '', 'a seat that asks for no model gets no sentence');
  assert.equal(askedForSentence(null), ''); assert.equal(askedForSentence(undefined), '');
  const contract = buildStageContract(JSON.parse(readFileSync(join(root, 'chains', 'mock-external.json'), 'utf8')), 'build');
  const args = { contract, taskText: 'T', chainName: 'c', label: 'build', run: 'r', references: ['/x/NEEDS-build.md'], answerFile: '/x/build.md' };
  const plain = renderStagePromptBundle(args);
  assert.equal(renderStagePromptBundle({ ...args, askedFor: null }), plain); assert.equal(renderStagePromptBundle({ ...args, askedFor: 'claude-code-session' }), plain);
  const asked = renderStagePromptBundle({ ...args, askedFor: 'subscription:opus-5.5' });
  assert.equal(asked.split('This seat is asked for subscription:opus-5.5. If a different model answers, say so with answered_model.').length, 2, 'once');
  assert.match(asked, /# RETURN\nThis seat is asked for subscription:opus-5\.5\. If a different model answers, say so with answered_model\.\n\nWhen you hand your deliverable back, add one line of your own outside it: the model you are, so the driving session can pass it as answered_model\. Write your deliverable/);
  assert.equal(asked.replace(/This seat is asked for [^\n]*\n\n/, ''), plain, 'nothing else in the bundle moved');
});

test('S4 and S5: the sentences', () => {
  const row = { label: 'panel-1-opus', lab: 'opus', provider: 'external', asked_for: 'subscription:opus-5.5', answered_by: declaredAnswerer({ model: 'gpt-6.1' }) };
  assert.equal(answerNoteOf(row), "!! ANSWERED BY A DIFFERENT MODEL: panel-1-opus is seated as subscription:opus-5.5 and the answer says gpt-6.1. Independence below is counted from what the answerers declared, not from the chain's names.");
  assert.equal(answerNoteOf({ ...row, answered_by: declaredAnswerer({ model: 'claude-opus-5-5' }) }), null, 'the same company: no note');
  assert.equal(answerNoteOf({ ...row, answered_by: null }), null, 'nothing declared: no per-stage note (S5 covers judges once per run)');
  assert.equal(answerNoteOf({ label: 'x', provider: 'mock' }), null);
  assert.equal(undeclaredNoteOf([{ ...row, answered_by: null }, { ...row, label: 'panel-2-opus', lab: 'other', answered_by: null }]), '2 judge seats were answered by a session that declared no model the harness knows; their companies are shown as not known.');
  assert.equal(undeclaredNoteOf([{ ...row, answered_by: null }]), '1 judge seat was answered by a session that declared no model the harness knows; its company is shown as not known.');
  assert.equal(undeclaredNoteOf([row]), null);
});

test('PROBE prepare_stage_prompt over MCP: the bundle written for a seat that asks for subscription:opus-5.5 carries S3 once; the model comes from the header of the NEEDS file, not from the prompts', async () => {
  const work = mkdtempSync(join(tmpdir(), 'thc-answeredby-bundle-')); mkdirSync(join(work, 'tasks'), { recursive: true }); mkdirSync(join(work, 'chains'), { recursive: true });
  const base = JSON.parse(readFileSync(join(root, 'chains', 'mock-external.json'), 'utf8'));
  base.seats.builder = { provider: 'external', model: 'subscription:opus-5.5', lab: 'opus5.5-sub' };
  writeFileSync(join(work, 'chains', 'ab-bundle.json'), JSON.stringify({ ...base, name: 'ab-bundle' }));
  writeFileSync(join(work, 'tasks', 't.md'), '# A plan\n\nPlan a small note-taking app.\n');
  const p = spawnSync(process.execPath, [cli, '--chain', 'ab-bundle', '--task', 'tasks/t.md', '--max-usd', 'none'], { cwd: work, env: { PATH: process.env.PATH, HOME: work }, encoding: 'utf8' });
  assert.equal(p.status, 3, `${p.stdout}${p.stderr}`);
  const id = readdirSync(join(work, 'runs'))[0]; const dir = join(work, 'runs', id);
  const [r] = await mcp(work, [{ name: 'prepare_stage_prompt', arguments: { run: id } }], { name: 'probe', version: '1' });
  assert.ok(payload(r).written, JSON.stringify(payload(r)));
  const bundle = readFileSync(join(dir, 'stage_prompt.md'), 'utf8');
  assert.equal(bundle.split('This seat is asked for subscription:opus-5.5. If a different model answers, say so with answered_model.').length, 2, bundle.slice(-600));
  const [e] = await mcp(work, [{ name: 'external_prompt', arguments: { run: id } }], { name: 'probe', version: '1' });
  assert.equal(payload(e).prompt.split('This seat is asked for subscription:opus-5.5. If a different model answers, say so with answered_model.').length, 2, 'external_prompt returns the NEEDS file, which carries it once');
});

test('the NEEDS file of a real paused run carries S3 for a seat that asks for a model, and the pause is otherwise unchanged', () => {
  const work = mkdtempSync(join(tmpdir(), 'thc-answeredby-needs-')); mkdirSync(join(work, 'tasks'), { recursive: true }); mkdirSync(join(work, 'chains'), { recursive: true });
  const base = JSON.parse(readFileSync(join(root, 'chains', 'mock-external.json'), 'utf8'));
  base.seats.builder = { provider: 'external', model: 'subscription:opus-5.5', lab: 'opus5.5-sub' };
  writeFileSync(join(work, 'chains', 'ab-needs.json'), JSON.stringify({ ...base, name: 'ab-needs' }));
  writeFileSync(join(work, 'tasks', 't.md'), '# A plan\n\nPlan a small note-taking app.\n');
  const p = spawnSync(process.execPath, [cli, '--chain', 'ab-needs', '--task', 'tasks/t.md', '--max-usd', 'none'], { cwd: work, env: { PATH: process.env.PATH, HOME: work }, encoding: 'utf8' });
  assert.equal(p.status, 3, `${p.stdout}${p.stderr}`);
  const dir = join(work, 'runs', readdirSync(join(work, 'runs'))[0]);
  const need = readFileSync(join(dir, readdirSync(dir).find(f => /^NEEDS-.*\.md$/.test(f))), 'utf8');
  assert.match(need, /\n\nThis seat is asked for subscription:opus-5\.5\. If a different model answers, say so with answered_model\.\n\n## System prompt\n\n/);
  // the unmodified mock-external chain asks for no model: no sentence
  const w = pausedRun();
  assert.doesNotMatch(readFileSync(join(w.dir, `NEEDS-${w.stage}.md`), 'utf8'), /This seat is asked for/);
});

test('GOLDEN: a run folder written before this change (usage model claude-code-session, no answered_by) is read as it always was by spend and by the report assembly; the old and the new string stay two separate $0 rows', async () => {
  const runs = mkdtempSync(join(tmpdir(), 'thc-golden-')); const id = '2026-10-23T10-00-00-000Z';
  const dir = join(runs, id); mkdirSync(dir);
  writeFileSync(join(dir, 'build.md'), '# Plan\n');
  writeFileSync(join(dir, 'build.usage.json'), JSON.stringify({ provider: 'external', model: 'claude-code-session', usage: { input: 0, output: 12 }, usd: 0, ms: 0 }));
  const newId = '2026-10-23T11-00-00-000Z'; const nd = join(runs, newId); mkdirSync(nd);
  writeFileSync(join(nd, 'build.md'), '# Plan\n');
  writeFileSync(join(nd, 'build.usage.json'), JSON.stringify({ provider: 'external', model: 'session', answered_by: declaredAnswerer({ model: 'gpt-6.1' }), usage: { input: 0, output: 12 }, usd: 0, ms: 0 }));
  const rep = spendReport(runs, { days: 30, now: Date.parse('2026-10-23T20:00:00Z') });
  assert.equal(rep.totalUsd, 0); assert.equal(rep.count, 2);
  const day = costToday(runs, { date: new Date('2026-10-23T12:00:00Z'), now: Date.parse('2026-10-23T20:00:00Z') });   // the per-model breakdown is costToday's
  const rows = Object.fromEntries((day.perModel ?? []).map(r => [r.model, r.usd]));
  assert.deepEqual(Object.keys(rows).sort(), ['external/claude-code-session', 'external/session'], `two rows, no mapping between the names: ${JSON.stringify(day.perModel)}`);
  assert.equal(rows['external/claude-code-session'], 0); assert.equal(rows['external/session'], 0);
  setBudget(null);
  setCache(hitOf({ model: 'claude-code-session' }));
  const result = await runChain({ request: 'Req.', config: cfg(), log: () => {} });
  setCache(null);
  const report = reportJsonShape({ runId: 'g', chain: 'c', task: 't', result, config: cfg() });
  assert.ok(validate(report), JSON.stringify(validate.errors, null, 2));
  assert.equal(report.stages.find(s => s.label === 'build').model, 'claude-code-session', 'an old record keeps its string; nothing maps it');
  assert.equal(report.roster_answers.seats[0].status, 'not-declared');
});

test('END TO END (real verbs): a run paused at a seat that asks for subscription:opus-5.5, answered with a declared gpt-6.1, resumed by the CLI: S4 (the writer variant) is printed once, the run pauses at its external handoff, and after that answer report.json and BOARD.md carry the record and the outcome is not degraded', () => {
  const work = mkdtempSync(join(tmpdir(), 'thc-answeredby-e2e-')); mkdirSync(join(work, 'tasks'), { recursive: true }); mkdirSync(join(work, 'chains'), { recursive: true });
  const base = JSON.parse(readFileSync(join(root, 'chains', 'mock-external.json'), 'utf8'));
  base.seats.builder = { provider: 'external', model: 'subscription:opus-5.5', lab: 'opus5.5-sub' };
  base.seats.reviser = { provider: 'mock', model: 'mock-reviser-patch' };
  writeFileSync(join(work, 'chains', 'ab-e2e.json'), JSON.stringify({ ...base, name: 'ab-e2e' }));
  writeFileSync(join(work, 'tasks', 't.md'), '# A plan\n\nPlan a small note-taking app.\n');
  const env = { PATH: process.env.PATH, HOME: work };
  const p = spawnSync(process.execPath, [cli, '--chain', 'ab-e2e', '--task', 'tasks/t.md', '--max-usd', 'none'], { cwd: work, env, encoding: 'utf8' });
  assert.equal(p.status, 3, `${p.stdout}${p.stderr}`);
  const id = readdirSync(join(work, 'runs'))[0]; const dir = join(work, 'runs', id);
  submitStageAnswer(dir, 'build', '# Plan\n\nA small note-taking app, in four steps.\n', { declaredAnswer: declaredAnswerer({ clientInfo: { name: 'codex', version: '1' }, model: 'gpt-6.1' }) });
  const say = /!! ANSWERED BY A DIFFERENT MODEL: build is seated as subscription:opus-5\.5 and the answer says gpt-6\.1\. It is recorded as declared\./g;
  const r = spawnSync(process.execPath, [cli, '--resume', `runs/${id}`], { cwd: work, env, encoding: 'utf8' });
  const out = `${r.stdout}${r.stderr}`;
  assert.equal((out.match(say) || []).length, 1, `S4 once; exit ${r.status}\n${out.split('\n').slice(-14).join('\n')}`);
  assert.doesNotMatch(out, /Independence below/, 'a writer stage says the fact only');
  assert.equal(r.status, 3, 'the chain also seats an external handoff: it pauses there');
  assert.ok(readdirSync(dir).includes('NEEDS-handoff.md'), 'paused at handoff');
  // answer the handoff (it asks for the builder's model; none declared) and finish
  submitStageAnswer(dir, 'handoff', '# Handoff\n\nBuild it in four steps.\n', { declaredAnswer: declaredAnswerer({ clientInfo: { name: 'codex', version: '1' } }) });
  const done = spawnSync(process.execPath, [cli, '--resume', `runs/${id}`], { cwd: work, env, encoding: 'utf8' });
  const out2 = `${done.stdout}${done.stderr}`;
  assert.equal((out2.match(/ANSWERED BY A DIFFERENT MODEL/g) || []).length, 0, 'once per stage: the second resume does not repeat it');
  assert.equal(done.status, 0, out2.split('\n').slice(-14).join('\n'));
  assert.doesNotMatch(out2, /judge seat/, 'S5 counts judges: the mock panel has none unknown');
  const report = JSON.parse(readFileSync(join(dir, 'report.json'), 'utf8'));
  assert.ok(validate(report), JSON.stringify(validate.errors, null, 2));
  const byLabel = Object.fromEntries(report.roster_answers.seats.map(e => [e.label, e]));
  assert.equal(byLabel.build.status, 'different'); assert.equal(byLabel.build.panel, false);
  // the chain's `handoff: true` seat is the builder's seat, so it asks for subscription:opus-5.5 too; its answer declared a client but no model, and it is a writer stage
  assert.equal(byLabel.handoff.status, 'not-declared'); assert.equal(byLabel.handoff.panel, false); assert.equal(byLabel.handoff.asked_for, 'subscription:opus-5.5');
  assert.notEqual(report.outcome, 'degraded');
  const board = readFileSync(join(dir, 'BOARD.md'), 'utf8');
  assert.match(board, /## Who answered the session seats/);
  assert.match(board, /- handoff: seated as subscription:opus-5\.5; answered by codex 1 as not declared \(company not known\)/);
  assert.match(board, /Session seats whose company is not known: 0\./);
});
