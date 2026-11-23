// 0.8.4 HS (Muad 05 Nov 2026 22:19: "THC always needs a handler or too many things will break"): chain-lint REFUSES a layered chain without a handling session, shipped or a person's own; the one named exception is a chain
// whose seats are ALL mock (it runs offline for $0 and needs no keys). $0, offline. The rule is src/chain-lint.js step 1f (kind 'layered-no-handling-session'); `hasHandlingSession` is src/ending.js (an external reviser, else an
// external builder). Also: N4 (the ten shipped layered planning chains allow 7 revisions of layer 1 and 3 of layer 2 per overseer round), plan-default-opro-council's four writer seats are the session, list_chains marks a refused
// chain, and doctor's one-key line is derived from the chain files. Rows HL-1..HL-7.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lintChain } from '../src/chain-lint.js';
import { hasHandlingSession } from '../src/ending.js';
import { resolveChainSeats, everySeatOf } from '../src/chain.js';
import { seatsForOneKey } from '../src/conflict-decider.js';
import { isKeyOptional, envKeyName } from '../src/providers.js';
import * as CN from '../src/chain-name.js';
import { malformedProviderKeys } from './helpers/no-real-keys.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(root, 'src', 'cli.js');
const KIND = 'layered-no-handling-session';
const chainFile = name => JSON.parse(readFileSync(join(root, 'chains', `${name}.json`), 'utf8'));
const SESSION = { provider: 'external', model: 'claude-code-session' };
const kinds = (config, file = '<chain>') => lintChain(config, file).map(f => f.kind);
const layered = () => chainFile('mock-layered');   // all mock, layered, no handling session: the exception
const withSeats = patch => { const c = layered(); c.seats = { ...c.seats, ...patch }; return c; };
const PLAN_CHAINS = readdirSync(join(root, 'chains')).filter(f => /^plan-.*council.*\.json$/.test(f)).sort();

test('HL-1 the rule (pure): a layered chain with no handling session and any non-mock seat is refused; an external reviser (or an external builder with no reviser) passes; an all-mock layered chain passes; an unlayered chain is untouched', () => {
  const has = c => kinds(c).includes(KIND);
  assert.equal(hasHandlingSession(layered()), false, 'PREMISE: mock-layered has no handling session');
  assert.equal(has(layered()), false, 'all seats mock: the one named exception');
  const mixed = withSeats({ decider: SESSION });   // a mock reviser and an external decider: not all mock, no handler
  assert.equal(has(mixed), true);
  assert.equal(has(withSeats({ decider: SESSION, reviser: SESSION })), false, 'an external reviser is the handling session');
  const noReviser = withSeats({ decider: SESSION, builder: SESSION }); delete noReviser.seats.reviser;
  assert.equal(has(noReviser), false, 'with no reviser the builder is read');
  assert.equal(has(withSeats({ builder: SESSION })), true, 'the REVISER is read first: an external builder beside a mock reviser is no handler, and the chain is not all mock');
  const paid = withSeats({}); paid.seats = { ...paid.seats, critics: paid.seats.critics.map((c, i) => (i === 0 ? { ...c, provider: 'openrouter', model: 'qwen/qwen3.7-plus' } : c)) };
  assert.equal(has(paid), true, 'one paid critic and no handler');
  const unlayered = { name: 'u', signoff: 'unanimous', seats: { builder: { provider: 'mock', model: 'mock-builder' }, critics: [{ provider: 'external', model: 'claude-code-session' }] } };
  assert.equal(has(unlayered), false, 'no layers: the rule does not apply');
  const f = lintChain(mixed, '/work/chains/x.json').find(x => x.kind === KIND);
  assert.match(f.message, /layered review panel/);
  assert.match(f.message, /no handling session/);
  assert.match(f.message, /seats\.reviser, or seats\.builder when there is no reviser, is not an external seat/);
  assert.match(f.message, /The one exception is a chain whose seats are all "mock"/, 'the exception is named in the message');
  assert.match(f.fix, /Set "seats\.reviser" in \/work\/chains\/x\.json to an external seat/);
  assert.match(f.fix, /or make every seat of the chain a "mock" seat\./);
  assert.doesNotMatch(f.message, /build check/, 'the build-check wording is held: the message claims nothing about it');
});

