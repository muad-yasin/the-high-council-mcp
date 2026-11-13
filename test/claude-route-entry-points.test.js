// 0.8.4 the Claude route, WIRING (Builder B): the route at every ENTRY POINT, through the real commands. Offline, $0: every command here is a dry run, a refusal before anything is sent, or a read; the keys are dummies; the working folders are the test's own.
// WHAT IS PINNED, one row per entry point (the list is derived from the code by test/resolve-run.test.js RR-11; the rows here drive each one): a value that is not a route refuses the start, nothing started and nothing spent, with the
// sentence that names where the value came from: EP-1 the CLI start (flag and COUNCIL_CLAUDE_ROUTE, a paid chain and a mock chain, the dry run, the real start, the bare flag with no value), EP-2 the tree start, EP-3 the doctor (says it, starts nothing), EP-4 the library
// (price, run, resume), EP-5 the MCP tools (dry_run, start_run, resume_run: before a run id is taken or a child is spawned). EP-6: with only an OpenRouter key the dry run SAYS the Claude seats go through OpenRouter, in text and in the JSON, and with an Anthropic key it says nothing;
// a project .env that says `session` or `openrouter` moves and refuses nothing (the setting is operator-only). EP-7: an existing run is never moved by its run.json (a planted claude_route) at the MCP resume.
// CHANGED ACCEPTED TEST (0.8.4 session switch): OLD: `session` was a reserved value that every entry point refused (EP-1 .. EP-5, EP-7: "session is reserved"). NEW: `session` is a route; the refusals are pinned with the value 'nonsense' and the whole new sentence ("... is not a Claude route. Use auto, anthropic, openrouter or session."), and EP-9 .. EP-13 drive the session route at each entry point:
// EP-9 the CLI (a dry run with NO keys, the --json dry run, a start that pauses at the first session stage with exit 3 and no limit asked, a mixed chain that still asks for the limit and names what bills, the person's own change on a resume), EP-10 the library, EP-11 the MCP tools (start_run's claude_route_note), EP-12 THE MONEY ROW (a bare resume of a session run never goes
// to the API, over the CLI and over MCP), EP-13 the missing-key sentence names the session route. WHY: the session route is built. The Claude seats of the session chains below are direct Anthropic seats or Claude models seated through OpenRouter at a CLOSED loopback port, so no row can reach a paid API; every row asserts the pause or the route decision.
// EP-14 (the move away asks the limit first) HAS ITS OWN RED: helper-a/RED_FIX1_EXPECTED.md. NO RED OF THEIR OWN (the rows above): none of them takes a function argument; on the tree before this unit each fails at its first assertion about the command's answer (the flag is refused as unknown, exit 2, with another sentence), which is a red at an assertion and not an import error. The expected list
// names which assertion each fails at.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as Api from '../src/api.js';
import { createServer } from 'node:net';
import { installSplitRoot } from './helpers/tree-fixture.js';
import { typeCap } from './helpers/typed-cap.js';
import { malformedProviderKeys } from './helpers/no-real-keys.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(root, 'src', 'cli.js');
const WAIT_MS = 40000;
const NOTHING = /Nothing was started and nothing was spent\./;
const made = [];
process.on('exit', () => { for (const d of made) { try { rmSync(d, { recursive: true, force: true }); } catch { /* a leftover is a nuisance */ } } });
// Every child's keys start from the helper's malformed ones (test/helpers/no-real-keys.js: never filled from a .env, never sent), so no real key in the shell or the checkout can reach a provider if a refusal ever misses (the $0 rule of test/no-paid-chain-spawn.test.js);
// a row then sets only the keys it needs. A blank value is no key ("absent"), and each working folder holds its own .env so the package's is never applied.
const BASE = malformedProviderKeys();
const KEYS = { none: { ...BASE, ANTHROPIC_API_KEY: '', OPENROUTER_API_KEY: '' }, anthropic: { ...BASE, ANTHROPIC_API_KEY: 'sk-test-dummy-key', OPENROUTER_API_KEY: '' }, openrouter: { ...BASE, ANTHROPIC_API_KEY: '', OPENROUTER_API_KEY: 'sk-or-test-dummy-key' }, both: { ...BASE, ANTHROPIC_API_KEY: 'sk-test-dummy-key', OPENROUTER_API_KEY: 'sk-or-test-dummy-key' }, malformed: { ...BASE } };
function work() {
  const dir = mkdtempSync(join(tmpdir(), 'thc-route-')); made.push(dir);
  mkdirSync(join(dir, 'tasks')); mkdirSync(join(dir, 'chains')); writeFileSync(join(dir, 'tasks', 'x.md'), 'Plan a tiny change.\n'); writeFileSync(join(dir, '.env'), '# no keys here\n');
  writeFileSync(join(dir, 'chains', 'plain-mock.json'), JSON.stringify({ name: 'plain-mock', description: 'a mock chain', seats: { criteria: { provider: 'mock', model: 'mock-criteria' }, builder: { provider: 'mock', model: 'mock-builder' }, critics: [{ provider: 'mock', model: 'mock-critic-a' }] } }));
  return dir;
}
const sessionWork = () => { const d = work(); writeSessionChains(d); return d; };      // a working folder that also holds the session chains (the rows that drive them)
const run = (dir, args, env = {}) => spawnSync(process.execPath, [cli, ...args], { cwd: dir, encoding: 'utf8', timeout: 120_000, env: { PATH: process.env.PATH, HOME: dir, ...env } });
const noRuns = dir => !(existsSync(join(dir, 'runs')) && readdirSync(join(dir, 'runs')).length > 0);
const PAID = 'plan-mini-council';
// ---- the session chains (written into a working folder by writeSessionChains) ----------------------------------------------------------------------------------------------------------------
// Built from the shipped offline chain mock-external (its builder pauses the run; every other stage is mock) with Claude seats put in: `sess` has a direct Anthropic builder and two direct Anthropic judges (three Claude seats); `sess-mix` adds a paid OpenRouter judge (a stub address no call reaches: the run pauses at the
// builder first), so it still bills; `sess-or` (written by the test that needs it) seats its three Claude models (builder and both judges) THROUGH OpenRouter at a CLOSED loopback port, so even a regression that sent them to the API could reach nothing but that port.
const ANTHROPIC_SEAT = (model, lab) => ({ provider: 'anthropic', model, maxTokens: 128000, lab, extra: { output_config: { effort: 'high' } } });
const MOCK_JUDGE = { provider: 'mock', model: 'mock-critic-a', lab: 'mock-a' };
const sessionChain = (name, seats) => { const base = JSON.parse(readFileSync(join(root, 'chains', 'mock-external.json'), 'utf8')); return { ...base, name, seats: { ...base.seats, ...seats } }; };
const PAID_STUB_JUDGE = { provider: 'openrouter', model: 'qwen/qwen3.7-plus', lab: 'orx', maxTokens: 500, baseUrl: 'http://127.0.0.1:9/v1' };
function writeSessionChains(dir) {
  const claudeJudges = [ANTHROPIC_SEAT('claude-sonnet-5-5', 'sonnet5.5'), ANTHROPIC_SEAT('claude-haiku-5-5', 'haiku5.5')];
  writeFileSync(join(dir, 'chains', 'sess.json'), JSON.stringify(sessionChain('sess', { builder: ANTHROPIC_SEAT('claude-opus-5-5', 'opus5.5'), critics: [MOCK_JUDGE, ...claudeJudges] })));
  writeFileSync(join(dir, 'chains', 'sess-mix.json'), JSON.stringify(sessionChain('sess-mix', { builder: ANTHROPIC_SEAT('claude-opus-5-5', 'opus5.5'), critics: [MOCK_JUDGE, ...claudeJudges, PAID_STUB_JUDGE] })));
}
// The one line SSW-w1 (A-DRAFT) says for these chains: three Claude seats; and the same with the paid judge named (critics[3]) and the limit said to cover it.
const LINE3 = 'Claude seats: 3 Claude seats are answered by your own Claude Code sessions, one session for each seat (no API cost for them).';
const LINE3_MIX = `${LINE3} 1 other seat still bills through openrouter: critics[3]. The spending limit asked for covers it.`;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const until = async (fn, ms = 60000) => { const t0 = Date.now(); for (;;) { const v = fn(); if (v || Date.now() - t0 > ms) return v; await sleep(200); } };
// The paid calls a run folder says it reserved: a `reserved` line whose seat is not a free one (mock, external). A session run reserves none; the file may be absent.
const paidReservations = runDir => { const f = join(runDir, 'spend-reservations.jsonl'); if (!existsSync(f)) return []; return readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return { raw: l }; } }).filter(x => x.event === 'reserved' && !/^(mock|external)\//.test(String(x.seat ?? ''))); };
const runJsonOf = runDir => JSON.parse(readFileSync(join(runDir, 'run.json'), 'utf8'));
const needsOf = runDir => readdirSync(runDir).filter(f => /^NEEDS-.*\.md$/.test(f)).sort();
const closedPort = () => new Promise((ok, no) => { const srv = createServer(); srv.once('error', no); srv.listen(0, '127.0.0.1', () => { const { port } = srv.address(); srv.close(() => ok(port)); }); });
// CHANGED ACCEPTED TEST (0.8.4, the twelve unowned tip reds, rows R01 = EP-1 and R02 = EP-6). OLD: the whole dry-run output of plan-mini-council was matched for "go through OpenRouter" (EP-1 and EP-6, three places). NEW: the dry-run output without its one "Chain:" line. WHY: the dry run prints "Chain: <name> - <description>" and the reviewed description of plan-mini-council (the apply, f60ebad2) now says its Claude seats are called through Anthropic's API with an Anthropic key "and go through OpenRouter without one": the chain's own text, not the dry run's statement about a key. The intent of the assertions (the dry run says nothing of a key or a route of its own) is kept: everything but that line is still matched. The line is pinned EQUAL to the chain file's description, so a changed description or a second "Chain:" line fails here, and the control legs in EP-1 and EP-6 show that the filter hides no other line.
const PAID_CHAIN_LINE = `Chain: ${PAID} - ${JSON.parse(readFileSync(join(root, 'chains', `${PAID}.json`), 'utf8')).description}`;
const withoutChainLine = text => { const lines = String(text).split('\n'); const kept = lines.filter(l => l !== PAID_CHAIN_LINE); assert.equal(lines.length - kept.length, 1, `the dry run prints the chain file's description on exactly one "Chain:" line (found ${lines.length - kept.length})`); return kept.join('\n'); };

test('EP-1: the CLI start refuses a value that is not a route, on a paid chain and a mock chain, from the flag and from the setting, dry run and real start, and the bare flag; nothing is started', () => {
  const dir = work();
  for (const chain of [PAID, 'plain-mock']) {
    // CHANGED ACCEPTED TEST (0.8.4 session switch): OLD: the values were 'session' (reserved) and 'nonsense'. NEW: 'nonsense' only, with the whole new sentence; `session` is driven by EP-9. WHY: it is a route now.
    for (const [value, words] of [['nonsense', /"nonsense" is not a Claude route\. Use auto, anthropic, openrouter or session\./]]) {
      for (const dry of [['--dry-run'], []]) {
        const viaFlag = run(dir, ['--chain', chain, '--task', 'tasks/x.md', ...dry, '--claude-route', value], KEYS.anthropic);
        assert.equal(viaFlag.status, 2, `${chain} ${dry.join('')} --claude-route ${value}: ${viaFlag.stderr.slice(0, 300)}`);
        assert.match(viaFlag.stderr, words); assert.match(viaFlag.stderr, NOTHING); assert.match(viaFlag.stderr, /--claude-route/);
        const viaSetting = run(dir, ['--chain', chain, '--task', 'tasks/x.md', ...dry], { ...KEYS.anthropic, COUNCIL_CLAUDE_ROUTE: value });
        assert.equal(viaSetting.status, 2, `${chain} ${dry.join('')} COUNCIL_CLAUDE_ROUTE=${value}: ${viaSetting.stderr.slice(0, 300)}`);
        assert.match(viaSetting.stderr, words); assert.match(viaSetting.stderr, NOTHING); assert.match(viaSetting.stderr, /COUNCIL_CLAUDE_ROUTE/);
      }
    }
  }
  const bare = run(dir, ['--chain', 'plain-mock', '--task', 'tasks/x.md', '--dry-run', '--claude-route'], KEYS.anthropic);
  assert.equal(bare.status, 2); assert.match(bare.stderr, /--claude-route needs a value: auto, anthropic, openrouter or session\. Nothing was started and nothing was spent\./, 'the whole sentence names all four routes');
  // a REAL start of a shipped chain with a malformed Anthropic key stops at the route decision (a malformed key never routes silently), naming both ways out, and exits 5 like another lab's malformed key (the missing-key exit); a dry run of it is priced as it always was
  const stopped = run(dir, ['--chain', PAID, '--task', 'tasks/x.md'], KEYS.malformed);
  assert.equal(stopped.status, 5, stopped.stdout + stopped.stderr + ' (a malformed key exits as every other lab\'s does at the key check: src/cli.js missingKeyLines, EXIT_DEGRADABLE)'); assert.match(stopped.stderr, /ANTHROPIC_API_KEY is set, but/); assert.match(stopped.stderr, /--claude-route openrouter/); assert.match(stopped.stderr, NOTHING);
  const priced = run(dir, ['--chain', PAID, '--task', 'tasks/x.md', '--dry-run'], KEYS.malformed);
  assert.equal(priced.status, 0, priced.stderr.slice(0, 300)); assert.doesNotMatch(withoutChainLine(priced.stdout) + priced.stderr, /API_KEY|(go|goes) through OpenRouter/, 'the dry run needs no key and says nothing about one (but for its Chain line, the chain\'s own description)');
  // control (R01): the filter takes out the Chain line and nothing else: the same words on any other line are still found, and a Chain line that is not the chain file's description is refused
  assert.match(withoutChainLine(`${PAID_CHAIN_LINE}\nANTHROPIC_API_KEY is set, but it is malformed.`), /API_KEY/, 'control: a key word on another line is not hidden');
  assert.throws(() => withoutChainLine('Chain: plan-mini-council - another description\nClaude seats: priced as calls straight to Anthropic.'), /exactly one "Chain:" line/, 'control: a Chain line that is not the chain file\'s description is refused');
  assert.match(priced.stdout, /^Claude seats: priced as calls straight to Anthropic\.$/m, 'but it names the route it priced');   // CHANGED ACCEPTED TEST (0.8.4 apply, recorded state): OLD: `priced straight to Anthropic`. NEW: `priced as calls straight to Anthropic` (this pin and the ones below, positive and negative). WHY: the reviewed row of src/claude-route.js (the apply, commit 1).
  const pricedJson = JSON.parse(run(dir, ['--chain', PAID, '--task', 'tasks/x.md', '--dry-run', '--json'], KEYS.malformed).stdout);
  assert.deepEqual([pricedJson.claudeRoute?.route, pricedJson.claudeRoute?.why], ['anthropic', 'key_state'], 'the JSON names it too');
  // ONLY a malformed OpenRouter key (no Anthropic key): the real start stops, exit 5, naming that key; the dry run is priced THROUGH OpenRouter (the route the start takes once that key is mended), never as a direct run, and says nothing about the key
  const orOnlyBad = { ...BASE, ANTHROPIC_API_KEY: '' };
  const orStop = run(dir, ['--chain', PAID, '--task', 'tasks/x.md'], orOnlyBad);
  assert.equal(orStop.status, 5, orStop.stdout + orStop.stderr); assert.match(orStop.stderr, /OPENROUTER_API_KEY is set, but/); assert.match(orStop.stderr, NOTHING);
  const orPriced = run(dir, ['--chain', PAID, '--task', 'tasks/x.md', '--dry-run'], orOnlyBad);
  assert.equal(orPriced.status, 0, orPriced.stderr.slice(0, 300)); assert.match(orPriced.stdout, /go through OpenRouter, because no ANTHROPIC_API_KEY is set/); assert.doesNotMatch(orPriced.stdout + orPriced.stderr, /API_KEY is set, but|priced as calls straight to Anthropic/);
  const orPricedJson = JSON.parse(run(dir, ['--chain', PAID, '--task', 'tasks/x.md', '--dry-run', '--json'], orOnlyBad).stdout);
  assert.deepEqual([orPricedJson.claudeRoute?.route, orPricedJson.claudeRoute?.why], ['openrouter', 'no_anthropic_key']);
  // a bad route VALUE still refuses the same dry run (RR-1 and RR-5 pin the decision; here the command)
  const badValue = run(dir, ['--chain', PAID, '--task', 'tasks/x.md', '--dry-run', '--claude-route', 'nonsense'], KEYS.malformed);      // CHANGED ACCEPTED TEST (0.8.4 session switch): OLD: the value was 'session' (refused). NEW: 'nonsense'. WHY: session is a route (EP-9)
  assert.equal(badValue.status, 2); assert.match(badValue.stderr, /"nonsense" is not a Claude route\. Use auto, anthropic, openrouter or session\./);
  assert.ok(noRuns(dir), 'no refusal made a run folder');
});

test('EP-2: the tree start refuses a value that is not a route before any record is written', () => {
  const dir = work(); installSplitRoot(dir);
  const before = JSON.stringify(readdirSync(dir, { recursive: true }).sort());
  for (const value of ['nonsense']) {      // CHANGED ACCEPTED TEST (0.8.4 session switch): OLD: ['session', 'nonsense']. NEW: ['nonsense']; the tree's session dry run is the row below. WHY: `session` is a route.
    const r = run(dir, ['tree', 'start', '--task', 'tasks/x.md', '--chain', 'split-root', '--dry-run'], { ...KEYS.anthropic, COUNCIL_CLAUDE_ROUTE: value });
    assert.equal(r.status, 2, `${value}: ${r.stderr.slice(0, 300)}`);
    assert.match(r.stderr, /COUNCIL_CLAUDE_ROUTE/); assert.match(r.stderr, NOTHING);
  }
  assert.equal(JSON.stringify(readdirSync(dir, { recursive: true }).sort()), before, 'nothing was written');
  // the flag is no option of a tree (the member runs get the environment, not the command line): refused by name, never dropped
  const flagged = run(dir, ['tree', 'start', '--task', 'tasks/x.md', '--chain', 'split-root', '--dry-run', '--claude-route', 'openrouter'], KEYS.both);
  assert.equal(flagged.status, 2, flagged.stdout + flagged.stderr); assert.match(flagged.stderr, /--claude-route: not an option of `council tree start`: the member runs are started with the environment, so set COUNCIL_CLAUDE_ROUTE \(auto, anthropic, openrouter or session\) there/, 'the whole sentence names all four routes');
  assert.equal(JSON.stringify(readdirSync(dir, { recursive: true }).sort()), before, 'nothing was written');
  // a REAL tree start of a shipped chain with a malformed Anthropic key stops at the route decision and exits 5, as the tree's own key check does for another lab's malformed key
  const keyStop = run(dir, ['tree', 'start', '--task', 'tasks/x.md', '--chain', PAID, '--max-usd', '5'], KEYS.malformed);
  assert.equal(keyStop.status, 5, keyStop.stdout + keyStop.stderr); assert.match(keyStop.stderr, /ANTHROPIC_API_KEY is set, but/); assert.equal(JSON.stringify(readdirSync(dir, { recursive: true }).sort()), before, 'nothing was written');
  const ok = run(dir, ['tree', 'start', '--task', 'tasks/x.md', '--chain', 'split-root', '--dry-run'], KEYS.anthropic);
  assert.equal(ok.status, 0, `the same start with no setting is a dry run that works: ${ok.stderr.slice(0, 300)}`);
  // the tree's dry run names the route it priced, once for one chain (the child defaults to the root chain), before the figures: through OpenRouter with only an OpenRouter key; straight to Anthropic, saying nothing of the key, under a malformed Anthropic key; nothing for a direct run with a usable key
  const treeDry = keys => run(dir, ['tree', 'start', '--task', 'tasks/x.md', '--chain', PAID, '--dry-run'], keys);
  const trOr = treeDry(KEYS.openrouter);
  assert.equal(trOr.status, 0, trOr.stdout + trOr.stderr); assert.equal((trOr.stdout.match(/go through OpenRouter, because no ANTHROPIC_API_KEY is set/g) ?? []).length, 1, 'said once'); assert.doesNotMatch(trOr.stdout, /Root chain|Sub-plan chain/);
  const trBad = treeDry(KEYS.malformed);
  assert.equal(trBad.status, 0, trBad.stdout + trBad.stderr); assert.match(trBad.stdout, /^Claude seats: priced as calls straight to Anthropic\.$/m); assert.doesNotMatch(trBad.stdout + trBad.stderr, /API_KEY is set, but/);
  assert.doesNotMatch(treeDry(KEYS.anthropic).stdout, /Claude seats:/, 'a direct run with a usable key prints nothing');
  // the session route through the tree's environment setting: needs no key (a malformed set), says the route once, the Claude seats first and then what still bills (the shipped chain's other seats are OpenRouter seats), and writes nothing
  const trSession = run(dir, ['tree', 'start', '--task', 'tasks/x.md', '--chain', PAID, '--dry-run'], { ...KEYS.malformed, COUNCIL_CLAUDE_ROUTE: 'session' });
  assert.equal(trSession.status, 0, trSession.stdout + trSession.stderr);
  assert.match(trSession.stdout, /^Claude seats: 2 Claude seats are answered by your own Claude Code sessions, one session for each seat \(no API cost for them\)\. \d+ other seats still bill through openrouter: .+\. The spending limit asked for covers them\.$/m);
  assert.doesNotMatch(trSession.stdout + trSession.stderr, /API_KEY is set, but|priced as calls straight to Anthropic/); assert.equal(JSON.stringify(readdirSync(dir, { recursive: true }).sort()), before, 'nothing was written');
  const trTwo = run(dir, ['tree', 'start', '--task', 'tasks/x.md', '--chain', PAID, '--child-chain', 'plan-medium-council', '--dry-run'], KEYS.openrouter);
  assert.equal(trTwo.status, 0, trTwo.stdout + trTwo.stderr); assert.match(trTwo.stdout, new RegExp(`^Root chain ${PAID}: Claude seats: \\d+ Claude seats? (go|goes) through OpenRouter`, 'm')); assert.match(trTwo.stdout, /^Sub-plan chain plan-medium-council: Claude seats: \d+ Claude seats? (go|goes) through OpenRouter/m, 'two different chains say it each, led by which one it is');
});

test('EP-3: the doctor says a refused setting once and starts nothing', () => {
  const dir = work();
  // CHANGED ACCEPTED TEST (0.8.4 session switch): OLD: COUNCIL_CLAUDE_ROUTE=session made the doctor say it was reserved. NEW: the refused value is 'nonsense' (whole sentence), and `session` is accepted without a word. WHY: it is a route.
  const r = run(dir, ['doctor'], { ...KEYS.anthropic, COUNCIL_CLAUDE_ROUTE: 'nonsense' });
  assert.match(r.stdout, /COUNCIL_CLAUDE_ROUTE: "nonsense" is not a Claude route\. Use auto, anthropic, openrouter or session\. Every run refuses to start until it is fixed\./);
  const session = run(dir, ['doctor'], { ...KEYS.anthropic, COUNCIL_CLAUDE_ROUTE: 'session' });
  assert.doesNotMatch(session.stdout, /is not a Claude route|Every run refuses to start until it is fixed\./, 'the session route is accepted: the doctor says nothing against it');
  const fine = run(dir, ['doctor'], KEYS.anthropic);
  assert.doesNotMatch(fine.stdout, /is not a Claude route/);
  assert.ok(noRuns(dir));
});

test('EP-4: the library: price refuses a value that is not a route and says the route when only an OpenRouter key is set; run and resume refuse before a run is made', async () => {
  const dir = work();
  // CHANGED ACCEPTED TEST (0.8.4 session switch): OLD: Api.price / Api.run with claudeRoute 'session' threw "reserved". NEW: they refuse 'nonsense'; the session price is EP-10. WHY: `session` is a route.
  assert.throws(() => Api.price({ chain: PAID, cwd: dir, claudeRoute: 'nonsense', env: KEYS.anthropic }), /"nonsense" is not a Claude route\. Use auto, anthropic, openrouter or session\./);
  const viaOr = Api.price({ chain: PAID, cwd: dir, env: KEYS.openrouter });
  assert.equal(viaOr.claudeRoute?.route, 'openrouter', 'with only an OpenRouter key the chain is priced through OpenRouter');
  assert.ok(viaOr.rows.length > 0 && viaOr.rows.filter(r => !/^(mock|external)\//.test(r.seat)).every(r => r.priced), 'every routed row is priced');
  assert.equal(Api.price({ chain: PAID, cwd: dir, env: KEYS.anthropic }).claudeRoute, undefined, 'with an Anthropic key the answer is what it always was');
  // a price needs no key: a malformed Anthropic key prices the direct route and SAYS it (why key_state); a malformed OpenRouter key with no Anthropic key prices through OpenRouter; a bad route value still throws
  const badAnth = Api.price({ chain: PAID, cwd: dir, env: KEYS.malformed });
  assert.deepEqual([badAnth.claudeRoute?.route, badAnth.claudeRoute?.why, badAnth.claudeRoute?.seats], ['anthropic', 'key_state', 0], 'a malformed Anthropic key: priced direct, and the answer says so');
  const badOr = Api.price({ chain: PAID, cwd: dir, env: { ...BASE, ANTHROPIC_API_KEY: '' } });
  assert.deepEqual([badOr.claudeRoute?.route, badOr.claudeRoute?.why], ['openrouter', 'no_anthropic_key'], 'a malformed OpenRouter key and no Anthropic key: priced through OpenRouter');
  assert.throws(() => Api.price({ chain: PAID, cwd: dir, claudeRoute: 'nonsense', env: KEYS.malformed }), /"nonsense" is not a Claude route/, 'a bad route value still refuses a price');
  const ran = await Api.run({ chain: PAID, task: 'tasks/x.md', cwd: dir, claudeRoute: 'nonsense', env: KEYS.anthropic }).catch(e => e);
  assert.ok(ran && /"nonsense" is not a Claude route/.test(`${ran.message ?? ''} ${ran.outputTail ?? ''} ${ran.stderr ?? ''}`), `run refuses: ${JSON.stringify(ran).slice(0, 300)}`);
  assert.ok(noRuns(dir), 'no run folder was made');
});

// one stdio session to the MCP server: the test's own copy of the helper test/mcp-start-ladder.test.js uses
function session(dir, env) {
  const child = spawn(process.execPath, [cli, '--mcp'], { cwd: dir, env: { PATH: process.env.PATH, HOME: dir, ...env } });
  const waiting = new Map(); let buf = ''; let n = 0;
  child.stdout.on('data', d => { buf += d; let nl; while ((nl = buf.indexOf('\n')) !== -1) { const line = buf.slice(0, nl); buf = buf.slice(nl + 1); let m; try { m = JSON.parse(line); } catch { continue; } if (m.id !== undefined && !m.method && waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id); } } });
  const rpc = (method, params) => new Promise((ok, no) => { const id = ++n; const t = setTimeout(() => { waiting.delete(id); no(new Error(`no reply to ${method} in ${WAIT_MS} ms`)); }, WAIT_MS); waiting.set(id, m => { clearTimeout(t); ok(m); }); child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`); });
  const ready = rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'claude-route-test', version: '1.0' } }).then(() => child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`));
  return {
    async tools() { await ready; return (await rpc('tools/list', {})).result.tools; },
    async call(name, args) { await ready; const m = await rpc('tools/call', { name, arguments: args }); try { return JSON.parse(m.result.content[0].text); } catch { return m.result ?? m; } },
    close: () => new Promise(done => { const t = setTimeout(() => { child.kill('SIGKILL'); done(); }, 5000); child.once('exit', () => { clearTimeout(t); done(); }); child.stdin.end(); child.kill(); }),
  };
}

test('EP-5: the MCP tools take claude_route and refuse a value that is not a route before a run id is taken or a child is spawned', async () => {
  const dir = work(); const s = session(dir, KEYS.anthropic);
  try {
    for (const name of ['dry_run', 'start_run', 'resume_run']) assert.ok((await s.tools()).find(t => t.name === name).inputSchema.properties.claude_route, `${name} lists claude_route`);
    // CHANGED ACCEPTED TEST (0.8.4 session switch): OLD: dry_run and start_run with claude_route 'session' (a paid chain and a mock chain) were refused as reserved. NEW: the refused value is 'nonsense' (whole sentence); a session dry_run and start_run are EP-11. A mock chain with `session` is NOT refused any more (it has no Claude seat: it simply runs), so it is not driven here, where no run may start. WHY: `session` is a route.
    const dry = await s.call('dry_run', { chain: PAID, claude_route: 'nonsense' });
    assert.match(dry.error ?? '', /the claude_route argument: "nonsense" is not a Claude route\. Use auto, anthropic, openrouter or session\./); assert.match(dry.error ?? '', NOTHING);
    const start = await s.call('start_run', { chain: PAID, task: 'tasks/x.md', claude_route: 'nonsense' });
    assert.equal(start.started, false); assert.match(start.error ?? '', /is not a Claude route/); assert.match(start.error ?? '', NOTHING);
    assert.ok(noRuns(dir), 'no run id was taken');
    const mock = await s.call('start_run', { chain: 'plain-mock', task: 'tasks/x.md', claude_route: 'nonsense' });
    assert.equal(mock.started, false, 'a mock chain refuses it too'); assert.match(mock.error ?? '', /"nonsense" is not a Claude route/);
    assert.ok(noRuns(dir));
  } finally { await s.close(); }
});

test('EP-6: with only an OpenRouter key the dry run says the Claude seats go through OpenRouter (text and JSON); with an Anthropic key it says nothing; a project .env moves and refuses nothing', () => {
  const dir = work();
  const base = ['--chain', PAID, '--task', 'tasks/x.md', '--dry-run'];
  const viaOr = run(dir, base, KEYS.openrouter);
  assert.equal(viaOr.status, 0, viaOr.stderr.slice(0, 300)); assert.match(viaOr.stdout, /Claude seats: \d+ Claude seats? (go|goes) through OpenRouter, because no ANTHROPIC_API_KEY is set\./);
  const json = JSON.parse(run(dir, [...base, '--json'], KEYS.openrouter).stdout);
  assert.equal(json.claudeRoute.route, 'openrouter'); assert.equal(json.claudeRoute.why, 'no_anthropic_key'); assert.ok(json.claudeRoute.seats >= 1);
  const chosen = run(dir, [...base, '--claude-route', 'openrouter'], KEYS.both);
  assert.match(chosen.stdout, /(go|goes) through OpenRouter, as you chose\./);
  const direct = run(dir, base, KEYS.both);
  assert.doesNotMatch(withoutChainLine(direct.stdout), /(go|goes) through OpenRouter/, 'with an Anthropic key the dry run says nothing of OpenRouter (but for its Chain line, the chain\'s own description)');
  // control (R02): route words on any line but the Chain line are still found
  assert.match(withoutChainLine(`${PAID_CHAIN_LINE}\nClaude seats: 3 Claude seats go through OpenRouter, because no ANTHROPIC_API_KEY is set.`), /(go|goes) through OpenRouter/, 'control: the route sentence on another line is not hidden');
  assert.equal(JSON.parse(run(dir, [...base, '--json'], KEYS.anthropic).stdout).claudeRoute, undefined);
  for (const line of ['COUNCIL_CLAUDE_ROUTE=session', 'COUNCIL_CLAUDE_ROUTE=openrouter']) {
    writeFileSync(join(dir, '.env'), `${line}\n`);
    const r = run(dir, base, KEYS.anthropic);
    assert.equal(r.status, 0, `${line} in a project .env refuses nothing: ${r.stderr.slice(0, 300)}`); assert.doesNotMatch(withoutChainLine(r.stdout), /(go|goes) through OpenRouter|answered by your own Claude Code session/, `${line} in a project .env moves no seat`);
  }
  // the session route is operator-only too (extended for 0.8.4 session switch): a project .env that says it moves no Claude seat of a chain that has direct ones, and refuses nothing
  writeFileSync(join(dir, '.env'), 'COUNCIL_CLAUDE_ROUTE=session\n'); writeSessionChains(dir);
  const planted = run(dir, ['--chain', 'sess', '--task', 'tasks/x.md', '--dry-run'], KEYS.anthropic);
  assert.equal(planted.status, 0, planted.stderr.slice(0, 300)); assert.doesNotMatch(planted.stdout + planted.stderr, /answered by your own Claude Code session/, 'a project .env cannot hand the Claude seats to sessions');
});

test('EP-7: an existing run is never moved by its run.json: a planted claude_route at the MCP resume is refused, naming both ways out, before anything is spawned', async () => {
  const dir = work(); const id = '2026-11-10T10-00-00-000Z'; const runDir = join(dir, 'runs', id);
  mkdirSync(runDir, { recursive: true });
  writeFileSync(join(runDir, 'run.json'), JSON.stringify({ chain: PAID, task: 'tasks/x.md', cwd: dir, startedAt: '2026-11-10T10:00:00.000Z', claude_route: 'openrouter' }));
  const s = session(dir, KEYS.anthropic);
  try {
    const r = await s.call('resume_run', { run: id });
    assert.equal(r.resumed, false, JSON.stringify(r).slice(0, 400));
    assert.match(r.error ?? '', /This run was started with its Claude seats through OpenRouter/); assert.match(r.error ?? '', /the claude_route argument set to "openrouter"/); assert.match(r.error ?? '', /the claude_route argument set to "anthropic"/); assert.match(r.error ?? '', NOTHING);
    const kept = await s.call('resume_run', { run: id, claude_route: 'nonsense' });      // CHANGED ACCEPTED TEST (0.8.4 session switch): OLD: the value was 'session' (refused). NEW: 'nonsense'. WHY: a typed `session` on this run is the person's change and would resume it (resolve-run RR-S7 drives that decision)
    assert.match(kept.error ?? '', /"nonsense" is not a Claude route/);
  } finally { await s.close(); }
});

// EP-8 (a source pin, C4): the side-run dry run (`--rematch --dry-run`, `--replay --dry-run`) prints the route of ITS OWN decision, passed in. The main run's `const claudeRouting` is made far below it in src/cli.js; a function that reads it before that line throws a
// ReferenceError for every side-run dry run (the earlier commit's mistake, found by reading, and a parse check cannot see it). The behaviour itself is driven by the unit-end probe.
test('EP-8: the side-run dry run does not read the main run\'s route decision, which does not exist yet when it runs', () => {
  const text = readFileSync(join(root, 'src', 'cli.js'), 'utf8');
  const start = text.indexOf('function priceSideRunAndExit('); assert.ok(start > 0);
  const body = text.slice(start, text.indexOf('\n}\n', start));
  assert.doesNotMatch(body, /\bclaudeRouting\b|\bclaudeRoute\b/, 'it reads its caller\'s decision (the `routing` argument), never the later module-level one');
  assert.match(body, /routeLines\(routing\)/);
  const calls = [...text.matchAll(/priceSideRunAndExit\('--(?:rematch|replay)', [^\n]*\);/g)].map(m => m[0]);
  assert.equal(calls.length, 2, 'both side runs call it (CHANGED ACCEPTED, the zero-retention unit: OLD the call ended with the routing argument; NEW it ends with the routing and the zero-retention decision of the same side run. WHY: the zero-retention setting is decided on the same roster, and the pin is that the arguments are the CALLER\'S own, never a later module-level one)'); for (const c of calls) assert.match(c, /Routing, \w+Zero\);$/, c);
});

// ============ THE SESSION ROUTE at each entry point (0.8.4 session switch; Helper A, Agent B) ============
test('EP-9: the CLI session route: the dry run needs NO key and says the one line (the --json dry run too); auto never picks it; a start pauses at the first session stage (exit 3) and asks for no limit; a chain that still bills names it and asks for the limit; a resume with nothing typed stays a session run, and a typed route is the person\'s change', () => {
  const dir = sessionWork(); const base = ['--chain', 'sess', '--task', 'tasks/x.md'];
  // the dry run: no key of any kind (and again with malformed keys), exit 0, the line SSW-w1 once, no word about a key. The session dry run may print more lines after it (the number of times the sessions are asked): only the route line is pinned.
  for (const keys of [KEYS.none, KEYS.malformed]) {
    const dry = run(dir, [...base, '--dry-run', '--claude-route', 'session'], keys);
    assert.equal(dry.status, 0, dry.stdout + dry.stderr);
    assert.equal(dry.stdout.split('\n').filter(l => l === LINE3).length, 1, `the line is printed once: ${dry.stdout.slice(0, 600)}`);
    assert.doesNotMatch(dry.stdout + dry.stderr, /API_KEY|priced as calls straight to Anthropic|through OpenRouter/, 'it says nothing about a key');
    const viaSetting = run(dir, [...base, '--dry-run'], { ...keys, COUNCIL_CLAUDE_ROUTE: 'session' });
    assert.equal(viaSetting.status, 0); assert.ok(viaSetting.stdout.split('\n').includes(LINE3), 'the operator setting says the same line');
  }
  const json = JSON.parse(run(dir, [...base, '--dry-run', '--json', '--claude-route', 'session'], KEYS.none).stdout);
  assert.equal(json.claudeRoute?.route, 'session'); assert.equal(json.claudeRoute?.why, 'chosen'); assert.equal(json.claudeRoute?.seats, 3); assert.equal(json.claudeRoute?.lines?.[0], LINE3, 'the first line of the JSON is the same sentence');
  assert.deepEqual(json.seats.filter(x => x.provider === 'anthropic'), [], 'no seat is a direct Claude seat any more');
  assert.deepEqual(json.seats.filter(x => x.provider === 'external' && /^subscription:/.test(x.model)).map(x => [x.role, x.model]), [['builder', 'subscription:opus-5.5'], ['critics[1]', 'subscription:sonnet-5.5'], ['critics[2]', 'subscription:haiku-5.5']], 'each Claude seat names its session');
  assert.deepEqual(json.missingKeys ?? [], [], 'no key is missing for a session run');
  // auto never picks it: with no key at all the same dry run is the direct one and prints no session line
  const auto = run(dir, [...base, '--dry-run'], KEYS.none);
  assert.equal(auto.status, 0, auto.stdout + auto.stderr); assert.doesNotMatch(auto.stdout, /answered by your own Claude Code session/, 'auto never picks the session route');
  // a START: no key, exit 3 at the first session stage (the builder), no limit asked, nothing reserved, the route recorded
  const RUN = '2026-11-10T11-00-00-000Z'; const rd = join(dir, 'runs', RUN);
  const first = run(dir, [...base, '--run-id', RUN, '--claude-route', 'session'], KEYS.malformed);
  assert.equal(first.status, 3, `paused at its first session stage, not at a limit (21) or a key (5): ${first.stdout.slice(-500)}${first.stderr.slice(-500)}`);
  assert.deepEqual(needsOf(rd), ['NEEDS-build.md'], 'the builder seat is the first stage a session answers');
  assert.ok(!readdirSync(rd).some(f => /^cap-screen/.test(f)), 'no limit screen was written: a fully converted chain asks for no spending limit');
  assert.deepEqual(paidReservations(rd), [], 'nothing was reserved'); assert.equal(runJsonOf(rd).claude_route, 'session', 'run.json says session');
  assert.ok((first.stdout + first.stderr).includes(LINE3) || readFileSync(join(rd, 'run.log'), 'utf8').includes(LINE3), 'the start log says the line');
  // a resume with NOTHING typed, with a well-formed Anthropic key and a well-formed OpenRouter key in the environment (the dry run prices it; it calls nothing): still the session route, why `recorded`, no seat to the API
  const bareDry = JSON.parse(run(dir, ['--resume', rd, '--dry-run', '--json'], KEYS.both).stdout);
  assert.equal(bareDry.claudeRoute?.route, 'session'); assert.equal(bareDry.claudeRoute?.why, 'recorded'); assert.deepEqual(bareDry.seats.filter(x => x.provider === 'anthropic'), [], 'a key in the environment does not move a session run to the API');
  // the person's own route on a resume IS a change, obeyed (no route_changed stop): priced here with --dry-run, never run
  const typedDry = run(dir, ['--resume', rd, '--claude-route', 'anthropic', '--dry-run', '--json'], KEYS.anthropic);
  assert.equal(typedDry.status, 0, typedDry.stdout + typedDry.stderr); const typed = JSON.parse(typedDry.stdout);
  assert.deepEqual(typed.seats.filter(x => x.provider === 'anthropic').map(x => x.role), ['builder', 'critics[1]', 'critics[2]'], 'a typed anthropic sends the Claude seats to the API again');
  assert.equal(runJsonOf(rd).claude_route, 'session', 'a dry run changes nothing in run.json');
  // a chain that still bills: the line names the paid judge and says the limit covers it; the limit IS asked (exit 21); once typed, the run goes on to the session stage and the record says session
  const MIX = '2026-11-10T11-00-01-000Z'; const mrd = join(dir, 'runs', MIX);
  const mixEnv = { ...KEYS.malformed, OPENROUTER_API_KEY: `sk-or-v1-${'e'.repeat(40)}`, COUNCIL_ALLOW_LOOPBACK_KEY_HOST: '1' };
  const mix = run(dir, ['--chain', 'sess-mix', '--task', 'tasks/x.md', '--run-id', MIX, '--claude-route', 'session'], mixEnv);
  assert.equal(mix.status, 21, `a chain that still bills asks for the limit: ${mix.stdout.slice(-500)}${mix.stderr.slice(-500)}`);
  assert.ok(readFileSync(join(mrd, 'cap-screen-1.md'), 'utf8').includes(LINE3_MIX), 'the limit screen names what the limit is for');
  typeCap(mrd, '5');
  const mixGo = run(dir, ['--resume', mrd], mixEnv);      // nothing typed: still a session run
  assert.equal(mixGo.status, 3, `${mixGo.stdout.slice(-500)}${mixGo.stderr.slice(-500)}`); assert.deepEqual(needsOf(mrd), ['NEEDS-build.md']);
  assert.equal(runJsonOf(mrd).claude_route, 'session'); assert.equal(runJsonOf(mrd).maxUsd, 5, 'the typed limit is the limit');
  assert.deepEqual(paidReservations(mrd), [], 'and the paid judge was never reached');
});

test('EP-10: the library: price with claudeRoute session needs no key and says so; auto never picks it', () => {
  const dir = sessionWork(); const claudeSeats = JSON.parse(readFileSync(join(dir, 'chains', 'sess.json'), 'utf8')).seats; const n = [claudeSeats.builder, ...claudeSeats.critics].filter(x => x.provider === 'anthropic').length;
  assert.equal(n, 3, 'premise: the chain has three Claude seats');
  for (const env of [KEYS.none, KEYS.malformed, KEYS.anthropic]) {
    const p = Api.price({ chain: 'sess', cwd: dir, claudeRoute: 'session', env });
    assert.deepEqual([p.claudeRoute?.route, p.claudeRoute?.why, p.claudeRoute?.seats], ['session', 'chosen', n]);
    assert.ok(!p.rows.some(r => /^anthropic\//.test(r.seat)), 'no row is priced as an API call to Anthropic');
  }
  assert.equal(Api.price({ chain: 'sess', cwd: dir, env: KEYS.none }).claudeRoute?.route === 'session', false, 'auto never picks the session route');
  assert.equal(Api.price({ chain: 'sess', cwd: dir, claudeRoute: 'auto', env: KEYS.anthropic }).claudeRoute, undefined);
});

test('EP-11: the MCP tools: dry_run and start_run take claude_route session; the start answer carries claude_route_note (the same line) and only for a session route', async () => {
  const dir = sessionWork(); const s = session(dir, KEYS.malformed);
  try {
    const dry = await s.call('dry_run', { chain: 'sess', json: true, claude_route: 'session' });
    assert.equal(dry.claudeRoute?.route, 'session', JSON.stringify(dry).slice(0, 400)); assert.equal(dry.claudeRoute?.lines?.[0], LINE3);
    const start = await s.call('start_run', { chain: 'sess', task: 'tasks/x.md', claude_route: 'session' });
    assert.equal(start.started, true, JSON.stringify(start).slice(0, 400)); assert.equal(start.claude_route_note, LINE3, 'the answer says which seats go to sessions and what still bills (here nothing)');
    const rd = join(dir, 'runs', readdirSync(join(dir, 'runs'))[0]);
    assert.ok(await until(() => existsSync(join(rd, 'NEEDS-build.md'))), 'the run paused at its first session stage');
    assert.equal(runJsonOf(rd).claude_route, 'session'); assert.deepEqual(paidReservations(rd), []);
    const other = await s.call('start_run', { chain: 'plain-mock', task: 'tasks/x.md', claude_route: 'anthropic' });      // a free chain: it runs to its end, offline
    assert.equal(other.started, true, JSON.stringify(other).slice(0, 300)); assert.equal(other.claude_route_note, undefined, 'no note for a route that is not session');
  } finally { await s.close(); }
});

test('EP-12 (THE MONEY ROW): a session run that is resumed with NO route typed never goes to the API, with a well-formed Anthropic key and OpenRouter key in the environment: over the CLI (exit 3 again, the same NEEDS file, nothing reserved, run.json still session) and over MCP (submit_stage resumes in session mode and the run pauses at the next session seat)', async () => {
  const dir = sessionWork(); const port = await closedPort();
  const seat = (model, lab) => ({ provider: 'openrouter', model, lab, maxTokens: 500, baseUrl: `http://127.0.0.1:${port}/v1`, extra: { provider: { ignore: ['open-inference'] } } });      // a Claude model through OpenRouter at a closed port: a regression could reach nothing but that port
  writeFileSync(join(dir, 'chains', 'sess-or.json'), JSON.stringify(sessionChain('sess-or', { builder: seat('anthropic/claude-haiku-5.5', 'haiku5.5-or'), critics: [seat('anthropic/claude-opus-5.5', 'opus5.5-or'), seat('anthropic/claude-sonnet-5.5', 'sonnet5.5-or')] })));      // every judge is a Claude seat too, so after the builder's answer the only seat that can be asked next is a Claude judge (a mock judge could have objected first and sent the run to the reviser, hiding a regression)
  const env = { ...BASE, ANTHROPIC_API_KEY: 'sk-test-dummy-key', OPENROUTER_API_KEY: `sk-or-v1-${'e'.repeat(40)}`, COUNCIL_ALLOW_LOOPBACK_KEY_HOST: '1' };      // no COUNCIL_CLAUDE_ROUTE: a typed route on a resume is the person's change (EP-9)
  // the CLI
  const RUN = '2026-11-10T11-00-02-000Z'; const rd = join(dir, 'runs', RUN);
  const first = run(dir, ['--chain', 'sess-or', '--task', 'tasks/x.md', '--run-id', RUN, '--claude-route', 'session'], env);
  assert.equal(first.status, 3, `${first.stdout.slice(-500)}${first.stderr.slice(-500)}`); const needs = needsOf(rd); assert.deepEqual(needs, ['NEEDS-build.md']);
  const bare = run(dir, ['--resume', rd], env);
  assert.equal(bare.status, 3, `a bare resume of a session run pauses again at the same session stage; it does not call a seat: ${bare.stdout.slice(-600)}${bare.stderr.slice(-600)}`);
  assert.deepEqual(needsOf(rd), needs, 'the same NEEDS file'); assert.deepEqual(paidReservations(rd), [], 'no paid call was reserved'); assert.equal(runJsonOf(rd).claude_route, 'session', 'run.json still says session');
  assert.ok((bare.stdout + bare.stderr).includes(LINE3) || readFileSync(join(rd, 'run.log'), 'utf8').includes(LINE3), 'the resumed sitting says it is still a session run');
  // MCP: the server's own environment holds the same keys; start in session mode, answer the builder, and the resumed run must pause at the next Claude seat (a judge) instead of calling it
  const s = session(dir, env);
  try {
    const start = await s.call('start_run', { chain: 'sess-or', task: 'tasks/x.md', claude_route: 'session' });
    assert.equal(start.started, true, JSON.stringify(start).slice(0, 400)); assert.equal(start.claude_route_note, LINE3);
    const id = readdirSync(join(dir, 'runs')).find(n => n !== RUN); const mrd = join(dir, 'runs', id);
    assert.ok(await until(() => existsSync(join(mrd, 'NEEDS-build.md'))), 'paused at the builder');
    const sub = await s.call('submit_stage', { run: id, stage: 'build', content: '# Plan\n\nA short plan with enough words in it to be a real answer to the stage.\n' });
    assert.equal(sub.resumed, true, JSON.stringify(sub).slice(0, 400));
    const next = await until(() => needsOf(mrd).filter(f => f !== 'NEEDS-build.md')[0]);
    assert.ok(next, `the resumed run paused at the next session seat (a judge) instead of calling it: ${needsOf(mrd)}`); assert.doesNotMatch(next, /revis/, 'it is a judge that is asked next, not the reviser');
    assert.equal(runJsonOf(mrd).claude_route, 'session'); assert.deepEqual(paidReservations(mrd), [], 'no paid call was reserved');
  } finally { await s.close(); }
});

test('EP-13: the missing-key sentence of the Anthropic key names the session route as a way out (SSW-w12)', () => {
  const dir = sessionWork();
  const r = run(dir, ['--chain', 'sess', '--task', 'tasks/x.md'], KEYS.none);
  assert.equal(r.status, 5, r.stdout + r.stderr);
  const text = (r.stdout + r.stderr).replace(/\s+/g, ' ');
  assert.ok(text.includes('Set ANTHROPIC_API_KEY in your .env file. Or answer the Claude seats with Claude Code sessions of your own: choose the session route (--claude-route session, or the claude_route argument set to "session").'), text.slice(0, 800));
});

test('EP-14 (THE MONEY ROW, the move away): a session run that started with no limit and is resumed with `--claude-route anthropic` typed asks for the limit first (exit 21, no reservation, no usage file, no call); only once the limit is typed does it go to the API', () => {
  // FIX 1 of the unit review (C&C: a session run leaves session only by a route typed at that resume, "cap asked first"). The CLI child gets a preload that replaces fetch with a recorder that refuses the connection (nothing is sent anywhere; a refused connection is the one failure that proves nothing was billed), so "goes to the API" is read from the recorded url, never from the network.
  const dir = sessionWork(); const calls = join(dir, 'api-calls.log'); const preload = join(dir, 'fetch-recorder.mjs');
  // its own chain: ONE direct Claude seat (the builder, small cap, so the worst case the limit is checked against is cents and the typed 5 covers it) and mock judges
  writeFileSync(join(dir, 'chains', 'sess-one.json'), JSON.stringify(sessionChain('sess-one', { builder: { provider: 'anthropic', model: 'claude-haiku-5-5', maxTokens: 2000, lab: 'haiku5.5', extra: { output_config: { effort: 'high' } } }, critics: [MOCK_JUDGE] })));
  writeFileSync(preload, `import { appendFileSync } from 'node:fs';\nglobalThis.fetch = async (url) => { appendFileSync(${JSON.stringify(calls)}, String(url) + '\\n'); throw Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:9'), { code: 'ECONNREFUSED' }) }); };\n`);
  const env = { ...KEYS.anthropic, NODE_OPTIONS: `--import=${preload}` };
  const RUN = '2026-11-10T11-00-03-000Z'; const rd = join(dir, 'runs', RUN);
  const first = run(dir, ['--chain', 'sess-one', '--task', 'tasks/x.md', '--run-id', RUN, '--claude-route', 'session'], env);
  assert.equal(first.status, 3, `a fully converted chain starts with no limit and pauses at its first session stage: ${first.stdout.slice(-400)}${first.stderr.slice(-400)}`);
  assert.ok(!readdirSync(rd).some(f => /^cap-screen/.test(f)), 'the start asked for no limit');
  // the real resume (not a dry run) with the person's own typed route: the limit is asked FIRST
  const move = run(dir, ['--resume', rd, '--claude-route', 'anthropic'], env);
  assert.equal(move.status, 21, `the move to the API asks for the spending limit before anything is sent: ${move.stdout.slice(-500)}${move.stderr.slice(-500)}`);
  assert.ok(readdirSync(rd).some(f => /^cap-screen/.test(f)), 'the limit screen is on disk');
  assert.deepEqual(paidReservations(rd), [], 'nothing was reserved before the limit was typed');
  assert.deepEqual(readdirSync(rd).filter(f => /^(build|panel-|critique-|revise)/.test(f) && f.endsWith('.usage.json')), [], 'no Claude seat has a usage file: it made no call');
  const sentTo = () => (existsSync(calls) ? readFileSync(calls, 'utf8').split('\n').filter(Boolean) : []);
  assert.deepEqual(sentTo().filter(u => /api\.anthropic\.com|openrouter\.ai/.test(u)), [], 'no request was attempted: nothing reached a provider before the limit was typed');
  // the limit typed: now the run goes to the API route (the recorder sees the request and refuses the connection; the run does not pause at a session stage any more)
  typeCap(rd, '5');
  const go = run(dir, ['--resume', rd, '--claude-route', 'anthropic'], env);
  assert.notEqual(go.status, 21, `the typed limit is accepted: ${go.stdout.slice(-300)}${go.stderr.slice(-300)}`);
  assert.notEqual(go.status, 3, `the run did not pause at a session stage: it moved to the API route: ${go.stdout.slice(-300)}${go.stderr.slice(-300)}`);
  assert.ok(sentTo().some(u => u.startsWith('https://api.anthropic.com/v1/messages')), `a Claude seat was sent to the Anthropic API: ${JSON.stringify(sentTo())}`);
});
