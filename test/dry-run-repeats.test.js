// Unit 4 (his picks OWNER 5 and OWNER 6, 03 Nov 2026, heading "PLAN A'S OWNER ITEMS ..."): the dry run's UPPER estimate includes a silent judge's re-asks and the automatic retries after a network error, each at the EXPECTED cost
// of the call it repeats ("the figure is no longer a true maximum"). Only the maximum pass gets them; the expected figure is unchanged. The rows are derived here by hand from the expected pass, not copied from the function under test.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import * as costNs from '../src/cost.js';
import { resolveChainSeats } from '../src/chain.js';
import { readChainFile } from './helpers/chain-file.js';

const { estimateChainRows } = costNs;
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
// CHANGED (0.8.4 H-CC-a): OLD read chains/<name>.json only. NEW reads the shipped folder first, then chains/outdated/ (test/helpers/chain-file.js): daily7-sub-a, the one plain unanimous, unlayered, PRICED chain these rows use, moved there. The claims are properties (the same figure twice, a re-ask row of two per panel row), not "a shipped chain".
const chainOf = name => resolveChainSeats(readChainFile(root, name));
const near = (a, b) => Math.abs(a - b) < 1e-9;
const reasks = rows => rows.filter(r => /-reask$/.test(r.label));

test('the bounds the upper estimate prices with are the run\'s own: three network retries a run, two in-pass re-asks a seat (chain.js defines neither a second time)', () => {
  assert.equal(costNs.NETWORK_RESUMES_PER_RUN, 3); assert.equal(costNs.IN_PASS_REASKS_PER_SEAT, 2);
  const chain = readFileSync(join(root, 'src', 'chain.js'), 'utf8');
  assert.ok(!/^const NETWORK_RESUMES_PER_RUN\s*=/m.test(chain), 'chain.js imports the constant from cost.js');
  assert.ok(/NETWORK_RESUMES_PER_RUN[^\n]*\} from '\.\/cost\.js'/.test(chain), 'and it is the same one');
  // CHANGED ACCEPTED (0.8.4 S6 U6-5, 47d33ca8 replaced the literal `reask <= 2` with the constant; the box run of 08 Nov 2026 showed this scan still wanting digits): the loop's bound IS the constant the upper estimate prices, imported from cost.js.
  assert.ok(/for \(let reask = 1; reask <= IN_PASS_REASKS_PER_SEAT &&/.test(chain), 'chain.js re-asks a silent judge in a counted loop');
  assert.ok(/IN_PASS_REASKS_PER_SEAT[^\n]*\} from '\.\/cost\.js'/.test(chain), 'and its bound is the number the upper estimate prices (the constant of cost.js)');
});

test('a layered chain: the upper estimate has a re-ask row for every panel row, twice per review call at the review\'s EXPECTED output; the expected figure has none', () => {
  const config = chainOf('plan-china-medium-council');
  const expected = estimateChainRows(config); const max = estimateChainRows(config, { maximum: true });
  assert.equal(reasks(expected).length, 0, 'the expected figure is unchanged: no re-ask rows');
  // CHANGED ACCEPTED TEST (0.8.4 apply, recorded state): OLD: only `-reask` and `-solo` rows were excluded from the review rows. NEW: also the top layer's sign-off re-ask row `<panel row>-reask3` (one panel-kind call per top-layer seat, priced in the maximum only), which is a re-ask row, not a review row (K6). WHY: signoffRefusedReaskNote and the shortened-exchange pair are recorded (src/cost.js:624-632, signoffReaskRows).
  const panels = max.filter(r => /^panel-L\d+-/.test(r.label) && !/-(reask\d*|solo)$/.test(r.label) && r.usd > 0);   // CHANGED ACCEPTED (0.8.4 ladder unit, the solo ask; owed list 'Solo ask: dry-run rows that print re-ask counts', 10 Nov 2026). OLD: only `-reask` rows were excluded. NEW: the solo ask's `-solo` row (one call, priced beside the re-asks) is not a review row either
  assert.ok(panels.length >= 2, 'fixture: the chain has layered panel rows');
  for (const p of panels) {
    const re = max.find(r => r.label === `${p.label}-reask`);
    assert.ok(re, `${p.label}: a re-ask row`);
    assert.equal(re.times, 2 * (p.times || 1), `${p.label}: two re-asks per review call`);
    const exp = expected.find(r => r.label === p.label);   // the expected pass prices the same review at its expected output, once per round it runs
    assert.ok(exp && re.output / re.times === exp.output / (exp.times || 1), `${p.label}: priced at the review's expected output (${re.output / re.times}), not its cap`);
    assert.ok(re.usd / re.times <= p.usd / (p.times || 1), `${p.label}: one re-ask costs no more than the review row at its whole allowance`);
  }
});

test('a plain unanimous chain: each panel row of each round has a re-ask row of two; a final read has one', () => {
  const config = chainOf('daily7-sub-a');
  const max = estimateChainRows(config, { maximum: true });
  const panels = max.filter(r => /^panel-\d+-/.test(r.label) && !/-(reask|solo)$/.test(r.label) && r.usd > 0);   // CHANGED ACCEPTED (0.8.4 ladder unit, the solo ask; owed list 'Solo ask: dry-run rows that print re-ask counts', 10 Nov 2026). the `-solo` row is not a review row   // an external seat (a person or a session) prices $0 and adds no re-ask row
  assert.ok(panels.length >= 3, 'fixture: the chain has priced panel rows');
  for (const p of panels) assert.equal(max.find(r => r.label === `${p.label}-reask`)?.times, 2, `${p.label}: two re-asks`);
  const layered = chainOf('plan-china-medium-council');
  const finalRead = estimateChainRows(layered, { maximum: true }).filter(r => /^final-read-L\d+-.*-reask$/.test(r.label));
  if (layered.final_read?.enabled === true) assert.ok(finalRead.length >= 1 && finalRead.every(r => (r.times || 1) === 1), 'one re-ask per top-layer final read');
});