test('HL-2 every shipped chain passes the rule (the shipped layered planning chains all have the session as reviser; mock-layered is the all-mock exception), and the seven planning chains allow 7 revisions of layer 1 and 3 of layer 2', () => {
  const all = readdirSync(join(root, 'chains')).filter(f => f.endsWith('.json')).sort();
  for (const f of all) assert.equal(kinds(chainFile(f.slice(0, -5)), join(root, 'chains', f)).includes(KIND), false, f);
  assert.equal(PLAN_CHAINS.length, 7, 'the seven shipped layered planning chains');   // CHANGED ACCEPTED TEST (0.8.4 seats unit, Muad 10 Nov 2026 01:10 and 01:56): was 10; plan-mini-council-sol-session, plan-default-opro-council and plan-china-mini-council retire to chains/outdated/
  for (const f of PLAN_CHAINS) {
    const c = chainFile(f.slice(0, -5));
    assert.equal(hasHandlingSession(c), true, `${f}: an external reviser`);
    // FINDING (not on the owed list of the ladder unit; the shipped chains now carry the ladder key; 10 Nov 2026). OLD: `c.layerRevisions` was { 1: 7, 2: 3 } (N4, Muad 05 Nov 2026 22:15). NEW: every shipped planning chain runs the ladder (his 10 Nov 2026 ruling): the key `ladder` { block: 3, visits: 3 } replaces the per-round counts, and a chain carries no layerRevisions.
    assert.deepEqual(c.ladder, { block: 3, visits: 3 }, f);
    assert.equal(c.layerRevisions, undefined, f);
    // CHANGED ACCEPTED TEST (0.8.4 apply, recorded state): OLD: plan-the-high-council.json was accepted with its own form `(the ladder, block 3 and visits 3)` (its review rules were PENDING). NEW: the reviewed description of that chain carries the standard sentence `runs the ladder (its ladder key: block 3, visits 3): layer 1 revises in blocks of 3, then layer 2 is asked (up to 3 visits)` like the other six, so the one exception is removed (K5). WHY: chains/plan-the-high-council.json description as applied.
    // FINDING (not on the owed list; found by the box set, 10 Nov 2026): plan-the-high-council's description (the new-roster chain, wording pending) names the numbers in its own note, "(the ladder, block 3 and visits 3)", not in the standard sentence the other planning chains carry; the row accepts that form for that one chain only, and no description is changed here (a public sentence needs the owner's yes).
    assert.match(c.description, /runs the ladder \(its ladder key: block 3, visits 3\): layer 1 revises in blocks of 3, then layer 2 is asked \(up to 3 visits\)/, `${f}: the description says the same numbers`);   // OLD: "7 revisions of layer 1 and 3 of layer 2 (layerRevisions)"
    assert.doesNotMatch(`${c.summary ?? ''} ${c.description}`, /allows fewer revisions|fewer models, rounds and revisions/, `${f}: no sentence says it allows fewer revisions than plan-high-council`);
  }
  assert.equal(chainFile('mock-layered').layerRevisions, undefined, 'mock-layered is not part of N4');
});

// CHANGED ACCEPTED TEST (0.8.4 seats unit, Muad 10 Nov 2026 01:10: plan-default-opro-council retires and the quick start names the default chain). OLD: HL-3 pinned the retired one-key chain (session writer seats, an OpenRouter criteria seat, QUICK_START_CHAIN = plan-default-opro-council). NEW: the same pin on plan-mini-council, which is now the quick-start chain; its criteria seat is a paid seat. WHY: the retired chain is gone; the rule (the writer seats and the decider are the session) is unchanged and is checked for every shipped planning chain.
test('HL-3 plan-mini-council: the skeleton, builder, reviser and handoff seats are the session (as in every other shipped planning chain); the criteria stay a paid seat; it is the quick-start chain', () => {
  const c = chainFile('plan-mini-council');
  for (const k of ['skeleton', 'builder', 'reviser', 'handoff']) assert.deepEqual(c.seats[k], SESSION, k);
  assert.deepEqual(c.seats.criteria, { provider: 'external', model: 'subscription:opus-5.5', lab: 'opus5.5-sub', maxTokens: 128000, extra: { reasoning: { effort: 'high' } } }, 'the criteria seat is the one the handler session answers (subscription:opus-5.5), as in every shipped planning chain');
  assert.deepEqual(c.seats.decider, SESSION);
  assert.equal(CN.QUICK_START_CHAIN, 'plan-mini-council', 'the name the README and doctor use');
  for (const other of PLAN_CHAINS) for (const k of ['skeleton', 'builder', 'reviser', 'handoff']) assert.deepEqual(chainFile(other.slice(0, -5)).seats[k], SESSION, `${other} ${k}`);
});

