// 0.8.4, the --rounds fix-up (C&C ruling 11 Nov 2026; box probe 11 Nov 2026: `--dry-run --rounds 4` and `--rounds 9` on plan-mini-council printed the same dry run as no --rounds, upper 7 reads): on a LADDER run a typed `--rounds N` is the run's own bound,
// N top-layer reads (it stops after N reads and asks). Every figure that prices such a run is fed that number: the dry run (JSON and text), the policy gate, the limit screen, the notes at the start, the notes of a secret pause, and the MCP dry_run, which takes the same
// optional `rounds` as start_run. Precedence: a typed N, else the chain's own maxRounds, else the assumption (7 upper, 3 expected). Expected = min(3, N). A resume uses the saved number plus its recorded continues. The FLOOR (the cheapest end, one read) never moves.
// With no --rounds every figure is what it was. Offline, $0: dry runs and library calls only. WRITTEN WITHOUT A RUN (no tests on the laptop): the box decides, and the first sitting runs these rows on the unfixed tree too (each fails at an assertion there).
// LT-1 CLI --json for N = 4, 9 and none. LT-2 N = 2 on the CLI and through the library price(). LT-3 the policy gate (a gate: a refusal that turns into a pass at N = 2). LT-4 the floor does not move. LT-5 the words. LT-6 the MCP dry_run `rounds`.
// LT-7 the helper that reads the bound (typed, saved + continues). LT-8 a chain that is not a ladder chain ignores the option (a pin) and `typedReads: null` is the default (a smoke check only). LT-9 a RESUME dry run uses the saved number.
// LT-10 the LIMIT SCREEN (the figures a person sees before typing a limit; the MCP start_run spawns the CLI with --rounds, and the screen text is the one the CLI wrote into the gate): added after C&C's check, on the harness of test/mcp-awaiting-user-cap.test.js; it also pins that its two figures equal the dry run's for the same number. LT-11 a typed N beats a chain's own maxRounds. LT-12 line 3 of the dry run on a chain with its own limit (LT-5 carries line 3 for no number and --rounds 4).
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { malformedProviderKeys } from './helpers/no-real-keys.js';
import { estimateChainRows, ladderUpperWords, ladderExpectedWords, formatUsd } from '../src/cost.js';
import { roundLimitsOf } from '../src/overseer-rounds.js';
import { price } from '../src/api.js';
import { capGateScreen } from '../src/send-path.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(root, 'src', 'cli.js');
const WAIT_MS = 40000;
const MINI = 'plan-mini-council';
const made = [];
process.on('exit', () => { for (const d of made) { try { rmSync(d, { recursive: true, force: true }); } catch { /* a leftover is a nuisance */ } } });
const ENV = { ...malformedProviderKeys(), ANTHROPIC_API_KEY: 'sk-test-dummy-key', OPENROUTER_API_KEY: '' };
function work(policy) {
  const dir = mkdtempSync(join(tmpdir(), 'thc-ltr-')); made.push(dir);
  mkdirSync(join(dir, 'tasks')); writeFileSync(join(dir, 'tasks', 'x.md'), 'Plan a tiny change.\n'); writeFileSync(join(dir, '.env'), '# no keys here\n');
  if (policy) writeFileSync(join(dir, 'policy.json'), JSON.stringify(policy));
  return dir;
}
const run = (dir, args, env = ENV) => spawnSync(process.execPath, [cli, ...args], { cwd: dir, encoding: 'utf8', timeout: 120_000, env: { PATH: process.env.PATH, HOME: dir, ...env } });
const dry = (dir, ...more) => run(dir, ['--chain', MINI, '--task', 'tasks/x.md', '--dry-run', ...more]);
const dryJson = (dir, ...more) => { const r = dry(dir, '--json', ...more); assert.equal(r.status, 0, `${more.join(' ')}: ${r.stderr.slice(0, 300)}`); return JSON.parse(r.stdout); };
const miniConfig = () => JSON.parse(readFileSync(join(root, 'chains', `${MINI}.json`), 'utf8'));