test('network retries: ONE row in the upper estimate only, three of them at the expected cost of the dearest planned call; none when no call is priced', () => {
  for (const name of ['plan-china-medium-council', 'daily7-sub-a']) {
    const config = chainOf(name);
    const expected = estimateChainRows(config); const max = estimateChainRows(config, { maximum: true });
    assert.equal(expected.filter(r => r.label === 'network-retries').length, 0, `${name}: the expected figure has none`);
    const rows = max.filter(r => r.label === 'network-retries'); assert.equal(rows.length, 1, `${name}: one row`);
    const dearest = Math.max(...expected.filter(r => !/^(deep-dive|advise)-/.test(r.label)).map(r => r.usd / (r.times || 1)));
    assert.equal(rows[0].times, 3);
    assert.ok(near(rows[0].usd, 3 * dearest), `${name}: ${rows[0].usd} is three times the dearest call's expected cost (${dearest})`);
  }
  const free = estimateChainRows(chainOf('mock-open'), { maximum: true });
  assert.equal(free.filter(r => r.label === 'network-retries').length, 0, 'a chain with no priced call gets none');
});

test('the expected figure of every shipped chain is unchanged by the repeat rows (they live in the maximum pass only)', () => {
  for (const name of ['plan-china-medium-council', 'daily7-sub-a', 'mock-layered', 'mock-open']) {
    const rows = estimateChainRows(chainOf(name));
    assert.ok(!rows.some(r => /-reask$/.test(r.label) || r.label === 'network-retries'), name);
  }
});

// DUALCAP (Mini-C&C, 04 Nov 2026): the bound of three is per RUN, so the network-retries row belongs to every cap's figure and to the whole run's once; a cap's upper estimate may err high, never low.
test('the network-retries row is account-neutral: every cap\'s figure includes it in full, the whole run counts it once', () => {
  const config = chainOf('plan-china-medium-council');
  const rows = estimateChainRows(config, { maximum: true, accounts: true });
  const net = rows.find(r => r.label === 'network-retries');
  assert.ok(net && net.allCaps === true && !('account' in net) && typeof net.note === 'string' && /every cap/.test(net.note), 'one row, no account, flagged for every cap, with its note');
  assert.equal(typeof costNs.rowBillsThroughCap, 'function');
  const caps = [...new Set(rows.map(r => r.account).filter(Boolean))];
  assert.ok(caps.length >= 1, 'fixture: the chain bills through at least one cap account');
  for (const cap of caps) {
    assert.ok(costNs.rowBillsThroughCap(net, cap), `${cap}: counts the retries`);
    const capTotal = rows.filter(r => costNs.rowBillsThroughCap(r, cap)).reduce((n, r) => n + r.usd, 0);
    const own = rows.filter(r => r.account === cap).reduce((n, r) => n + r.usd, 0);
    assert.ok(near(capTotal, own + net.usd), `${cap}: its figure is its own rows plus the retries in full (${capTotal})`);
  }
  assert.ok(costNs.rowBillsThroughCap(net, null), 'with no cap, every row counts');
  assert.ok(!costNs.rowBillsThroughCap({ label: 'x', account: 'anthropic' }, 'openai'), 'a row of another account still does not');
  const whole = estimateChainRows(config, { maximum: true }).filter(r => r.label === 'network-retries');
  assert.equal(whole.length, 1, 'and the whole run has the row once');
});

// CHANGED (0.8.4 apply, the README rework; C&C's ruling 13 Nov 2026). OLD: README.md's Pricing paragraph carried the two sentences (what the upper estimate adds, and what it leaves out "(the counted total includes them) ... so it is an estimate, not a ceiling"), and the test matched both whole. NEW: the passage lives in the manual's overview (AI-README.md, "Counted in" and "Not counted in", then "A real run pays for those calls too, so it can cost more than the upper estimate"), the README no longer speaks of the upper estimate (13 Nov 2026, owner: "I want it removed before the PR. This is just about the readme"), so this test reads the manual only. The two bounds stay pinned to the code. The fact "(the counted total includes them)" stays pinned in test/known-limits.test.js.
test('the manual\'s overview says what the upper estimate counts (re-asks: two a pass, one for a final read; network retries: three in a run, at their expected cost) and what it does not (the extra passes of a silent judge, the repeated attempts after a provider error)', () => {
  const ai = readFileSync(join(root, 'AI-README.md'), 'utf8').replace(/\s+/g, ' ');
  const from = ai.indexOf('## Overview');
  const overview = ai.slice(from, ai.indexOf(' ## ', from + 5));
  assert.ok(from !== -1, 'premise: the manual has the Overview section');
  assert.match(overview, /\*\*Counted in:\*\* a judge's re-asks \(up to two a pass, and one for a final read\) and the automatic retries after a network error \(up to three in a run\), each at the expected cost of the call it repeats\./);
  assert.match(overview, /\*\*Not counted in:\*\* the cut-off retry of a seat that is not Anthropic, the extra passes a silent judge can cause, and the repeated attempts after a provider error\./);
  assert.match(overview, /A real run pays for those calls too, so it can cost more than the upper estimate\./);
  assert.equal(costNs.IN_PASS_REASKS_PER_SEAT, 2); assert.equal(costNs.NETWORK_RESUMES_PER_RUN, 3);
});
