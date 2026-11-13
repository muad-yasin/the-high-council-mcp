// 0.8.4 (Muad 8 Nov 2026: "A found secret pauses the run, it does not stop it"; C&C's scope word and rulings, unit "found-secret pause", commit 1).
// A credential-shaped string found in a prompt DURING a run pauses it: exit 11 and STOPPED-secret.md stay, a secret-stop/1 record is written beside them,
// run_status reads paused_secret / person_choice, and ONLY `--resume <run> --continue` (or --allow-secret-shaped on a resume) goes on. The person's consent
// attaches to a VALUE: run.json `secretAllow` holds an HMAC of each allowed value under a random per-run key. Offline ($0, mock chains); the CLI rows run
// the real command line; the MCP rows run a real stdio session (test/helpers/mcp-calls.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runResumability } from '../src/run-status.js';
import { readStoppedMarker, ROUND_STOPPED_STATE } from '../src/stop-files.js';
import { mcpCalls } from './helpers/mcp-calls.js';

// the modules this unit adds are loaded INSIDE each row, so on a tree without them every row fails by its own name (a static import would cancel the whole file)
const lib = async () => ({ ...(await import('../src/outbound-scan.js')), ...(await import('../src/secret-pause.js')) });
const SECRET_STOP_FILE = 'secret-stop.json';
// raw readers for the CLI and MCP rows: they need no new module, so on the old source those rows fail on the OLD BEHAVIOUR, not on a missing import
const recOf = dir => { try { return JSON.parse(readFileSync(join(dir, SECRET_STOP_FILE), 'utf8')); } catch { return null; } };
const freshRec = (dir, sinceMs) => { const r = recOf(dir); return r && Date.parse(r.at) >= sinceMs ? r : null; };
const SECRET_STOP_SCHEMA = 'secret-stop/1';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(root, 'src', 'cli.js');
const run = (dir, args) => spawnSync(process.execPath, [cli, ...args], { cwd: dir, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: dir }, timeout: 120_000 });
const KEY1 = ['sk', '-ant-api03-', 'Ab3dEf6hIj9kLm2nOp5qRs8tUv1wXy4zAb7d'].join(''); // synthetic, built here
const KEY2 = ['sk', '-ant-api03-', 'Zy9xWv8uTs7rQp6oNn5mLk4jIh3gFe2dCb1a'].join('');
const KEY1_ONE_CHAR = KEY1.slice(0, -1) + 'e';

const fresh = (task = 'Plan a small command-line tool that renames photos by the date they were taken.\n', args = []) => {
  const dir = mkdtempSync(join(tmpdir(), 'thc-sp-'));
  mkdirSync(join(dir, 'tasks'));
  writeFileSync(join(dir, 'tasks', 't.md'), task);
  const r = run(dir, ['--chain', 'mock-external', '--task', 'tasks/t.md', ...args]);
  assert.equal(r.status, 3, r.stderr);
  const id = readdirSync(join(dir, 'runs'))[0];
  const runDir = join(dir, 'runs', id);
  const pending = readdirSync(runDir).find(f => f.startsWith('NEEDS-')).slice('NEEDS-'.length, -'.md'.length);
  return { dir, id, runDir, pending };
};
// a run paused at a credential-shaped prompt: the builder's answer holds KEY1, so the first critic's prompt does
const paused = () => {
  const p = fresh();
  writeFileSync(join(p.runDir, `${p.pending}.md`), `# Plan\n\nUse ${KEY1} here.\n`);
  const r = run(p.dir, ['--resume', join('runs', p.id)]);
  assert.equal(r.status, 11, r.stderr);
  return { ...p, r };
};

// ---- the module: the match is on the VALUE ----------------------------------------------------------------------------------------------------------------------------------------------
test('SP-1 a value the person allowed passes in any prompt; a value with one changed character, or another key, pauses (the same function hashes both sides)', async () => {
  const L = await import('../src/outbound-scan.js');   // this row needs only the scan module, so on the old source it fails at the missing function, not at a missing file
  const key = L.newAllowKey();
  const allowed = { key, hashes: L.inputValueHashes([`The task holds ${KEY1} on purpose.`], key) };
  assert.ok(allowed.hashes.size >= 1);
  assert.equal(L.assertOutboundClean('critic-1', { system: 's', user: `the draft says ${KEY1}` }, { allowed }), 'consented');
  assert.equal(L.assertOutboundClean('revise-1', { system: `sys ${KEY1}`, user: 'u' }, { allowed }), 'consented', 'the same value in another stage and part passes');
  for (const other of [KEY1_ONE_CHAR, KEY2]) {
    assert.throws(() => L.assertOutboundClean('critic-1', { system: 's', user: `the draft says ${other}` }, { allowed }), e => e instanceof L.SecretShapedPrompt && e.valueHashes.length === 1 && /^[0-9a-f]{16}$/.test(e.stopId));
  }
  assert.throws(() => L.assertOutboundClean('critic-1', { system: 's', user: `${KEY1} and ${KEY2}` }, { allowed }), e => e instanceof L.SecretShapedPrompt && e.findings.length === 1, 'one open value of two still pauses, and only the open one is named');
  assert.equal(L.assertOutboundClean('x', { system: 's', user: 'nothing here' }, { allowed }), 'clean');
  assert.equal(L.assertOutboundClean('x', { system: 's', user: KEY1 }, { allow: true }), 'waived');
  assert.throws(() => L.assertOutboundClean('x', { system: 's', user: KEY1 }), L.SecretShapedPrompt, 'no allowed list: pauses');
  assert.notEqual(L.valueHashOf(L.newAllowKey(), KEY1), L.valueHashOf(L.newAllowKey(), KEY1), 'two runs\' keys give two hashes for one value');
});

test('SP-2 the pause record fails closed: missing, torn, another schema, no value hashes or a bad hash is NO record', async () => {
  const L = await lib();
  const dir = mkdtempSync(join(tmpdir(), 'thc-sp-rec-'));
  const whole = { schema: SECRET_STOP_SCHEMA, stop: L.secretStopIdOf('critic-1', 's', 'u'), label: 'critic-1', findings: [{ part: 'user', line: 3, name: 'anthropic' }], values: ['a'.repeat(32)], at: new Date().toISOString() };
  assert.equal(L.readSecretStop(dir), null, 'missing');
  const put = rec => writeFileSync(join(dir, SECRET_STOP_FILE), typeof rec === 'string' ? rec : JSON.stringify(rec));
  put(whole); assert.equal(L.readSecretStop(dir)?.label, 'critic-1');
  put(JSON.stringify(whole).slice(0, 60)); assert.equal(L.readSecretStop(dir), null, 'torn');
  put({ ...whole, schema: 'secret-stop/2' }); assert.equal(L.readSecretStop(dir), null, 'another schema');
  put({ ...whole, values: [] }); assert.equal(L.readSecretStop(dir), null, 'no value hashes');
  put({ ...whole, values: ['not-a-hash'] }); assert.equal(L.readSecretStop(dir), null, 'a bad hash');
  put({ ...whole, stop: 'zz' }); assert.equal(L.readSecretStop(dir), null, 'a bad stop id');
  put({ ...whole, at: '2020-01-01T00:00:00.000Z' }); assert.equal(L.readSecretStopSince(dir, Date.now()), null, 'a record older than the spawn is stale');
  put(whole); assert.equal(L.readSecretStopSince(dir, Date.now() - 60_000)?.label, 'critic-1');
});