test('LT-1 the CLI dry run prices the typed number: --rounds 4 and 9 give upper 4 and 9 reads (typed, so no assumption), expected 3; the upper figure moves with N (9 > none > 4); the expected figure does not (min(3, N) = 3 for both)', () => {
  const dir = work();
  const none = dryJson(dir); const four = dryJson(dir, '--rounds', '4'); const nine = dryJson(dir, '--rounds', '9');
  assert.deepEqual([none.previewReads.upper, none.previewReads.expected, none.previewReads.upperIsAssumption], [7, 3, true], 'premise: no number typed, the assumption');
  assert.deepEqual([four.previewReads.upper, four.previewReads.expected, four.previewReads.upperIsAssumption], [4, 3, false]);
  assert.deepEqual([nine.previewReads.upper, nine.previewReads.expected, nine.previewReads.upperIsAssumption], [9, 3, false]);
  assert.ok(nine.estimate.maximumUsd > none.estimate.maximumUsd && none.estimate.maximumUsd > four.estimate.maximumUsd, `the upper figure follows N: ${four.estimate.maximumUsd} < ${none.estimate.maximumUsd} < ${nine.estimate.maximumUsd}`);
  assert.equal(four.estimate.expectedUsd.toFixed(6), none.estimate.expectedUsd.toFixed(6)); assert.equal(nine.estimate.expectedUsd.toFixed(6), none.estimate.expectedUsd.toFixed(6));
});

test('LT-2 N = 2 on both paths: the CLI prints expected 2 reads (min(3, 2)), below the figure with no number, and equals the library price() for rounds 2 (the same env), whose totalUsd is the expected figure', () => {
  const dir = work();
  const none = dryJson(dir); const two = dryJson(dir, '--rounds', '2');
  assert.deepEqual([two.previewReads.expected, two.previewReads.upper], [2, 2]);
  assert.ok(two.estimate.expectedUsd < none.estimate.expectedUsd, `${two.estimate.expectedUsd} < ${none.estimate.expectedUsd}`);
  const lib = price({ chain: MINI, cwd: dir, rounds: 2, env: ENV });
  assert.equal(lib.totalUsd.toFixed(6), two.estimate.expectedUsd.toFixed(6), 'one typed number, one expected figure, on the CLI and in the library');
});

test('LT-3 the policy gate prices the typed number (a gate): a policy limit between the expected figure at N = 2 and at no number refuses the dry run with no --rounds (exit 12) and lets --rounds 2 through', () => {
  // the 2-read figure comes from the library (price() applies rounds as maxRounds, so it prices 2 reads on any tree) and the 3-read one from the CLI with no number: the premise holds on a tree where the CLI ignores --rounds too
  const probe = work(); const none = dryJson(probe); const two = { estimate: { expectedUsd: price({ chain: MINI, cwd: probe, rounds: 2, env: ENV }).totalUsd } };
  const mid = (none.estimate.expectedUsd + two.estimate.expectedUsd) / 2;
  assert.ok(two.estimate.expectedUsd < mid && mid < none.estimate.expectedUsd, 'premise: the limit sits between the two figures');
  const dir = work({ max_usd_per_run: mid });
  const refused = dry(dir); assert.equal(refused.status, 12, `no number typed: the expected figure is above the policy limit: ${refused.stderr.slice(0, 300)}`);
  const passed = dry(dir, '--rounds', '2'); assert.equal(passed.status, 0, `--rounds 2 prices 2 reads, under the limit: ${passed.stderr.slice(0, 300)}`);
});

test('LT-4 the floor (the cheapest end: one top-layer read) does not move with the typed number', () => {
  const dir = work(); const none = dryJson(dir);
  for (const n of ['2', '4', '9']) assert.equal(dryJson(dir, '--rounds', n).estimate.floorUsd.toFixed(6), none.estimate.floorUsd.toFixed(6), `--rounds ${n}`);
});

