// 0.8.2 (owner, 6 Oct 2026, "yes" to two new single seats): advise-single-glm-flash and advise-single-qwen.
// Their dollar ceiling is the one the person is shown ("up to $X") and the one a failed start is counted at, so it is derived, not copied:
// first call at the brief limit + one retry at the add-on's 64,000-token retry cap, plus a 15% margin (the margin advise-single's $1.32 carries).
// Found by the item 1 review: both chains first shipped with advise.usd 1.5 copied from advise-single-astra (80x the worst case of the cheaper one).
// Offline, $0. The zdr flag is checked against the retention table for EVERY advice chain, so a class-B seat cannot lose its routing flag silently.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { priceOfChain } from '../src/send-path-refusals.js';
import { BRIEF_MAX_CHARS } from '../src/advice-brief.js';
import { priceOf } from '../src/cost.js';
import { retentionRowOf } from '../src/advice-tier.js';
import { SEAT_CHAINS } from '../src/send-profiles.js';
import { cutOffRetryCap } from '../src/chain.js';
import { ADVICE_RETRY_MAX_TOKENS } from '../src/advise.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const chain = n => JSON.parse(readFileSync(join(root, 'chains', `${n}.json`), 'utf8'));

test('the two new single seats are reachable by their advisor keys and their ceiling covers one retry without being a copy-paste', () => {
  assert.equal(SEAT_CHAINS['glm-flash'], 'advise-single-glm-flash');
  assert.equal(SEAT_CHAINS.qwen, 'advise-single-qwen');
  for (const name of ['advise-single-glm-flash', 'advise-single-deepseek', 'advise-single-qwen']) {
    const c = chain(name);
    const seat = c.seats.critics[0];
    const first = priceOfChain(c, 'x'.repeat(BRIEF_MAX_CHARS)).worst;
    const price = priceOf(seat.provider, seat.model);
    const inputUsd = first - (seat.maxTokens / 1e6) * price.out;
    // The retry is read from the add-on's own function (src/advise.js asks cutOffRetryCap(asked, ADVICE_RETRY_MAX_TOKENS)), not typed here.
    const retryCap = cutOffRetryCap(seat.maxTokens, ADVICE_RETRY_MAX_TOKENS);
    const needed = first + (retryCap / 1e6) * price.out + inputUsd;
    assert.ok(c.advise.usd >= needed, `${name}: advise.usd ${c.advise.usd} is below first call + retry ${needed.toFixed(4)}`);
    assert.ok(c.advise.usd <= needed * 1.35, `${name}: advise.usd ${c.advise.usd} is more than 35% above first call + retry ${needed.toFixed(4)}`);
  }
});

test('every advice chain seat: a class A/B retention row has zdr + data_collection deny in its routing, a class C/D row has no zdr flag', () => {
  const wrong = [];
  for (const f of readdirSync(join(root, 'chains')).filter(f => /^advise-.*\.json$/.test(f))) {
    for (const s of chain(f.slice(0, -5)).seats.critics || []) {
      if (s.provider !== 'openrouter') continue;
      const row = retentionRowOf(s);
      const p = s.extra?.provider || {};
      const zdr = p.zdr === true && p.data_collection === 'deny';
      if (['A', 'B'].includes(row?.class) && !zdr) wrong.push(`${f}: ${s.model} is class ${row.class} but has no zdr routing`);
      if (['C', 'D'].includes(row?.class) && p.zdr === true) wrong.push(`${f}: ${s.model} is class ${row.class} but asks for zdr routing`);
    }
  }
  assert.deepEqual(wrong, []);
});

// The real quote path (council_quote spends and sends nothing): a stdio MCP server, no mock chain, no provider key.
function quote(floor, sensitivity, advisor) {
  const dir = mkdtempSync(join(tmpdir(), 'thc-new-seats-'));
  const brief = { schema_version: 'advice-brief/1', moment: 'before_commit', question: 'Should we drop the legacy invoices column before the release?',
    decision_at_stake: 'A dropped column cannot be restored once the migration has run in production.',
    options_considered: [{ name: 'Drop it now', summary: 'Run the migration before the release.' }, { name: 'Do less', summary: 'Keep the column and add a new one beside it.' }],
    tried: [{ what: 'Ran the migration on a copy of the data', result: 'It passed in 3 seconds.' }], sensitivity, not_included: ['the conversation', 'environment variables'] };
  return new Promise((done, fail) => {
    const child = spawn(process.execPath, [join(root, 'src/cli.js'), '--mcp'], { cwd: dir, env: { PATH: process.env.PATH, HOME: dir, ...(floor ? { COUNCIL_ADVICE_SENSITIVITY_FLOOR: floor } : {}) } });
    let buf = '';
    const timer = setTimeout(() => { child.kill(); fail(new Error('quote timed out')); }, 30_000);
    child.stdout.on('data', d => {
      buf += d; let i;
      while ((i = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1);
        try { const m = JSON.parse(line); if (m.id === 2) { clearTimeout(timer); child.kill(); rmSync(dir, { recursive: true, force: true }); done(m.result); } } catch { /* not JSON-RPC */ }
      }
    });
    const send = o => child.stdin.write(JSON.stringify(o) + '\n');
    send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'new-seats', version: '0' } } });
    send({ jsonrpc: '2.0', method: 'notifications/initialized' });
    send({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'council_quote', arguments: { brief, mode: 'single', advisor } } });
  });
}
const textOf = r => r?.content?.[0]?.text ?? '';

test('council_quote advisor "glm-flash": quoted at the default floor, with its own retention wording and a $0.42 ceiling (was $0.07 before the cap went to 360,000, owner decision of 6 Oct 2026)', async () => {
  const r = await quote(null, 'internal', 'glm-flash');
  assert.ok(!r.isError, textOf(r));
  assert.match(textOf(r), /GLM-5\.3 Flash via OpenRouter/);
  assert.match(textOf(r), /\[class B\]/);
  assert.match(textOf(r), /cannot spend more than \$0\.4200/);
});

test('council_quote advisor "qwen": refused for an internal brief at the default floor (no zero-retention endpoint), quoted for a public brief when the operator set the floor to public', async () => {
  const refused = await quote(null, 'internal', 'qwen');
  assert.equal(refused.isError, true);
  assert.match(textOf(refused), /REFUSED \(sensitivity\).*no endpoint OpenRouter tags zero-data-retention/s);
  const allowed = await quote('public', 'public', 'qwen');
  assert.ok(!allowed.isError, textOf(allowed));
  assert.match(textOf(allowed), /cannot spend more than \$0\.7500/);
});

// Owner decisions of 6 Oct 2026 (plan "Decided 6 Oct evening"): GLM-5.3 Flash and DeepSeek V4.1 Flash answer up to 360,000 tokens (Gemini, Qwen, Sol, Astra, Opus unchanged); and no advice chain carries a wall clock.
test('output caps: GLM Flash and DeepSeek Flash at 360,000, the others as before; no shipped advice chain sets a wall clock', () => {
  const cap = n => chain(n).seats.critics[0].maxTokens;
  assert.equal(cap('advise-single-glm-flash'), 360000);
  assert.equal(cap('advise-single-deepseek'), 360000);
  assert.equal(cap('advise-single-gemini'), 12000, 'Gemini stays (owner: not as cheap)');
  const wall = readdirSync(join(root, 'chains')).filter(f => /^(mock-)?advise-.*\.json$/.test(f)).filter(f => chain(f.slice(0, -5)).advise.max_wall_ms !== undefined);
  assert.deepEqual(wall, [], 'a shipped advice chain still sets advise.max_wall_ms');
});