// CHANGED ACCEPTED TEST (0.8.4 add-on removal, wave 2): OLD: SP-3 also built the end text of an advice call (L.secretAdviceEndText: no resume line, "ask for a new quote") and asserted it. NEW: only the pause text is asserted, on a seat label of a plain run (critic-1 instead of advise-x). WHY: secretAdviceEndText left src/secret-pause.js with the add-on (an advice call could not be resumed; nothing starts one now).
test('SP-3 the pause marker names --continue and the terminal-only sentence and claims nothing about a session with a shell', async () => {
  const L = await lib();
  const err = new L.SecretShapedPrompt('critic-1', [{ part: 'user', line: 2, name: 'anthropic' }], L.secretStopIdOf('critic-1', 's', 'u'), ['b'.repeat(32)]);
  assert.equal(typeof L.secretAdviceEndText, 'undefined', 'the advice call\'s end text is gone');
  const pause = L.secretPauseText(err, { runId: 'r1', command: 'council' });
  assert.match(pause, /Run paused/); assert.match(pause, /council --resume runs\/r1 --continue/); assert.match(pause, /Only the person answers this: at a terminal with a command above, or by telling the handling session/);   // MOVED BAR (Q9, 10 Nov 2026): old: /none of the Council's MCP tools can/
  assert.doesNotMatch(pause, /cannot answer this for you|personal data/i);
});

// ---- the command line -------------------------------------------------------------------------------------------------------------------------------------------------------------------
test('SP-4 a key shape found mid-run PAUSES: exit 11, the marker says paused, a whole record is written, no value is stored, run_status reads paused_secret / person_choice', async () => {
  const p = paused();
  const marker = readFileSync(join(p.runDir, 'STOPPED-secret.md'), 'utf8');
  assert.match(marker, /^# Run paused: a credential-shaped string in a prompt/);
  assert.match(marker, new RegExp(`--resume runs/${p.id} --continue`));
  assert.match(p.r.stderr + p.r.stdout, /PAUSED: stage "[^"]+": the prompt contains \d+ credential-shaped string/);
  const rec = recOf(p.runDir);
  assert.ok(rec && rec.schema === SECRET_STOP_SCHEMA && rec.values.length === 1 && rec.findings.length >= 1, 'a whole record: one value, at least one place');
  for (const f of ['STOPPED-secret.md', SECRET_STOP_FILE, 'run.json', 'run.log']) { if (existsSync(join(p.runDir, f))) assert.ok(!readFileSync(join(p.runDir, f), 'utf8').includes(KEY1), `${f} holds the value`); }
  for (const f of readdirSync(p.runDir).filter(x => /^stop-\d{4}\.json$/.test(x))) assert.ok(!readFileSync(join(p.runDir, f), 'utf8').includes(KEY1), `${f} holds the value`);
  assert.equal(readStoppedMarker(p.runDir), null, 'no STOPPED-<cause>.json marker: the handling session\'s stop_decide, the gate and a tree resume never see this pause');
  const s = runResumability(p.runDir, JSON.parse(readFileSync(join(p.runDir, 'run.json'), 'utf8')));
  assert.deepEqual([s.resumable, s.reason, s.needs], [true, 'paused_secret', 'person_choice']);
  // a folder from before this change (marker, no record) keeps the old reading
  writeFileSync(join(p.runDir, SECRET_STOP_FILE), '{');
  const old = runResumability(p.runDir, JSON.parse(readFileSync(join(p.runDir, 'run.json'), 'utf8')));
  assert.deepEqual([old.resumable, old.reason, old.needs], [true, 'secret_blocked', 'fix_cause']);
});

test('SP-5 --continue goes on: the paused stage is sent, the value is allowed in run.json and said on the terminal, the pause files are gone', async () => {
  const p = paused();
  const rec = recOf(p.runDir);
  const r = run(p.dir, ['--resume', join('runs', p.id), '--continue']);
  assert.notEqual(r.status, 11, r.stderr); assert.notEqual(r.status, 2, r.stderr);
  const meta = JSON.parse(readFileSync(join(p.runDir, 'run.json'), 'utf8'));
  assert.ok(/^[0-9a-f]{32}$/.test(meta.secretAllow?.key) && rec.values.every(v => meta.secretAllow.hashes.includes(v)), 'the paused value is on the allowed list');
  assert.equal(existsSync(join(p.runDir, 'STOPPED-secret.md')), false); assert.equal(existsSync(join(p.runDir, SECRET_STOP_FILE)), false);
  assert.ok(existsSync(join(p.runDir, `${rec.label}.md`)), 'the paused stage was sent once and its answer is on disk');
  // control for SP-15's sibling check: a plain continue DOES send the paused stage's round siblings, so their absence under a finish means something
  const prefix = rec.label.replace(/-[^-]*$/, '-');
  assert.ok(readdirSync(p.runDir).some(x => x.startsWith(prefix) && x.endsWith('.md') && x !== `${rec.label}.md` && x !== 'STOPPED-secret.md'), `a sibling of ${rec.label} (${prefix}*) was sent under a plain --continue`);
  assert.match(r.stdout, new RegExp(`stage "${rec.label}": you allowed the credential-shaped value\\(s\\) it found \\(\\d+\\)`));
});

test('SP-6 --continue with a torn or missing record is refused with nothing recorded or sent (fails closed), and says how to get the record', async () => {
  const p = paused();
  const before = readFileSync(join(p.runDir, 'run.json'), 'utf8');
  writeFileSync(join(p.runDir, SECRET_STOP_FILE), '{"schema":"secret-stop/1"');
  const r = run(p.dir, ['--resume', join('runs', p.id), '--continue']);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /pause record \(secret-stop\.json\) is missing or cannot be read/); assert.match(r.stderr, /once without a choice/);
  assert.equal(JSON.parse(readFileSync(join(p.runDir, 'run.json'), 'utf8')).secretAllow?.hashes?.length ?? 0, JSON.parse(before).secretAllow?.hashes?.length ?? 0, 'nothing allowed');
  assert.ok(existsSync(join(p.runDir, 'STOPPED-secret.md')), 'still paused');
  // every other shape of a record that is not a whole secret-stop/1 file is refused the same way, and nothing is allowed
  const good = JSON.parse(readFileSync(join(p.runDir, 'run.json'), 'utf8'));
  for (const bad of ['', '[]', JSON.stringify({ schema: 'secret-stop/2', stop: 'a1b2c3d4e5f60718', label: 'x', findings: [], values: ['e'.repeat(32)], at: new Date().toISOString() }), JSON.stringify({ schema: SECRET_STOP_SCHEMA, stop: 'a1b2c3d4e5f60718', label: 'x', findings: [], values: [], at: new Date().toISOString() })]) {
    writeFileSync(join(p.runDir, SECRET_STOP_FILE), bad);
    const rr = run(p.dir, ['--resume', join('runs', p.id), '--continue']);
    assert.equal(rr.status, 2, `record ${JSON.stringify(bad).slice(0, 40)}: ${rr.stderr}`);
    assert.match(rr.stderr, /pause record \(secret-stop\.json\) is missing or cannot be read/);
  }
  assert.equal(JSON.parse(readFileSync(join(p.runDir, 'run.json'), 'utf8')).secretAllow?.hashes?.length ?? 0, good.secretAllow?.hashes?.length ?? 0, 'still nothing allowed');
  rmSync(join(p.runDir, SECRET_STOP_FILE));
  const none = run(p.dir, ['--resume', join('runs', p.id), '--continue']);
  assert.equal(none.status, 2); assert.match(none.stderr, /pause record/);
  // the way the sentence names: a plain resume pauses again at the same place and writes the record; then --continue works
  assert.equal(run(p.dir, ['--resume', join('runs', p.id)]).status, 11);
  assert.ok(recOf(p.runDir));
  assert.notEqual(run(p.dir, ['--resume', join('runs', p.id), '--continue']).status, 11);
});