test('LT-5 the words: the dry run text names the typed number in the existing sentence for the upper figure, and the assumption sentence is only printed when none is typed', () => {
  const dir = work(); const cfg = miniConfig(); const lim = roundLimitsOf(cfg);
  const four = dry(dir, '--rounds', '4'); assert.equal(four.status, 0, four.stderr.slice(0, 300));
  const none = dry(dir); assert.equal(none.status, 0);
  // CHANGED ACCEPTED (0.8.4 --rounds fix-up, C&C ruling 11 Nov 2026: line 3). OLD: LT-5 pinned the two figure sentences only; line 3 of the dry run ("Rounds: none (a ladder chain: ...)") never named a typed number, so one dry run said the upper figure counts 4 reads AND "Rounds: none". NEW: under a typed --rounds 4 line 3 carries the recorded suffix of WORDING LAD-R38, "; you typed 4 top-layer reads as your own bound)", and with no number it carries none. WHY: the printed line must agree with the figure beside it; no new words (the suffix existed, for a chain file's own limit). These assertions come FIRST so that, on the unfixed tree, the row fails at the missing suffix (the figure-sentence assertions below agree with themselves there).
  assert.ok(four.stdout.includes('Rounds: none (a ladder chain: layer 1 in blocks of 3 revisions, 3 layer-2 visits, then a top-layer read; the run ends on agreement, a stuck debate, the limit you type or your stop; you typed 4 top-layer reads as your own bound)'), `line 3 under --rounds 4: ${four.stdout.slice(0, 700)}`);
  assert.ok(none.stdout.includes('Rounds: none (a ladder chain: layer 1 in blocks of 3 revisions, 3 layer-2 visits, then a top-layer read; the run ends on agreement, a stuck debate, the limit you type or your stop)'), 'line 3 with no number: as before');
  assert.ok(!none.stdout.includes('as your own bound'), 'no number typed: no suffix');
  assert.ok(four.stdout.includes(ladderUpperWords(lim, 4)), `the upper sentence with the typed number: ${four.stdout.slice(-900)}`);
  assert.ok(four.stdout.includes(ladderExpectedWords(lim, 4)));
  assert.ok(none.stdout.includes(ladderUpperWords(lim)) && none.stdout.includes(ladderExpectedWords(lim)), 'no number typed: the assumption sentences, as before');
  assert.ok(!four.stdout.includes('(an assumption, not a limit: a number you type with --rounds replaces it)'), 'a typed number is not called an assumption');
});

// one stdio session to the MCP server (the helper of test/persona-form-entry-points.test.js, copied; no *.test.js file is imported)
function session(dir, env) {
  const child = spawn(process.execPath, [cli, '--mcp'], { cwd: dir, env: { PATH: process.env.PATH, HOME: dir, ...env } });
  const waiting = new Map(); let buf = ''; let n = 0;
  child.stdout.on('data', d => { buf += d; let nl; while ((nl = buf.indexOf('\n')) !== -1) { const line = buf.slice(0, nl); buf = buf.slice(nl + 1); let m; try { m = JSON.parse(line); } catch { continue; } if (m.id !== undefined && !m.method && waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id); } } });
  const rpc = (method, params) => new Promise((ok, no) => { const id = ++n; const t = setTimeout(() => { waiting.delete(id); no(new Error(`no reply to ${method} in ${WAIT_MS} ms`)); }, WAIT_MS); waiting.set(id, m => { clearTimeout(t); ok(m); }); child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`); });
  const ready = rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'ladder-typed-reads-test', version: '1.0' } }).then(() => child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`));
  return {
    async tools() { await ready; return (await rpc('tools/list', {})).result.tools; },
    async call(name, args) { await ready; const m = await rpc('tools/call', { name, arguments: args }); try { return JSON.parse(m.result.content[0].text); } catch { return m.result ?? m; } },
    close: () => new Promise(done => { const t = setTimeout(() => { child.kill('SIGKILL'); done(); }, 5000); child.once('exit', () => { clearTimeout(t); done(); }); child.stdin.end(); child.kill(); }),
  };
}

