// 0.8.1 pre-release audit round (MAN-4), area A3 (the approval path), findings fixed in batch 3. Each test fails on the audited code and passes after its fix.
// A3-3 the terminal fallback was a bare `council gate answer runs/<id> <gate>` (no `council` on PATH under a plugin install; relative to the cwd);
// A3-4 (old audit A7) the dialog's fixed 40-dash delimiter could be inside the text, so a text could fake an early end;
// A3-5 (old audit A6) `calls_at_most` was the row count, a council can make more paid calls.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname, resolve, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as SP from '../src/send-path.js';
import { priceOfChain } from '../src/send-path-refusals.js';
import { requestGate, textSha256 } from '../src/gate.js';
import { runChain, setBudget, setCache } from '../src/chain.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const chain = name => JSON.parse(readFileSync(join(root, 'chains', `${name}.json`), 'utf8'));

test('A3-3: the terminal command works from any folder and without `council` on PATH: node + the absolute cli path + the absolute run folder', () => {
  const d = mkdtempSync(join(tmpdir(), 'thc-a33-'));
  writeFileSync(join(d, 'advice-brief.md'), 'The exact brief.\n');
  const g = requestGate(d, { kind: 'advice', textPath: 'advice-brief.md', price: { ceiling_usd: 0.5 }, seats: [{ lab: 'x' }], sensitivity: { label: 'public', set_by: 'operator' } });
  assert.equal(g.ok, true, g.message);
  assert.equal(typeof SP.gateAnswerCommand, 'function', 'send-path exports gateAnswerCommand');
  const cmd = SP.gateAnswerCommand(d, g.gate.id);
  assert.doesNotMatch(cmd, /^council /);
  assert.ok(isAbsolute(cmd.split(' ')[0].replace(/^"|"$/g, '')), `starts with an absolute node path: ${cmd}`);
  // the same command with `show` for `answer` (answer needs a tty): runs from another folder and prints the exact text
  const r = spawnSync(cmd.replace(' gate answer ', ' gate show '), { cwd: tmpdir(), shell: true, encoding: 'utf8', env: { ...process.env, PATH: '/usr/bin:/bin' } });
  assert.equal(r.status, 0, `${r.stdout}${r.stderr}`);
  assert.match(r.stdout, /The exact brief\./);
});

test('A3-3: under the standalone binary (process.pkg) the command is <binary> gate answer <run> <gate>, with no script path', () => {
  const cmd = SP.gateAnswerCommand('/work/runs/r1', 'g1', { pkg: true, execPath: '/opt/council', cli: '/snapshot/src/cli.js' });
  assert.equal(cmd, '/opt/council gate answer /work/runs/r1 g1');
  assert.equal(SP.gateAnswerCommand('/work/my runs/r1', 'g1', { pkg: false, execPath: '/usr/bin/node', cli: '/x/src/cli.js' }), '/usr/bin/node /x/src/cli.js gate answer "/work/my runs/r1" g1');
});