test('SP-7 --continue and --allow-secret-shaped together are refused; --allow-secret-shaped alone on a resume is the same choice', async () => {
  const p = paused();
  const both = run(p.dir, ['--resume', join('runs', p.id), '--continue', '--allow-secret-shaped']);
  assert.equal(both.status, 2); assert.match(both.stderr, /the same choice: give one/);
  const flag = run(p.dir, ['--resume', join('runs', p.id), '--allow-secret-shaped']);
  assert.notEqual(flag.status, 11, flag.stderr);
  const meta = JSON.parse(readFileSync(join(p.runDir, 'run.json'), 'utf8'));
  assert.ok(meta.secretAllow.hashes.length >= 1);
  assert.notEqual(meta.allowSecretShaped, true, 'the flag that answered a pause is not saved as a start flag (the run stays resumable over MCP and its input scan stays on)');
});

test('SP-8 a start flag allows the values the INPUTS hold and nothing else: a later, different value pauses (the saved blanket is gone)', async () => {
  const p = fresh(`Plan a tool. The service key is ${KEY1}, keep it out of the plan.\n`, ['--allow-secret-shaped']);   // the builder's NEEDS file holds the task's key and was not refused
  const meta = JSON.parse(readFileSync(join(p.runDir, 'run.json'), 'utf8'));
  assert.equal(meta.allowSecretShaped, true); assert.ok(meta.secretAllow.hashes.length >= 1, 'the task\'s value is on the list');
  assert.ok(!JSON.stringify(meta).includes(KEY1), 'no value in run.json');
  writeFileSync(join(p.runDir, `${p.pending}.md`), `# Plan\n\nUse ${KEY2} here.\n`);   // a NEW value from the model's answer
  const r = run(p.dir, ['--resume', join('runs', p.id)]);                                  // no flag typed
  assert.equal(r.status, 11, r.stderr);
  assert.equal(readFileSync(join(p.runDir, 'STOPPED-secret.md'), 'utf8').startsWith('# Run paused'), true);
  const rec = recOf(p.runDir);
  assert.equal(rec.values.length, 1, 'only the new value is named: the task\'s own key is not');
});

test('SP-8b one changed character is a different value: the start flag allowed KEY1, the model writes KEY1 with its last character changed, the run pauses', () => {
  const p = fresh(`Plan a tool. The service key is ${KEY1}, keep it out of the plan.\n`, ['--allow-secret-shaped']);
  writeFileSync(join(p.runDir, `${p.pending}.md`), `# Plan\n\nUse ${KEY1_ONE_CHAR} here.\n`);
  const r = run(p.dir, ['--resume', join('runs', p.id)]);
  assert.equal(r.status, 11, r.stderr);
  assert.equal(recOf(p.runDir)?.values.length, 1, 'only the changed value is open');
});

test('SP-13 a run STARTED with the flag that pauses on a new value is answered by the flag on the resume, as the help says (one choice, not two): the new value is allowed, the task\'s own stays allowed', () => {
  const p = fresh(`Plan a tool. The service key is ${KEY1}, keep it out of the plan.\n`, ['--allow-secret-shaped']);
  writeFileSync(join(p.runDir, `${p.pending}.md`), `# Plan\n\nUse ${KEY2} here.\n`);
  assert.equal(run(p.dir, ['--resume', join('runs', p.id)]).status, 11);          // saved flag, new value: pauses
  const rec = recOf(p.runDir);
  const r = run(p.dir, ['--resume', join('runs', p.id), '--allow-secret-shaped']);
  assert.notEqual(r.status, 11, 'the flag answered the pause: ' + r.stderr); assert.notEqual(r.status, 2, r.stderr);
  const meta = JSON.parse(readFileSync(join(p.runDir, 'run.json'), 'utf8'));
  assert.ok(rec.values.every(v => meta.secretAllow.hashes.includes(v)), 'the new value is on the list');
  assert.equal(meta.allowSecretShaped, true, 'the start flag stays as the run was started');
});

// ---- c2: --finish at a pause (F-C): the choice is recorded and the run stays paused; --continue ends the loop at the paused stage and the ordinary not-agreed ending runs ------------------
// A chain whose ending makes no external call, so the finished run is a report.json: mock-external with its handoff off (the builder and reviser stay external: that is how a key gets into a prompt).
const finishProject = (extra = {}, critics = null) => {
  const dir = mkdtempSync(join(tmpdir(), 'thc-spf-'));
  mkdirSync(join(dir, 'tasks')); mkdirSync(join(dir, 'chains'));
  writeFileSync(join(dir, 'tasks', 't.md'), 'Plan a small command-line tool that renames photos by the date they were taken.\n');
  const base = JSON.parse(readFileSync(join(root, 'chains', 'mock-external.json'), 'utf8'));
  writeFileSync(join(dir, 'chains', 'ext-finish.json'), JSON.stringify({ ...base, name: 'ext-finish', handoff: false, ...extra, ...(critics ? { seats: { ...base.seats, critics } } : {}) }));
  const r = run(dir, ['--chain', 'ext-finish', '--task', 'tasks/t.md']);
  assert.equal(r.status, 3, r.stderr + r.stdout);
  const id = readdirSync(join(dir, 'runs'))[0];
  const runDir = join(dir, 'runs', id);
  const pending = readdirSync(runDir).find(f => f.startsWith('NEEDS-')).slice('NEEDS-'.length, -'.md'.length);
  writeFileSync(join(runDir, `${pending}.md`), `# Plan\n\nUse ${KEY1} here.\n`);
  const p = run(dir, ['--resume', join('runs', id)]);
  assert.equal(p.status, 11, p.stderr + p.stdout);
  return { dir, id, runDir, pending, p };
};
const metaOf = runDir => JSON.parse(readFileSync(join(runDir, 'run.json'), 'utf8'));

