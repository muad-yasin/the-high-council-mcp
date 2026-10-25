// 0.8.3 estimator follow-up (RULING A; gate note Estimator_FollowUp_Gate_Note.md, C&C PASS ON CONDITIONS 15 Okt 2026): the dry run's EXPECTED figure prices the debate, reply, alt-debate and alt-reply calls at the chain's typical size
// when it sets estimate.debateOutTokens / replyOutTokens / altDebateOutTokens / altReplyOutTokens (never above the seat's cap), and at today's constants (1500 / 800 / 1500 / 800) when it does not. ONE rule for all seven estimate keys:
// "absent = today's figure" (the first three keys fall back to the cap, these four to the constant). The MAXIMUM figure is untouched. The keys change only what is PRINTED.
// Derivation of the sizes used below (dated): the 7 Oct 2026 run rc-daily7m 2026-10-07T23-46-28-117Z (chain plan-daily-7m-glm53), output tokens INCLUDING thinking, averages: debate 21412 (n=6), reply 13292 (n=6), alt-debate 13004 (n=8),
// alt-reply 20098 (n=2); script Review/Build_0.8.3/m6-closing/est_calib_7oct.py. One run, one roster: a test fixture size, not a recommendation.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { estimateChainRows, SEAT_DEFAULT_MAX_TOKENS } from '../src/cost.js';
import { evaluatePolicy } from '../src/policy.js';

const here = dirname(fileURLToPath(import.meta.url));
const chainsDir = resolve(here, '../chains');
const base = () => JSON.parse(readFileSync(join(chainsDir, 'plan-high-council.json'), 'utf8'));
const withKeys = keys => ({ ...base(), estimate: { ...(base().estimate || {}), ...keys } });
const rowsOf = (config, maximum = false) => estimateChainRows(config, { maximum });
const KEYS = { debate: 'debateOutTokens', reply: 'replyOutTokens', 'alt-debate': 'altDebateOutTokens', 'alt-reply': 'altReplyOutTokens' };
const CONSTANT = { debate: 1500, reply: 800, 'alt-debate': 1500, 'alt-reply': 800 };
const SEVEN_OCT = { debateOutTokens: 21412, replyOutTokens: 13292, altDebateOutTokens: 13004, altReplyOutTokens: 20098 };
const kindOf = label => Object.keys(KEYS).find(k => label.startsWith(`${k}-`));
const stageRows = rows => rows.filter(r => kindOf(r.label));
const sum = rows => rows.reduce((n, r) => n + r.usd, 0);
// The cap a row is clamped to: the maximum pass's output (the seat's maxTokens); an EXTERNAL seat has no maximum row of its own (priced $0, its row keeps the typical path), so the default seat cap applies, as it does for the first three keys.
const capFor = (r, maximumRows) => (r.seat.startsWith('external/') ? SEAT_DEFAULT_MAX_TOKENS : maximumRows.find(m => m.label === r.label).output);

test('SS-1 PIN (cannot go red against today\'s code): for EVERY shipped chain the four stage rows follow THAT chain\'s own keys - absent = the constant (1500 / 800 / 1500 / 800), set = min(key, the seat\'s cap)', () => {
  let checked = 0;
  for (const f of readdirSync(chainsDir).filter(n => n.endsWith('.json')).sort()) {
    const config = JSON.parse(readFileSync(join(chainsDir, f), 'utf8'));
    const expected = rowsOf(config), maximum = rowsOf(config, true);
    for (const r of stageRows(expected)) {
      const kind = kindOf(r.label), key = config.estimate?.[KEYS[kind]];
      const cap = capFor(r, maximum);
      const want = Number.isFinite(key) && key > 0 ? Math.min(key, cap) : CONSTANT[kind];
      assert.equal(r.output, want, `${f} ${r.label}`);
      checked += 1;
    }
  }
  assert.ok(checked > 0, 'at least one shipped chain prices a debate, reply, alt-debate or alt-reply row');
});

test('SS-2 keys set: the debate, reply, alt-debate and alt-reply rows carry the key (clamped to the seat\'s cap) and EVERY OTHER row is byte-identical to the keyless run', () => {
  const plain = rowsOf(base()), keyed = rowsOf(withKeys(SEVEN_OCT)), cap = rowsOf(base(), true);
  assert.equal(keyed.length, plain.length);
  let moved = 0;
  keyed.forEach((r, i) => {
    const kind = kindOf(r.label);
    if (!kind) { assert.deepEqual(r, plain[i], `${r.label} must not move`); return; }
    const capOut = capFor(r, cap);
    assert.equal(r.output, Math.min(SEVEN_OCT[KEYS[kind]], capOut), r.label);
    if (r.output !== plain[i].output) moved += 1;
  });
  assert.ok(moved > 0, 'at least one row moved');
  assert.notEqual(sum(keyed), sum(plain), 'the expected figure changed');
});

test('SS-3 clamp: a key above the seat\'s cap prices at the cap (a seat with maxTokens 5000 and debateOutTokens 21412 prices 5000)', () => {
  const config = withKeys({ debateOutTokens: 21412 });
  config.seats = { ...config.seats, proposers: config.seats.proposers.map(s => ({ ...s, maxTokens: 5000 })) };
  const debates = rowsOf(config).filter(r => r.label.startsWith('debate-') && r.seat !== 'external/claude-code-session');
  assert.ok(debates.length > 0);
  for (const r of debates) assert.equal(r.output, 5000, r.label);
});

test('SS-4 PIN: the MAXIMUM figure is unchanged by the keys (all rows, both passes\' structure)', () => {
  assert.deepEqual(rowsOf(withKeys(SEVEN_OCT), true), rowsOf(base(), true));
});

test('SS-5 PIN: an invalid value (0, -5, \'big\', null, NaN, undefined) is ignored = today\'s constants', () => {
  const plain = rowsOf(base());
  for (const bad of [0, -5, 'big', null, Number.NaN, undefined]) {
    assert.deepEqual(rowsOf(withKeys({ debateOutTokens: bad, replyOutTokens: bad, altDebateOutTokens: bad, altReplyOutTokens: bad })), plain, `${String(bad)} is ignored`);
  }
});

test('SS-6 schema: the four keys are declared (integer, minimum 1) and ALL SEVEN estimate keys say "absent = today\'s figure"', () => {
  const props = JSON.parse(readFileSync(resolve(here, '../config/chain-schema.json'), 'utf8')).properties.estimate.properties;
  for (const k of Object.values(KEYS)) assert.deepEqual([props[k]?.type, props[k]?.minimum], ['integer', 1], k);
  for (const k of ['alternativeOutTokens', 'proposalOutTokens', 'deepDiveOutTokens', ...Object.values(KEYS)]) assert.match(props[k].description, /Absent: today's figure/, k);
});

test('SS-7 policy direction (on purpose): the expected figure rises with the keys, so a policy limit between the keyless and the keyed figure refuses WITH the keys and passes without (policy.js refuses on the expected figure)', () => {
  const plain = sum(rowsOf(base())), keyed = sum(rowsOf(withKeys(SEVEN_OCT)));
  assert.ok(keyed > plain);
  const limit = (plain + keyed) / 2;
  const verdict = config => evaluatePolicy({ max_usd_per_run: limit }, { config, allSeats: [], worstCaseUsd: sum(rowsOf(config)), maximumUsd: sum(rowsOf(config, true)), monthToDateUsd: 0 });
  assert.equal(verdict(base()).ok, true, 'without the keys the limit passes');
  assert.equal(verdict(withKeys(SEVEN_OCT)).ok, false, 'with the keys the same limit refuses');
});