function project(chains) {
  const dir = mkdtempSync(join(tmpdir(), 'thc-hl-')); mkdirSync(join(dir, 'chains')); mkdirSync(join(dir, 'tasks'));
  writeFileSync(join(dir, 'tasks', 't.md'), '# A plan\n');
  for (const [name, config] of Object.entries(chains)) writeFileSync(join(dir, 'chains', `${name}.json`), JSON.stringify({ ...config, name }));
  return { dir, run: args => spawnSync(process.execPath, [cli, ...args], { cwd: dir, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: dir }, timeout: 120_000 }), done: () => rmSync(dir, { recursive: true, force: true }) };
}

test('HL-4 (real verbs) the CLI refuses a handler-less layered chain with exit 1 and the lint lines on a run, a dry run and `doctor --chain`; an all-mock layered chain is not refused', () => {
  const p = project({ 'hl-mixed': withSeats({ decider: SESSION }), 'hl-allmock': layered() });
  try {
    const dry = p.run(['--chain', 'hl-mixed', '--task', 'tasks/t.md', '--dry-run']);
    assert.equal(dry.status, 1, dry.stdout + dry.stderr);
    assert.match(dry.stderr, /\[layered-no-handling-session\] This chain has a layered review panel/);
    assert.match(dry.stderr, /fix: Set "seats\.reviser" in .*hl-mixed\.json to an external seat/);
    const run = p.run(['--chain', 'hl-mixed', '--task', 'tasks/t.md']);
    assert.equal(run.status, 1, run.stdout + run.stderr);
    assert.deepEqual(readdirSync(p.dir).sort(), ['chains', 'tasks'], 'nothing was started: no run folder');
    const doctor = p.run(['doctor', '--chain', join(p.dir, 'chains', 'hl-mixed.json')]);
    assert.equal(doctor.status, 1, doctor.stdout + doctor.stderr);
    assert.match(doctor.stderr, /\[layered-no-handling-session\]/);
    const ok = p.run(['--chain', 'hl-allmock', '--task', 'tasks/t.md', '--dry-run']);
    assert.notEqual(ok.status, 1, ok.stdout + ok.stderr);
    assert.doesNotMatch(ok.stderr, /layered-no-handling-session/);
  } finally { p.done(); }
});

function mcpSession(cwd, calls, timeoutMs = 60_000) {
  return new Promise((done, fail) => {
    const child = spawn(process.execPath, [cli, '--mcp'], { cwd, env: { PATH: process.env.PATH, HOME: cwd, ...malformedProviderKeys() } });   // test/no-paid-chain-spawn.test.js: a spawned MCP server never sees a real key
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
        else if (m.id !== undefined) { answers.push(m.result.content[0].text); sendNext(); }
      }
    });
    send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'hl-test', version: '0' } } });
  });
}

test('HL-5 (real verb, MCP) list_chains MARKS a refused chain with the first lint reason and keeps it in the list; a clean chain has no `refused` field; the tool description says so', async () => {
  const p = project({ 'hl-mixed': withSeats({ decider: SESSION }), 'hl-allmock': layered() });
  try {
    const [text] = await mcpSession(p.dir, [{ name: 'list_chains', arguments: {} }]);
    const rows = JSON.parse(text);
    const by = n => rows.find(r => r.name === n);
    assert.equal(by('hl-mixed')?.refused, KIND, 'the refused chain stays in the list, marked');
    assert.equal('refused' in by('hl-allmock'), false);
    const shippedLayered = rows.filter(r => r.name === 'mock-layered' || /^plan-.*council/.test(r.name));
    assert.ok(shippedLayered.length >= 8, 'the shipped layered chains are listed');   // CHANGED (0.8.4 seats unit): was >= 11; three layered chains retired
    assert.deepEqual(shippedLayered.filter(r => 'refused' in r).map(r => r.name), [], 'no shipped layered chain is marked refused');
    assert.equal('refused' in by('plan-mini-council'), false);
  } finally { p.done(); }
  const src = readFileSync(join(root, 'src', 'mcp', 'server.js'), 'utf8');
  assert.ok(src.includes('A chain with "refused" cannot be started: the chain lint refuses it, and "refused" names the first reason.'), 'the tool description carries the sentence');
});