test('SP-14 --finish only RECORDS: exit 11, nothing sent, the run stays paused, run.json holds the entry, run_status says paused_secret / person_choice with choice finish; the marker offers --finish with the ending\'s words and cost', () => {
  const f = finishProject();
  const rec = recOf(f.runDir);
  assert.equal(rec.phase, 'loop', 'the pause came inside the review rounds');
  const marker = readFileSync(join(f.runDir, 'STOPPED-secret.md'), 'utf8');
  assert.match(marker, new RegExp(`--resume runs/${f.id} --finish`));
  assert.match(marker, /nothing is sent until you also give --continue/);
  const stagesBefore = readdirSync(f.runDir).filter(x => /\.(md|usage\.json)$/.test(x) && x !== 'STOPPED-secret.md').sort().join(',');
  const r = run(f.dir, ['--resume', join('runs', f.id), '--finish']);
  assert.equal(r.status, 11, r.stderr + r.stdout);
  assert.match(r.stdout, new RegExp(`--finish recorded for stage "${rec.label}"`));
  assert.deepEqual({ ...metaOf(f.runDir).secretFinish, at: 0 }, { choice: 'finish', label: rec.label, stop: rec.stop, at: 0, via: 'cli' });   // FINDING (not on the owed list of the ladder unit; the first box run, 10 Nov 2026. OLD: { choice, label, at, via }. NEW: the entry also names the pause's own stop id, so a later sitting can check a relayed mark against the ledger
  const stageFiles = d => readdirSync(d).filter(x => /\.(md|usage\.json)$/.test(x) && x !== 'STOPPED-secret.md').sort().join(',');
  assert.equal(stageFiles(f.runDir), stagesBefore, 'no stage file was added: nothing ran');
  assert.ok(existsSync(join(f.runDir, 'STOPPED-secret.md')) && existsSync(join(f.runDir, SECRET_STOP_FILE)), 'the pause files stay');
  const s = runResumability(f.runDir, metaOf(f.runDir));
  assert.deepEqual([s.resumable, s.reason, s.needs, s.choice], [true, 'paused_secret', 'person_choice', 'finish']);
});