test('LT-6 the MCP dry_run takes the same optional rounds as start_run (an integer, 1 to 5) and prices it: rounds 4 gives upper 4 reads, no rounds the assumption of 7, and the figures agree with the CLI for the same number', async () => {
  const dir = work(); const s = session(dir, ENV);
  try {
    const tools = await s.tools();
    const props = tools.find(t => t.name === 'dry_run').inputSchema.properties; const startProps = tools.find(t => t.name === 'start_run').inputSchema.properties;
    assert.ok(props.rounds, 'dry_run lists rounds'); assert.deepEqual([props.rounds.type, props.rounds.minimum, props.rounds.maximum], [startProps.rounds.type, startProps.rounds.minimum, startProps.rounds.maximum], 'the same bound as start_run');
    const four = await s.call('dry_run', { chain: MINI, json: true, rounds: 4 }); const none = await s.call('dry_run', { chain: MINI, json: true });
    assert.deepEqual([four.previewReads?.upper, four.previewReads?.upperIsAssumption], [4, false], JSON.stringify(four).slice(0, 300));
    assert.deepEqual([none.previewReads?.upper, none.previewReads?.upperIsAssumption], [7, true]);
    const cliFour = dryJson(work(), '--rounds', '4');
    assert.equal(four.estimate.maximumUsd.toFixed(6), cliFour.estimate.maximumUsd.toFixed(6), 'the MCP preview and the CLI preview are one figure for one number');
  } finally { await s.close(); }
});

test('LT-7 the bound a run is priced with: the number typed on this command line (the total), else a resumed run\'s saved ladderRounds plus the whole `add` of its recorded overseer_cap continues (the sum chain.js reads), else null', async () => {
  const { ladderBoundOf } = await import('../src/ladder-resume.js');   // a dynamic import, so a tree without the helper fails HERE, at an assertion, and not at the file's load
  assert.equal(typeof ladderBoundOf, 'function', 'src/ladder-resume.js exports ladderBoundOf');
  assert.equal(ladderBoundOf({ typed: 4, saved: 9, choices: [{ choice: 'continue', kind: 'overseer_cap', add: 2 }] }), 4, 'a typed number is the total and wins');
  assert.equal(ladderBoundOf({ typed: null, saved: 5, choices: [{ choice: 'continue', kind: 'overseer_cap', add: 2 }, { choice: 'continue', kind: 'overseer_cap', add: 1 }] }), 8);
  assert.equal(ladderBoundOf({ saved: 5, choices: [{ choice: 'continue', kind: 'layer_bound', add: 3 }, { choice: 'finish', kind: 'overseer_cap', add: 3 }, { choice: 'continue', kind: 'overseer_cap', add: 0 }, { choice: 'continue', kind: 'overseer_cap' }] }), 5, 'only a whole add above 0 at an overseer_cap continue counts');
  assert.equal(ladderBoundOf({ saved: 5 }), 5);
  assert.equal(ladderBoundOf({}), null); assert.equal(ladderBoundOf({ saved: 0 }), null); assert.equal(ladderBoundOf({ typed: 0, saved: null }), null); assert.equal(ladderBoundOf(), null);
});