// CHANGED ACCEPTED TEST (0.8.4 seats unit, Muad 10 Nov 2026 01:10 and 01:56: plan-default-opro-council retires; the default chain seats Claude on the Anthropic key). OLD: doctor's OpenRouter one-key line named plan-default-opro-council first (its criteria seat was a paid OpenRouter seat) and every other planning chain stayed off it. NEW: the qualification is still derived from the files with the doctor's own enumerators, and now no shipped chain qualifies (each answers the criteria stage through the Claude subscription), so doctor prints no one-key line and the derived set is empty. WHY: the line follows the seats; the derivation, the absence of "alone" and of the old caveat are kept.
test('HL-6 (real verb) doctor\'s one-key line is derived from the chain files: the chains whose paid seats sit on one key and whose every other seat is the session (not a subscription seat, not mock) are the ones it names; none qualifies today, so it prints no such line', () => {
  const out = spawnSync(process.execPath, [cli, 'doctor'], { encoding: 'utf8', env: { PATH: process.env.PATH } }).stdout;
  const line = out.split('\n').find(l => l.startsWith('  one key:'));
  // Derive the qualification from the files, with the doctor's own enumerators (resolveChainSeats + everySeatOf, seatsForOneKey, envKeyName, isKeyOptional) and the lint at the chain's REAL path.
  const qualifying = readdirSync(join(root, 'chains')).filter(f => f.endsWith('.json')).map(f => ({ f, c: chainFile(f.slice(0, -5)) })).filter(({ f, c }) => {
    if (c.advise?.enabled) return false;
    let resolved; try { resolved = resolveChainSeats(c); } catch { resolved = c; }
    const rest = seatsForOneKey(resolved, everySeatOf(resolved)).filter(Boolean).filter(s => !(s.provider === 'external' && s.model === 'claude-code-session'));
    const keyNames = [...new Set(rest.map(s => s.provider))].map(p => ((p === 'mock' || p === 'external' || isKeyOptional(p)) ? null : envKeyName(p)));
    return keyNames.length > 0 && keyNames.every(Boolean) && new Set(keyNames).size === 1 && lintChain(c, join(root, 'chains', f)).length === 0;
  }).map(({ f }) => f.slice(0, -5)).sort();
  const named = line ? [...line.matchAll(/([a-z0-9][a-z0-9-]*) \(expected \$/g)].map(m => m[1]) : [];
  assert.deepEqual(qualifying.filter(n => /^plan-.*council$/.test(n)), [], 'no shipped planning chain qualifies: each answers the criteria stage through the Claude subscription');
  assert.equal(line, undefined, 'so doctor prints no one-key line');
  assert.deepEqual(named, []);
  assert.doesNotMatch(out, /alone runs/, '"alone" would be untrue');
  assert.doesNotMatch(out, /a swing between judge layers pauses the run/, 'the old caveat is gone');
  for (const f of PLAN_CHAINS) assert.equal(qualifying.includes(f.slice(0, -5)), false, `${f}: its criteria seat is a subscription seat, so it is not "one key plus a session"`);
});

test('HL-7 (SOURCE pin) the rule lives in the chain lint only, with no second predicate: chain-lint.js reads hasHandlingSession from src/ending.js, and layerProblems (which runChain also throws) does not carry the rule', () => {
  const lint = readFileSync(join(root, 'src', 'chain-lint.js'), 'utf8');
  assert.match(lint, /import \{ hasHandlingSession \} from '\.\/ending\.js';/);
  assert.match(lint, /kind: 'layered-no-handling-session'/);
  assert.equal(/layered-no-handling-session/.test(readFileSync(join(root, 'src', 'layers.js'), 'utf8')), false);
  assert.equal(/layered-no-handling-session/.test(readFileSync(join(root, 'src', 'chain.js'), 'utf8')), false, 'runChain called directly does not lint (the no-session ending branch stays the backstop)');
});