test('SP-15 after a recorded --finish, --continue ends the loop AT the paused stage: it is never sent, the not-agreed ending runs, report.json carries stop.kind secret_pause and the label; a plain resume in between re-pauses and keeps the entry', () => {
  const f = finishProject();
  const rec = recOf(f.runDir);
  assert.equal(run(f.dir, ['--resume', join('runs', f.id), '--finish']).status, 11);
  assert.equal(run(f.dir, ['--resume', join('runs', f.id)]).status, 11, 'a plain resume pauses again');
  assert.equal(metaOf(f.runDir).secretFinish.label, rec.label, 'and keeps the finish');
  const r = run(f.dir, ['--resume', join('runs', f.id), '--continue']);
  assert.notEqual(r.status, 11, r.stderr + r.stdout); assert.notEqual(r.status, 2, r.stderr + r.stdout);
  assert.match(r.stdout + readFileSync(join(f.runDir, 'run.log'), 'utf8'), /finishing at the person's choice: the run was paused at a credential-shaped string in stage/);
  assert.ok(!existsSync(join(f.runDir, `${rec.label}.md`)) && !existsSync(join(f.runDir, `${rec.label}.usage.json`)), 'the paused stage was never sent');
  const roundPrefix = rec.label.replace(/-[^-]*$/, '-');   // the seat part of the label dropped: its siblings in the same wave share the rest
  assert.ok(readdirSync(f.runDir).some(x => x.startsWith('NEEDS-') || x.startsWith('criteria') || x.startsWith('build')), 'the folder holds the earlier stages (the prefix check below is not vacuous)');
  assert.ok(!readdirSync(f.runDir).some(x => x.startsWith(roundPrefix) && x.endsWith('.md') && x !== 'STOPPED-secret.md'), `no sibling of ${rec.label} (${roundPrefix}*) was sent`);
  const report = JSON.parse(readFileSync(join(f.runDir, 'report.json'), 'utf8'));
  assert.equal(report.passed, false);
  assert.equal(report.stop?.kind, 'secret_pause'); assert.equal(report.stop.label, rec.label);
  // what a person reads: the terminal verdict line, the board and run_status name the cause (nobody reviewed this pass, so "open objections" would be false)
  assert.match(r.stdout + readFileSync(join(f.runDir, 'run.log'), 'utf8'), new RegExp(`verdict:  finished at the person's choice at a credential-shaped pause in stage "${rec.label}", NOT agreement: the review of this pass did not run`));
  assert.match(readFileSync(join(f.runDir, 'BOARD.md'), 'utf8'), /## Not agreed: finished at a credential-shaped pause/);
  // the partial state: the pass was cut off inside its panel phase, so it is NOT reviewed, and the ending ran on the draft as built (no revise happened, no pass was counted)
  assert.equal(report.stop.reviewed, 'none'); assert.equal(report.stop.pass, 1); assert.equal(report.stop.overseer_round, 0);
  assert.ok(!readdirSync(f.runDir).some(x => /^revise-/.test(x) && x.endsWith('.md')), 'no revise ran');
  assert.equal(report.signoff, null, 'no sign-off was recorded for the cut-off pass: pass 1 never wrote one');
  assert.equal(report.stop.asked_layers, undefined, 'an unlayered chain names no layers');
});

test('SP-16 --finish is refused where there is no review to end or the run is already ending, with the flag, and for a record that does not say where the pause came; nothing is recorded', () => {
  const f = finishProject();
  const rec = recOf(f.runDir);
  const write = over => writeFileSync(join(f.runDir, SECRET_STOP_FILE), JSON.stringify({ ...rec, ...over }));
  const ask = args => run(f.dir, ['--resume', join('runs', f.id), ...args]);
  write({ phase: 'before' }); let r = ask(['--finish']);
  assert.equal(r.status, 2); assert.match(r.stderr, /came before the review rounds began, so there is no review to end/);
  write({ phase: 'after' }); r = ask(['--finish']);
  assert.equal(r.status, 2); assert.match(r.stderr, /came after the review rounds, so the run is already ending/);
  const { phase, ...c1record } = rec; writeFileSync(join(f.runDir, SECRET_STOP_FILE), JSON.stringify(c1record)); r = ask(['--finish']);
  assert.equal(r.status, 2); assert.match(r.stderr, /does not say where in the run the pause came/);
  write({}); r = ask(['--finish', '--allow-secret-shaped']);
  assert.equal(r.status, 2); assert.match(r.stderr, /two different choices/);
  assert.equal(metaOf(f.runDir).secretFinish, undefined, 'nothing was recorded');
  assert.ok(existsSync(join(f.runDir, 'STOPPED-secret.md')), 'still paused');
});

test('SP-17 a recorded finish that is torn or names another stage REFUSES --continue (going on with the review would send more than the person chose); an absent one is the c1 --continue', () => {
  const f = finishProject();
  const rec = recOf(f.runDir);
  for (const bad of ['broken', { choice: 'finish' }, { choice: 'finish', label: 'some-other-stage', at: new Date().toISOString(), via: 'cli' }, { choice: 'continue', label: rec.label, at: new Date().toISOString() }]) {
    const m = metaOf(f.runDir); m.secretFinish = bad; writeFileSync(join(f.runDir, 'run.json'), JSON.stringify(m));
    const r = run(f.dir, ['--resume', join('runs', f.id), '--continue']);
    assert.equal(r.status, 2, `${JSON.stringify(bad)}: ${r.stderr}`); assert.match(r.stderr, /the finish recorded in run\.json \(secretFinish\) is unreadable or names another stage/);
    assert.ok(!existsSync(join(f.runDir, `${rec.label}.md`)), 'nothing was sent');
  }
  const m = metaOf(f.runDir); delete m.secretFinish; writeFileSync(join(f.runDir, 'run.json'), JSON.stringify(m));
  const r = run(f.dir, ['--resume', join('runs', f.id), '--continue']);
  assert.notEqual(r.status, 11, r.stderr); assert.notEqual(r.status, 2, r.stderr);
});

test('SP-18 (T9f) on a layered chain (the final read is part of every layered run): --finish alone makes NO layer-3 call and sends nothing; the --continue that follows runs the closing read for the layer-3 seats that have not read this plan, then the not-agreed ending', () => {
  const critics = [
    { provider: 'mock', model: 'mock-critic-a', lab: 'l1', layer: 1 }, { provider: 'mock', model: 'mock-critic-b', lab: 'l2', layer: 2 },
    { provider: 'mock', model: 'mock-critic-a', lab: 'l3a', layer: 3 }, { provider: 'mock', model: 'mock-critic-b', lab: 'l3b', layer: 3 },
  ];
  const f = finishProject({}, critics);   // 0.8.4 S16: the final read has no switch (the key is refused by the lint)
  assert.equal(recOf(f.runDir).phase, 'loop');
  const r1 = run(f.dir, ['--resume', join('runs', f.id), '--finish']);
  assert.equal(r1.status, 11, r1.stderr + r1.stdout);
  assert.ok(!readdirSync(f.runDir).some(x => /^final-read-/.test(x)), 'no layer-3 call before the person continues');
  const r2 = run(f.dir, ['--resume', join('runs', f.id), '--continue']);
  assert.notEqual(r2.status, 11, r2.stderr + r2.stdout); assert.notEqual(r2.status, 2, r2.stderr + r2.stdout);
  const report = JSON.parse(readFileSync(join(f.runDir, 'report.json'), 'utf8'));
  assert.equal(report.stop?.kind, 'secret_pause');
  assert.equal(report.final_read?.ran, true, 'the closing read ran, after the continue');
  assert.equal(report.final_read.seats.length, 2, 'one call for each layer-3 seat that had not read this plan');
  // the partial state of a layered pass cut off at its FIRST layer: that layer ends `unfinished` (it was asked, and its call did not finish), the layers above it were never reached; the verdict words and the finish clause never say a layer "did not sign off" (the board's own generic labels do, below)
  assert.equal(report.stop.reviewed, 'part'); assert.deepEqual(report.stop.asked_layers, []); assert.deepEqual(report.stop.cut_layers, [1]); assert.deepEqual(report.stop.not_asked_layers, [2, 3]);
  const passOne = (report.layers ?? []).filter(r => r.round === 1).sort((a, b) => a.layer - b.layer);
  assert.deepEqual(passOne.map(r => [r.layer, r.state]), [[1, 'unfinished'], [2, 'not_asked'], [3, 'not_asked']], `the cut-off pass keeps its rows: ${JSON.stringify(passOne.map(r => r.state))}`);
  const board = readFileSync(join(f.runDir, 'BOARD.md'), 'utf8');
  assert.match(board, /## Not agreed: finished at a credential-shaped pause/); assert.match(board, /layer 1 was cut off in this pass and layers 2 and 3 were not asked/); assert.doesNotMatch(board, /layer \d did not sign off/i);   // the generic "Not accepted: the panel did not sign off" label of any unsigned run is on the board too; the claim here is about a LAYER
});

test('SP-19 (pure) the finish words follow what was asked: all = this pass was reviewed and its revise did not run; part = the layers asked and the layers not asked, by number; none = no layer was asked (layered) or the review did not run (unlayered); not a secret_pause stop or a passed run = null', async () => {
  const { secretFinishWords, finishedAtStopWords } = await import('../src/verdict-headline.js');
  const say = x => `finished at the person's choice at a credential-shaped pause in stage "critic-2", NOT agreement: ${x}`;
  const stop = over => ({ passed: false, stop: { kind: 'secret_pause', pass: 2, overseer_round: 1, label: 'critic-2', chosen: 'finish', ...over } });
  assert.equal(secretFinishWords(stop({ reviewed: 'all' })), say('this pass was reviewed and its revise did not run'));
  assert.equal(secretFinishWords(stop({ reviewed: 'signed' })), say('every layer signed off in this pass and the build check was not asked'));
  assert.equal(secretFinishWords(stop({ reviewed: 'part', asked_layers: [1], not_asked_layers: [2, 3] })), say('layer 1 was asked in this pass and layers 2 and 3 were not asked'));
  assert.equal(secretFinishWords(stop({ reviewed: 'part', asked_layers: [1, 2], not_asked_layers: [3] })), say('layers 1 and 2 were asked in this pass and layer 3 was not asked'));
  assert.equal(secretFinishWords(stop({ reviewed: 'none', asked_layers: [], cut_layers: [], not_asked_layers: [1, 2, 3] })), say('no layer was asked in this pass'));
  const part = (asked, cut, notAsked) => stop({ reviewed: 'part', asked_layers: asked, cut_layers: cut, not_asked_layers: notAsked });
  assert.equal(secretFinishWords(part([1], [2], [3])), say('layer 1 was asked in this pass, layer 2 was cut off and layer 3 was not asked'));
  assert.equal(secretFinishWords(part([], [2], [3])), say('layer 2 was cut off in this pass and layer 3 was not asked'));
  assert.equal(secretFinishWords(part([], [1], [2, 3])), say('layer 1 was cut off in this pass and layers 2 and 3 were not asked'));
  assert.equal(secretFinishWords(part([1, 2], [3], [])), say('layers 1 and 2 were asked in this pass and layer 3 was cut off'));
  assert.equal(secretFinishWords(part([], [2], [])), say('layer 2 was cut off in this pass'));
  assert.equal(secretFinishWords(stop({ reviewed: 'none' })), say('the review of this pass did not run'));
  assert.equal(secretFinishWords({ ...stop({ reviewed: 'all' }), passed: true }), null); assert.equal(secretFinishWords({ passed: false, stop: { kind: 'overseer_cap' } }), null); assert.equal(secretFinishWords({}), null);
  assert.equal(finishedAtStopWords({ ...stop({ reviewed: 'part', asked_layers: [1], not_asked_layers: [2, 3] }), layers: [{ round: 2, layer: 3, state: 'not_asked' }] }), null, 'one banner: the secret-finish words carry the review state, never a second "did not sign off"');
});

test('SP-20 (T9f-shaped, layered) a pause that comes AFTER layer 1 answered: --finish then --continue keeps layer 1\'s answer on the record, leaves layers 2 and 3 not_asked, names them in the words and ends with the closing read', () => {
  // The mid-panel cut is made without a key: a finished mock run is rewound to a crashed one (the report and every stage from layer 2 on removed), so layer 1 replays from disk and the first call that misses
  // the cache is layer 2's. The pause record and the finish entry are then written as the CLI writes them.
  const dir = mkdtempSync(join(tmpdir(), 'thc-sp20-'));
  mkdirSync(join(dir, 'tasks')); mkdirSync(join(dir, 'chains'));
  writeFileSync(join(dir, 'tasks', 't.md'), 'Plan a small command-line tool that renames photos by the date they were taken.\n');
  const base = JSON.parse(readFileSync(join(root, 'chains', 'mock-external.json'), 'utf8'));
  const critics = [
    { provider: 'mock', model: 'mock-critic-script-o-sp20', lab: 'l1', layer: 1 }, { provider: 'mock', model: 'mock-critic-script-o-sp20', lab: 'l2', layer: 2 },
    { provider: 'mock', model: 'mock-critic-script-o-sp20', lab: 'l3a', layer: 3 }, { provider: 'mock', model: 'mock-critic-script-o-sp20', lab: 'l3b', layer: 3 },
  ];
  writeFileSync(join(dir, 'chains', 'lay-finish.json'), JSON.stringify({ ...base, name: 'lay-finish', handoff: false, seats: { ...base.seats, builder: { provider: 'mock', model: 'mock-builder', lab: 'author' }, reviser: { provider: 'mock', model: 'mock-builder', lab: 'author' }, critics } }));
  const first = run(dir, ['--chain', 'lay-finish', '--task', 'tasks/t.md']);
  assert.ok(first.status === 0 || first.status === 22, first.stderr + first.stdout);
  const id = readdirSync(join(dir, 'runs'))[0]; const runDir = join(dir, 'runs', id);
  const l2 = readdirSync(runDir).find(x => /^panel-1-.*l2.*\.md$/.test(x)); assert.ok(l2, `a layer-2 panel stage exists: ${readdirSync(runDir).join(' ')}`);
  const label = l2.replace(/\.md$/, '');
  const AFTER = /^(panel|ldebate|lreply|rule|revise|critique|conflict|allocator|final|dispute|handoff|cold|challenge|ending|deep)/;
  for (const x of readdirSync(runDir)) if ((AFTER.test(x) && !/^panel-1-.*l1/.test(x)) || ['report.json', 'deliverable.md', 'BOARD.md', 'HANDOFF.md', 'state.json'].includes(x)) rmSync(join(runDir, x), { force: true });
  const at = new Date().toISOString();
  writeFileSync(join(runDir, 'STOPPED-secret.md'), '# Run paused: a credential-shaped string in a prompt\n');
  writeFileSync(join(runDir, SECRET_STOP_FILE), JSON.stringify({ schema: SECRET_STOP_SCHEMA, stop: 'a1b2c3d4e5f60718', label, phase: 'loop', findings: [{ part: 'user', line: 1, name: 'anthropic' }], values: ['f'.repeat(32)], at }));
  const m = metaOf(runDir); m.secretFinish = { choice: 'finish', label, at, via: 'cli' }; writeFileSync(join(runDir, 'run.json'), JSON.stringify(m));
  const r = run(dir, ['--resume', join('runs', id), '--continue']);
  assert.notEqual(r.status, 11, r.stderr + r.stdout); assert.notEqual(r.status, 2, r.stderr + r.stdout);
  const report = JSON.parse(readFileSync(join(runDir, 'report.json'), 'utf8'));
  assert.equal(report.stop.kind, 'secret_pause'); assert.equal(report.stop.reviewed, 'part');
  assert.deepEqual(report.stop.asked_layers, [1]); assert.deepEqual(report.stop.cut_layers, [2]); assert.deepEqual(report.stop.not_asked_layers, [3]);
  const rows = (report.layers ?? []).filter(x => x.round === 1).sort((a, b) => a.layer - b.layer);
  assert.deepEqual(rows.map(x => [x.layer, x.state]), [[1, 'signed_off'], [2, 'unfinished'], [3, 'not_asked']], 'layer 1 answered and recorded; the layer cut off is unfinished; the layer never reached stays not_asked');
  assert.ok((report.panelVerdicts ?? report.signoff ?? []).length > 0, 'layer 1\'s answer is on the record');
  assert.match(readFileSync(join(runDir, 'BOARD.md'), 'utf8'), /layer 1 was asked in this pass, layer 2 was cut off and layer 3 was not asked/);
  assert.equal(report.final_read?.ran, true, 'the closing read ran, after the continue');
});

// ---- the MCP surface --------------------------------------------------------------------------------------------------------------------------------------------------------------------
const toolResult = r => { const t = r?.result?.content?.[0]?.text; try { return JSON.parse(t); } catch { return { text: t, isError: r?.result?.isError }; } };
test('SP-9 over MCP, on a folder at rest: run_status reads the waiting state; stop_decide QUOTES a secret pause through the person-only gate (MOVED BAR, Q9, 10 Nov 2026: it used to refuse it with "Only a command typed at a terminal answers it" and open no gate)', async () => {
  const p = paused();
  const out = await mcpCalls(p.dir, [{ name: 'run_status', arguments: { run: p.id } }, { name: 'stop_decide', arguments: { run: p.id, step: 'quote' } }], { timeoutMs: 120_000 });
  const st = toolResult(out.get(2));
  assert.equal(st.state, ROUND_STOPPED_STATE);
  const sd = out.get(3)?.result?.content?.[0]?.text ?? '';
  const q = JSON.parse(sd);
  assert.equal(q.person_only, true, `stop_decide quotes the pause as the person's alone: ${sd.slice(0, 300)}`); assert.match(q.text, /Choices: continue/); assert.match(q.stop_id, /^secret_pause:[0-9a-f]{16}$/);
  assert.ok(existsSync(join(p.runDir, 'STOPPED-secret.md')) && recOf(p.runDir), 'still paused: a quote decides nothing');
});
test('SP-10 the MCP spawn sites\' decision, pure: exit 11 plus a record written at or after the spawn is a pause; a stale record, no record, a torn record, another exit code and a child still running are not', async () => {
  const L = await lib();
  const dir = mkdtempSync(join(tmpdir(), 'thc-sp-end-'));
  const rec = { schema: SECRET_STOP_SCHEMA, stop: L.secretStopIdOf('critic-1', 's', 'u'), label: 'critic-1', findings: [], values: ['c'.repeat(32)], at: new Date(Date.now() + 5).toISOString() };
  const spawnedAt = Date.now() - 1000;
  assert.equal(L.secretPauseAfterExit(dir, { code: 11 }, spawnedAt), null, 'no record: a PRE-RUN refusal stays "never started"');
  writeFileSync(join(dir, SECRET_STOP_FILE), JSON.stringify(rec));
  assert.equal(L.secretPauseAfterExit(dir, { code: 11 }, spawnedAt)?.label, 'critic-1');
  assert.equal(L.secretPauseAfterExit(dir, { code: 11 }, Date.now() + 60_000), null, 'a record older than the spawn is a stale one');
  assert.equal(L.secretPauseAfterExit(dir, { code: 3 }, spawnedAt), null); assert.equal(L.secretPauseAfterExit(dir, { code: 1 }, spawnedAt), null); assert.equal(L.secretPauseAfterExit(dir, null, spawnedAt), null);
  writeFileSync(join(dir, SECRET_STOP_FILE), '{"schema":');
  assert.equal(L.secretPauseAfterExit(dir, { code: 11 }, spawnedAt), null, 'a torn record');
});
test('SP-11 over MCP a plain resume of a paused folder re-pauses and is reported as resumed, never as "resumed:false" for a run that ran; the folder ends paused again', async () => {
  const p = paused();
  const started = Date.now();
  const out = await mcpCalls(p.dir, [{ name: 'resume_run', arguments: { run: p.id } }], { timeoutMs: 120_000 });
  const r = toolResult(out.get(2));
  assert.equal(r.resumed, true, JSON.stringify(r).slice(0, 300));
  assert.ok(r.state === ROUND_STOPPED_STATE || r.state === 'running', `state ${r.state}`);
  if (r.state === ROUND_STOPPED_STATE) { assert.equal(r.exitCode, 11); assert.match(r.stop, /Only the person answers this: at a terminal with a command above, or by telling the handling session/); }   // MOVED BAR (Q9): old /none of the Council's MCP tools can/
  // the child is detached: wait for the fresh record (the MCP call may return before the replay has paused again)
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline && !freshRec(p.runDir, started)) await new Promise(res => setTimeout(res, 500));
  assert.ok(freshRec(p.runDir, started), 'the resume paused again and wrote a fresh record');
  assert.equal(r.started, undefined);
});
test('SP-12 over MCP a PRE-RUN refusal (exit 11, no record) stays "never started"', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'thc-sp-pre-'));
  mkdirSync(join(dir, 'tasks'));
  writeFileSync(join(dir, 'tasks', 't.md'), `Plan a tool. The key is ${KEY1}.\n`);
  const out = await mcpCalls(dir, [{ name: 'start_run', arguments: { chain: 'mock-external', task: 'tasks/t.md' } }], { timeoutMs: 120_000 });
  const r = toolResult(out.get(2));
  assert.equal(r.started, false); assert.equal(r.exitCode, 11);
});