test('LT-9 a RESUME uses the saved number: a ladder run started with --rounds 3 (it pauses at its external writer, exit 3, and saves ladderRounds 3) and then dry-run with --resume and no --rounds prices 3 reads (upper 3, typed), not the assumption of 7', () => {
  const writer = { provider: 'external', model: 'claude-code-session' };
  const seats = { criteria: { provider: 'mock', model: 'mock-criteria' }, builder: writer, reviser: writer, critics: [
    { provider: 'mock', model: 'mock-critic-script-x-t1', lab: 'l1', layer: 1 }, { provider: 'mock', model: 'mock-critic-script-x-t2', lab: 'l2', layer: 2 }, { provider: 'mock', model: 'mock-critic-script-x-t3', lab: 'l3', layer: 3 }] };
  const dir = work(); mkdirSync(join(dir, 'chains'));
  writeFileSync(join(dir, 'chains', 'lad.json'), JSON.stringify({ name: 'lad', signoff: 'unanimous', ladder: { block: 3, visits: 3 }, estimate: { promptTokens: 500, draftTokens: 500, critiqueTokens: 200 }, seats }));
  const started = run(dir, ['--chain', 'lad', '--task', 'tasks/x.md', '--rounds', '3'], {});
  assert.equal(started.status, 3, `the run pauses at its external writer: ${started.stderr.slice(0, 300)} ${started.stdout.slice(-300)}`);
  const [id] = readdirSync(join(dir, 'runs')); const saved = JSON.parse(readFileSync(join(dir, 'runs', id, 'run.json'), 'utf8'));
  assert.equal(saved.ladderRounds, 3, 'premise: the typed number is saved with the run');
  const r = run(dir, ['--resume', join('runs', id), '--dry-run', '--json'], {});
  assert.equal(r.status, 0, `the dry run of a resumed run: ${r.stderr.slice(0, 300)} ${r.stdout.slice(0, 200)}`);
  const rep = JSON.parse(r.stdout);
  assert.deepEqual([rep.previewReads.upper, rep.previewReads.upperIsAssumption], [3, false], JSON.stringify(rep.previewReads));
});

test('LT-8 a chain that is not a ladder chain ignores the option (a pin), and with no number typed `typedReads: null` is the default (a smoke check only: equal by construction; the evidence that no figure moved with no --rounds is the sitting\'s comparison of the no-number outputs on the unfixed and the fixed tree)', () => {
  for (const f of readdirSync(join(root, 'chains')).filter(n => n.endsWith('.json'))) {
    const cfg = JSON.parse(readFileSync(join(root, 'chains', f), 'utf8'));
    for (const maximum of [false, true]) assert.deepEqual(estimateChainRows(cfg, { maximum, typedReads: null }), estimateChainRows(cfg, { maximum }), `${f} maximum ${maximum} (smoke)`);
    if (!roundLimitsOf(cfg).ladder) for (const maximum of [false, true]) assert.deepEqual(estimateChainRows(cfg, { maximum, typedReads: 4 }), estimateChainRows(cfg, { maximum }), `${f}: not a ladder chain, ${maximum}`);
  }
  assert.ok(readdirSync(join(root, 'chains')).filter(n => n.endsWith('.json')).some(f => roundLimitsOf(JSON.parse(readFileSync(join(root, 'chains', f), 'utf8'))).ladder), 'premise: some shipped chain is a ladder chain');
});

// a ladder chain whose FILE sets its own limit (maxRounds 5), in a fresh directory; `go` runs its dry run
function ownLimitChain() {
  const writer = { provider: 'external', model: 'claude-code-session' };
  const seats = { criteria: { provider: 'mock', model: 'mock-criteria' }, builder: writer, reviser: writer, critics: [
    { provider: 'mock', model: 'mock-critic-script-x-t1', lab: 'l1', layer: 1 }, { provider: 'mock', model: 'mock-critic-script-x-t2', lab: 'l2', layer: 2 }, { provider: 'mock', model: 'mock-critic-script-x-t3', lab: 'l3', layer: 3 }] };
  const dir = work(); mkdirSync(join(dir, 'chains'));
  writeFileSync(join(dir, 'chains', 'own.json'), JSON.stringify({ name: 'own', signoff: 'unanimous', maxRounds: 5, ladder: { block: 3, visits: 3 }, estimate: { promptTokens: 500, draftTokens: 500, critiqueTokens: 200 }, seats }));
  const go = (...more) => run(dir, ['--chain', 'own', '--task', 'tasks/x.md', '--dry-run', ...more], {});
  const json = (...more) => { const r = go('--json', ...more); assert.equal(r.status, 0, `${more.join(' ')}: ${r.stderr.slice(0, 300)} ${r.stdout.slice(0, 200)}`); return JSON.parse(r.stdout); };
  return { go, json };
}