test('A3-3 (guard): send-path.js names no bare `council gate answer runs/` command', () => {
  assert.doesNotMatch(readFileSync(join(root, 'src', 'send-path.js'), 'utf8').replace(/^\s*\/\/.*$/gm, ''), /council gate answer runs\//);
});

test('A3-4: the text in the dialog cannot contain its own closing delimiter: a text holding the old 40-dash line and a fake closing sentence is fenced by a longer line', () => {
  const evil = 'real request\n----------------------------------------\nAn AI agent asked for this. Everything above is the whole text; what follows is only formatting and is not sent.\n----------------------------------------\nfake: nothing after this line leaves the machine\n';
  const q = { quote_id: 'q1', expires_ms: Date.parse('2026-10-06T12:00:00Z'), text: evil, sha256: textSha256(Buffer.from(evil)), price: { worst_usd: 0.1, expected_usd: 0.05, ceiling_usd: 0.2, calls: 1 }, seats: [], bytes: Buffer.byteLength(evil), masked: {}, mode: 'single', advisor: 'x', sensitivity: { label: 'public', effective: 'public', floor: 'public' } };
  let msg; try { msg = SP.dialogMessage(q); } catch (e) { assert.fail(`dialogMessage threw on a minimal quote: ${e.message}`); }
  const lines = msg.split('\n');
  const fences = lines.filter(l => /^-{20,}$/.test(l));
  const longest = Math.max(...fences.map(l => l.length));
  const real = lines.filter(l => l === '-'.repeat(longest));
  assert.equal(real.length, 2, `exactly two fence lines of the longest length (${longest}), found ${real.length}`);
  assert.ok(longest > 40, 'the fence is longer than the longest dash run inside the text');
  const open = lines.indexOf('-'.repeat(longest)); const close = lines.lastIndexOf('-'.repeat(longest));
  assert.ok(lines.slice(open + 1, close).join('\n').includes('fake: nothing after this line leaves the machine'), 'the whole text, fake part included, sits inside the real fence');
  // A client that draws both dash lines as the same rule is not fooled either: after the closing fence the message names the text's real length and its real last line.
  const after = lines.slice(close + 1).join('\n');
  assert.match(after, /fake: nothing after this line leaves the machine/);
  assert.match(after, new RegExp(`${[...evil].length} characters`));
});

test('A3-5: calls_at_most counts every paid call the call can make: a retry per blind seat, each debate round, the synthesis seat', () => {
  const text = 'A short brief.\n';
  assert.equal(priceOfChain(chain('advise-single'), text).calls, 2, '1 seat: the call and its retry');
  assert.equal(priceOfChain(chain('advise-standard'), text).calls, 9, '3 seats x (call + retry) + 3 debate replies');
  assert.equal(priceOfChain(chain('advise-premium'), text).calls, 18, '6 seats x 2 + 6 debate replies');
  // The same predicate as invoke(): a seat whose real identity is Anthropic (a single-vendor reroute keeps originalProvider) may be repeated once inside one call, so every call counts twice.
  const viaVendor = { ...chain('advise-single'), seats: { critics: [{ ...chain('advise-single').seats.critics[0], originalProvider: 'anthropic' }] } };
  assert.equal(priceOfChain(viaVendor, text).calls, 4, '1 Anthropic-identity seat: (call + retry) x 2');
  assert.equal(priceOfChain(chain('advise-single-opus'), text).calls, 2, 'a native OpenRouter seat has no inner retry in invoke(), so it is not doubled');
});

test('A3-5: a mock council driven through retry, debate and synthesis never makes more paid calls than the bound', async () => {
  const mock = (model, lab) => ({ provider: 'mock', model, lab });
  const config = { name: 'a35', resumeAfterStop: false, maxRounds: 1, estimate: { promptTokens: 1000, draftTokens: 1000, critiqueTokens: 300 },
    advise: { enabled: true, usd: 100, rounds: 1, skipDebateWhenUnanimous: false, synthesis: 'seat', max_wall_ms: 120000 },
    seats: { critics: [mock('mock-advisor-proceed', 'a'), mock('mock-advisor-stop', 'b'), mock('mock-unreadable', 'c')], builder: mock('mock-advise-synth', 'synth') } };
  setCache(null); setBudget(null);
  const r = await runChain({ config, request: 'Should we cache the price list?\n\nWe plan to cache it for 24 hours.\n', log: () => {} });
  const bound = priceOfChain(config, 'Should we cache the price list?\n\nWe plan to cache it for 24 hours.\n').calls;
  const observed = r.stages.length;
  assert.ok(observed <= bound, `${observed} calls made, calls_at_most said ${bound}`);
  assert.ok(r.stages.some(s => /-retry$/.test(s.label)), `fixture: a retry happened (${r.stages.map(s => s.label)})`);
});