test('SP-21 (pure) the dissent digest of a run finished at a pause in pass 1 with no layer asked says no verdict of the panel counts (no "panel disagreed on nothing"), makes no model call; any other report keeps the old template', async () => {
  const { deriveDissentSummary, renderDigestTemplate, generateDigestText } = await import('../src/dissent-digest.js');
  const none = { outcome: 'no_consensus', disagreement_groups: [], stop: { kind: 'secret_pause', pass: 1, reviewed: 'none', label: 'critic-1', chosen: 'finish' } };
  const text = renderDigestTemplate(deriveDissentSummary(none));
  const WORDS = "No verdict of the panel counts: the run was finished at the person's choice at a credential-shaped pause in the first pass, before the review of the plan was complete.";
  assert.equal(text, WORDS);
  const cutFirst = { ...none, stop: { ...none.stop, reviewed: 'part', asked_layers: [], cut_layers: [1], not_asked_layers: [2, 3] } };
  assert.equal(renderDigestTemplate(deriveDissentSummary(cutFirst)), WORDS, 'a first layer that was cut off left no verdict that counts: same sentence');
  const oneAsked = { ...none, stop: { ...none.stop, reviewed: 'part', asked_layers: [1], cut_layers: [2], not_asked_layers: [3] } };
  assert.match(renderDigestTemplate(deriveDissentSummary(oneAsked)), /^The panel disagreed on:/, 'a pass in which a layer answered keeps the old template');
  let calls = 0;
  assert.equal(await generateDigestText({ report: none, call: async () => { calls++; return { text: 'x' }; }, model: 'm', provider: 'mock' }), text);
  assert.equal(calls, 0, 'no model call for a run without a panel');
  const later = { ...none, stop: { ...none.stop, pass: 2 } };
  assert.match(renderDigestTemplate(deriveDissentSummary(later)), /^The panel disagreed on: nothing - every critic signed off with no objections\./);
  assert.match(renderDigestTemplate(deriveDissentSummary({ outcome: 'no_consensus', disagreement_groups: [] })), /^The panel disagreed on:/);
});