test('LT-11 a typed N beats a chain\'s own maxRounds (the ruling\'s precedence: a typed N, else the chain\'s own maxRounds, else the assumption)', () => {
  const { json } = ownLimitChain();
  const own = json();
  assert.deepEqual([own.previewReads.upper, own.previewReads.upperIsAssumption], [5, false], `premise: the chain's own limit of 5 is priced, and it is no assumption: ${JSON.stringify(own.previewReads)}`);
  const typed = json('--rounds', '2');
  assert.deepEqual([typed.previewReads.upper, typed.previewReads.expected, typed.previewReads.upperIsAssumption], [2, 2, false], `a typed 2 beats the chain's own 5: ${JSON.stringify(typed.previewReads)}`);
});

test('LT-12 line 3 on a chain that has its own limit: with no number it is the plain "Rounds: none (...)" line WITHOUT the suffix (the suffix says "you typed" and is never printed for a chain\'s own limit; the limit itself is not named on that line, a residual no shipped chain meets), and a typed --rounds 4 on that chain names the typed 4, not the 5', () => {
  const { go } = ownLimitChain();
  const ownText = go(); const typedText = go('--rounds', '4');
  assert.equal(ownText.status, 0); assert.equal(typedText.status, 0);
  assert.ok(ownText.stdout.includes('Rounds: none (a ladder chain: layer 1 in blocks of 3 revisions, 3 layer-2 visits, then a top-layer read; the run ends on agreement, a stuck debate, the limit you type or your stop)'), `line 3 of a chain with its own limit, no number typed: ${ownText.stdout.slice(0, 600)}`);
  assert.ok(!ownText.stdout.includes('as your own bound'), 'the suffix says "you typed": it is never printed for a chain\'s own limit');
  assert.ok(typedText.stdout.includes('; you typed 4 top-layer reads as your own bound)') && !typedText.stdout.includes('you typed 5'), `line 3 under --rounds 4 on that chain names the typed 4: ${typedText.stdout.slice(0, 600)}`);
});

function mcpSession(cwd, env, calls, timeoutMs = 90_000) {
  return new Promise((done, fail) => {
    const child = spawn(process.execPath, [cli, '--mcp'], { cwd, env });
    const answers = []; let buf = ''; let next = 0; let err = '';
    child.stderr.on('data', d => { err += d; });
    const timer = setTimeout(() => { child.kill(); fail(new Error(`timed out after ${answers.length} answers; stderr: ${err}`)); }, timeoutMs);
    const send = m => child.stdin.write(JSON.stringify(m) + '\n');
    const sendNext = () => {
      if (next >= calls.length) { clearTimeout(timer); child.stdin.end(); child.kill(); return done(answers); }
      send({ jsonrpc: '2.0', id: next + 2, method: 'tools/call', params: calls[next++] });
    };
    child.stdout.on('data', d => {
      buf += d; let nl;
      while ((nl = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, nl); buf = buf.slice(nl + 1);
        let m; try { m = JSON.parse(line); } catch { continue; }
        if (m.id === 1) { send({ jsonrpc: '2.0', method: 'notifications/initialized' }); sendNext(); }
        else if (m.id !== undefined) { answers.push(JSON.parse(m.result.content[0].text)); sendNext(); }
      }
    });
    send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'ltr-screen-test', version: '0' } } });
  });
}