// SP-22: one row per reader of the written rows. A row marked `cut` (a seat of the layer a --finish cut off) must change nothing in what the reader shows or counts: the same report with and without it reads the same.
const cutSeat = (lab, signedOff, extra = {}) => ({ provider: lab, lab, model: 'm', seat_index: lab === 'l1' ? 0 : 1, signedOff, objections: signedOff === true ? [] : [{ id: `O-${lab}`, problem: `p-${lab}` }], ...extra });
const cutBase = () => ({ runId: '2026-11-08T00-00-00-000Z', chain: 'plan-mini-council', passed: false, signoff: [cutSeat('l1', false)], panelVerdicts: [{ round: 1, lab: 'l1', model: 'm', verdict: 'objected' }] });
const cutPanelRow = verdict => ({ round: 1, lab: 'l2', model: 'm', verdict, cut: true });

test('SP-22a (pure) outcome.js: a cut row that read "no verdict" does not turn the run degraded', async () => {
  const { computeOutcome } = await import('../src/outcome.js');
  const base = cutBase();
  assert.equal(computeOutcome({ ...base, signoff: [...base.signoff, cutSeat('l2', null, { cut: true })] }), computeOutcome(base));
});
test('SP-22b (pure) decision-records.js disagreementMap: an unheard cut row is not counted', async () => {
  const { disagreementMap } = await import('../src/decision-records.js');
  const base = cutBase();
  assert.deepEqual(disagreementMap([...base.panelVerdicts, cutPanelRow('unheard')]), disagreementMap(base.panelVerdicts));
});
test('SP-22c (pure) verdict-diff.js: a cut objecting row adds no objecting seat', async () => {
  const { computeVerdictDiff } = await import('../src/verdict-diff.js');
  const base = cutBase();
  assert.deepEqual(computeVerdictDiff(base, { ...base, signoff: [...base.signoff, cutSeat('l2', false, { cut: true })] }).critics_objecting_added, []);
});
test('SP-22d1 (pure) replay.js: the cut seat is not listed among who signed off in the transcript', async () => {
  const { buildTranscript } = await import('../src/replay.js');
  const base = cutBase(); const withCut = { ...base, signoff: [...base.signoff, cutSeat('l2', false, { cut: true })] };
  const lines = r => buildTranscript(r).filter(x => x.kind === 'signoff').map(x => x.text);
  assert.deepEqual(lines(withCut), lines(base));
});
test('SP-22d2 (pure) board-export.js: the cut seat is not listed among who signed off on the exported board', async () => {
  const { renderBoardHtml } = await import('../src/board-export.js');
  const base = cutBase();
  assert.doesNotMatch(renderBoardHtml({ ...base, signoff: [...base.signoff, cutSeat('l2', false, { cut: true })] }), /l2: /);
});
test('SP-22e (pure) final-read.js layer3ReadShas: a cut top-layer row is no read, so the seat is read again', async () => {
  const { layer3ReadShas } = await import('../src/final-read.js');
  assert.deepEqual([...layer3ReadShas([{ round: 1, lab: 'l2', layer: 3, verdict: 'signed_off', cut: true }], { 1: 'aaa' }, ['l2'])], [['l2', null]]);
  assert.deepEqual([...layer3ReadShas([{ round: 1, lab: 'l2', layer: 3, verdict: 'signed_off' }], { 1: 'aaa' }, ['l2'])], [['l2', 'aaa']], 'control: the same row unmarked is a read');
});
test('SP-22f (pure) escalation.js escalatedSignoffBlock: a cut row is no final sign-off of the passed-up objection', async () => {
  const { escalatedSignoffBlock } = await import('../src/escalation.js');
  const block = rows => escalatedSignoffBlock({ end: { pass: 1, layer: 3 }, standing: new Set(), signoff: rows,
    escalations: [{ pass: 1, to_layer: 3, ids: ['O-x'], outcome: [{ id: 'O-x', lab: 'l2', layer: 1, result: 'undecided', problem: 'p' }], rulings: [] }] });
  assert.match(block([{ ...cutSeat('l2', true), objections: [] }]), /signed off in round 1 without raising it again/, 'control: the same row unmarked is the final sign-off');
  assert.equal(block([{ ...cutSeat('l2', true), objections: [], cut: true }]), block([]));
});
test('SP-22g1 (pure) argued.js buildArguedFacts: a lab with only cut rows is not listed (lab list, lines 109)', async () => {
  const { buildArguedFacts } = await import('../src/argued.js');
  const labs = x => buildArguedFacts({ signoff: x.signoff, panelVerdicts: x.panelVerdicts }).labs.map(l => l.lab);
  const base = cutBase();
  assert.deepEqual(labs({ signoff: [...base.signoff, cutSeat('l2', false, { cut: true })], panelVerdicts: [...base.panelVerdicts, cutPanelRow('objected')] }), labs(base));
});
test('SP-22g2 (pure) argued.js buildArguedFacts: a cut sign-off row of a lab that also has an answered seat does not change the lab\'s final verdict (strictest-seat rule, line 119)', async () => {
  const { buildArguedFacts } = await import('../src/argued.js');
  const verdict = x => buildArguedFacts({ signoff: x.signoff, panelVerdicts: x.panelVerdicts }).labs[0].final_verdict;
  const answered = { signoff: [cutSeat('l1', true)], panelVerdicts: [{ round: 1, lab: 'l1', model: 'm', verdict: 'signed_off' }] };
  assert.equal(verdict(answered), 'signed off', 'control: the answered seat alone');
  assert.equal(verdict({ ...answered, signoff: [...answered.signoff, cutSeat('l1', false, { cut: true })] }), 'signed off');
});
test('SP-22g3 (pure) argued.js buildArguedFacts: a cut panelVerdicts row of a lab with an answered row is not its last verdict when the report has no signoff[] (lastBySeat, line 112)', async () => {
  const { buildArguedFacts } = await import('../src/argued.js');
  const verdict = rows => buildArguedFacts({ signoff: null, panelVerdicts: rows }).labs[0].final_verdict;
  const answered = { round: 1, lab: 'l1', model: 'm', verdict: 'signed_off' };
  assert.equal(verdict([answered]), 'signed off', 'control: the answered row alone');
  assert.equal(verdict([answered, { round: 1, lab: 'l1', model: 'm2', verdict: 'objected', cut: true }]), 'signed off');
});
test('SP-22h verdict-stats.js verdictStats: a report with cut rows (a cut sign-off, a cut abstention, their panelVerdicts rows) counts exactly as the same report without them', async () => {
  const { verdictStats } = await import('../src/verdict-stats.js');
  const id = '2026-11-08T10-00-00-000Z';
  const stats = report => {
    const runs = mkdtempSync(join(tmpdir(), 'thc-sp22h-')); mkdirSync(join(runs, id));
    writeFileSync(join(runs, id, 'report.json'), JSON.stringify(report));
    const r = verdictStats(runs, { now: Date.parse('2026-11-09T00:00:00Z') });
    return { chains: r.chains, labs: r.labs, runsSeen: r.runsSeen };
  };
  const base = cutBase();
  const without = stats(base);
  assert.equal(without.runsSeen, 1, `premise: the report was read: ${JSON.stringify(without)}`);
  assert.ok(without.labs.some(l => l.lab === 'l1'), 'premise: l1 is counted');
  const withCut = stats({ ...base,
    signoff: [...base.signoff, cutSeat('l2', true, { cut: true }), cutSeat('l3', null, { cut: true })],
    panelVerdicts: [...base.panelVerdicts, cutPanelRow('signed_off'), { round: 1, lab: 'l3', model: 'm', verdict: 'unheard', cut: true }] });
  assert.deepEqual(withCut, without);
});