test('LT-10 the LIMIT SCREEN prices the typed number (a print site, the screen a person decides money on): a ladder chain whose critics are paid seats (a local stub, $0) started through MCP start_run with rounds 2 shows a LOWER estimate and a LOWER upper estimate than the same start with no rounds, both figures equal the dry run figures for the same number (same chain, task and N), and nothing is sent', async () => {
  let requests = 0;
  const srv = http.createServer((req, res) => { requests += 1; req.resume(); res.statusCode = 500; res.end('{}'); });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  try {
    const baseUrl = `http://127.0.0.1:${srv.address().port}`;
    const paid = (lab, layer) => ({ provider: 'openrouter', model: 'anthropic/claude-opus-5', originalProvider: 'anthropic', maxTokens: 500, baseUrl, lab, layer });
    const writer = { provider: 'external', model: 'claude-code-session' };
    const seats = { criteria: { provider: 'mock', model: 'mock-criteria' }, builder: writer, reviser: writer, critics: [paid('l1', 1), paid('l2', 2), paid('l3', 3)] };
    const env = dir => ({ PATH: process.env.PATH, HOME: dir, ...malformedProviderKeys(), OPENROUTER_API_KEY: `sk-or-v1-${'e'.repeat(40)}`, COUNCIL_ALLOW_LOOPBACK_KEY_HOST: '1' });
    const screenOf = async rounds => {
      const dir = work(); mkdirSync(join(dir, 'chains'));
      writeFileSync(join(dir, 'chains', 'lad.json'), JSON.stringify({ name: 'lad', signoff: 'unanimous', ladder: { block: 3, visits: 3 }, estimate: { promptTokens: 500, draftTokens: 500, critiqueTokens: 200 }, seats }));
      const [start] = await mcpSession(dir, env(dir), [{ name: 'start_run', arguments: { chain: 'lad', task: 'tasks/x.md', ...(rounds ? { rounds } : {}) } }]);
      assert.deepEqual([start.started, start.state, start.requires_user, start.paid_started], [false, 'awaiting_user_cap', true, false], `premise: the start waits for a limit: ${JSON.stringify(start).slice(0, 400)}`);
      const screen = capGateScreen(join(dir, 'runs', start.run), start.decision);
      assert.ok(screen && screen.text, 'premise: the limit screen is on disk');
      const figure = re => { const m = screen.text.match(re); assert.ok(m, `the screen shows the figure ${re}: ${screen.text.slice(0, 600)}`); return Number(m[1].replace(/,/g, '')); };
      // the dry run of the SAME chain, task and number, in the same directory: the screen's two figures are the dry run's (LP-8's title, "cap screen = dry run"), printed with the same formatUsd
      const dryRun = run(dir, ['--chain', 'lad', '--task', 'tasks/x.md', '--dry-run', '--json', ...(rounds ? ['--rounds', String(rounds)] : [])], env(dir));
      assert.equal(dryRun.status, 0, `premise: the dry run of the same start: ${dryRun.stderr.slice(0, 300)}`);
      const dryEstimate = JSON.parse(dryRun.stdout).estimate;
      return { expected: figure(/Estimate: about \$([\d,.]+)/), upper: figure(/Upper estimate to finish, by the dry run's count: \$([\d,.]+)/), dryExpected: formatUsd(dryEstimate.expectedUsd), dryUpper: formatUsd(dryEstimate.maximumUsd), screenText: screen.text };
    };
    const none = await screenOf(null); const two = await screenOf(2);
    for (const [label, s] of [['no number', none], ['rounds 2', two]]) {
      assert.ok(s.screenText.includes(`Estimate: about ${s.dryExpected}`), `${label}: the screen's estimate is the dry run's ${s.dryExpected}: ${s.screenText.slice(0, 500)}`);
      assert.ok(s.screenText.includes(`by the dry run's count: ${s.dryUpper}`), `${label}: the screen's upper estimate is the dry run's ${s.dryUpper}: ${s.screenText.slice(0, 700)}`);
    }
    assert.ok(none.expected > 0 && none.upper > none.expected, `premise: the screen with no number shows both figures: ${JSON.stringify(none)}`);
    assert.ok(two.expected < none.expected, `expected: 2 reads (min(3, 2)) costs less than the 3 of the no-number screen: ${JSON.stringify(two)} vs ${JSON.stringify(none)}`);
    assert.ok(two.upper < none.upper, `upper estimate: the typed 2 reads cost less than the assumed 7: ${JSON.stringify(two)} vs ${JSON.stringify(none)}`);
    assert.equal(requests, 0, 'nothing reached the provider');
  } finally { srv.close(); }
});
