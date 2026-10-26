// E4 unit one (gate page Review/Build_0.8.3/m6-closing/E4_Gate_Page.md, approved by C&C 14 Oct 2026): the pure objection ledger. Nothing calls it yet. Namespace access, so a staged red runs the rows against a tree without the module.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const OL = await import('../src/objection-ledger.js').catch(() => ({}));
const ledger = (...a) => OL.objectionLedger(...a);
const fit = (...a) => OL.fitLedger(...a);

const F = (lab, id, extra = {}) => ({ lab, id, criterion: `crit ${id}`, problem: `problem ${id}`, ...extra });
const base = (over = {}) => ({
  openByRound: [{ round: 1, failures: [F('la', 'O-a1')] }], replies: [], reviserByRound: { 1: { declined: [], draftChanged: true } }, draftShaByRound: { 1: 'aaaaaaaaaaaa' },
  heardByRound: { 1: ['la', 'lb'] }, notAskedByRound: {}, layerOf: { la: 1, lb: 2 }, currentRound: 2, ...over,
});
const reply = (round, extra) => ({ round, lab: 'la', id: 'O-a1', status: 'withdrawn', effect: 'withdrawn', ...extra });

test('E4 ledger: a VALIDATED withdrawal given after the last raise closes the row, with the judge\'s reasoning, capped with a visible [cut]', () => {
  const reasoning = 'x'.repeat(OL.EVIDENCE_CAP_CHARS + 50);
  const [row] = ledger(base({ replies: [reply(2, { quoted: true, evidence: reasoning })], currentRound: 3, heardByRound: { 1: ['la'], 2: ['la'] } }));
  assert.equal(row.status, 'closed');
  assert.equal(row.judge.last_disposition, 'withdrawn');
  assert.equal(row.judge.reasoning, 'x'.repeat(OL.EVIDENCE_CAP_CHARS) + OL.CUT_MARK, 'cut, and marked');
  const [exact] = ledger(base({ replies: [reply(2, { evidence: 'y'.repeat(OL.EVIDENCE_CAP_CHARS) })], currentRound: 3 }));
  assert.equal(exact.judge.reasoning.endsWith(OL.CUT_MARK), false, 'exactly the cap is not cut');
});

test('E4 ledger (known-bad input): a withdrawn objection RAISED AGAIN later is active again (a naive reading would keep it closed)', () => {
  const rows = ledger(base({ openByRound: [{ round: 1, failures: [F('la', 'O-a1')] }, { round: 3, failures: [F('la', 'O-a1')] }], replies: [reply(2, {})], currentRound: 4, heardByRound: { 1: ['la'], 2: ['la'], 3: ['la'] } }));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, 'active');
  assert.equal(rows[0].last_raised_round, 3);
  assert.equal(rows[0].first_round, 1);
});

test('E4 ledger: every other disposition keeps the row ACTIVE (refused, sustained, unanswered, stated pass, unreadable), with its ask and quote fields', () => {
  for (const effect of ['withdrawal_refused', 'sustained', 'unanswered', 'stated_pass_open', 'unreadable_answer']) {
    const [row] = ledger(base({ replies: [reply(2, { effect, status: effect === 'sustained' ? 'sustained' : null, ask: 'asked' })], currentRound: 3 }));
    assert.equal(row.status, 'active', effect);
    assert.equal(row.judge.last_disposition, effect);
    assert.equal(row.judge.ask, 'asked');
  }
  const [peer] = ledger(base({ replies: [reply(2, { quoted_from: 'reviewer', quoted_ref: 'lb', quoted_layer: 1 })], currentRound: 3 }));
  assert.deepEqual([peer.judge.quoted_from, peer.judge.quoted_ref, peer.judge.quoted_layer], ['reviewer', 'lb', 1]);
  const [none] = ledger(base());
  assert.equal(none.judge, null, 'no disposition recorded');
});

test('E4 ledger: "not raised again" is an OBSERVATION, never a closing; a lab not asked is "not asked since", an unheard one "unheard since"', () => {
  const again = ledger(base({ currentRound: 3, heardByRound: { 1: ['la'], 2: ['la', 'lb'] } }))[0];
  assert.equal(again.status, 'active', 'not raised again is not a resolution');
  assert.equal(again.observed.not_raised_again_in, 2);
  const unasked = ledger(base({ currentRound: 3, heardByRound: { 1: ['la'], 2: ['lb'] }, notAskedByRound: { 2: ['la'] } }))[0];
  assert.deepEqual(unasked.observed, { not_asked_since: 1 });
  const unheard = ledger(base({ currentRound: 3, heardByRound: { 1: ['la'], 2: ['lb'] } }))[0];
  assert.deepEqual(unheard.observed, { unheard_since: 1 });
  assert.deepEqual(ledger(base())[0].observed, {}, 'raised in the last round: nothing observed yet');
});

test('E4 ledger: the reviser\'s response and the judge\'s position are SEPARATE fields; the source draft comes from the round it was raised in', () => {
  const [row] = ledger(base({ reviserByRound: { 1: { declined: [{ id: 'O-a1', reason: 'out of scope' }, { id: 'O-zz', reason: 'other' }], draftChanged: true } } }));
  assert.deepEqual(row.reviser, { declined: true, reason: 'out of scope', draft_changed: true });
  assert.equal(row.judge, null);
  assert.equal(row.source.draft_sha12, 'aaaaaaaaaaaa');
  assert.deepEqual(ledger(base({ reviserByRound: {} }))[0].reviser, { declined: false, draft_changed: null }, 'unknown stays unknown, not "unchanged"');
  assert.equal(ledger(base({ draftShaByRound: {} }))[0].source.draft_sha12, null);
});

test('E4 ledger: ONE total order and no mutation: shuffled inputs give identical rows; first round, then lab, then id', () => {
  const failures = [F('lb', 'O-b1'), F('la', 'O-a2'), F('la', 'O-a1')];
  const a = base({ openByRound: [{ round: 1, failures }, { round: 2, failures: [F('la', 'O-c1')] }], currentRound: 3 });
  const b = base({ openByRound: [{ round: 2, failures: [F('la', 'O-c1')] }, { round: 1, failures: [...failures].reverse() }], currentRound: 3 });
  const frozen = JSON.stringify(a);
  const ra = ledger(a); const rb = ledger(b);
  assert.equal(JSON.stringify(a), frozen, 'inputs are not mutated');
  assert.deepEqual(rb, ra);
  assert.deepEqual(ra.map(r => `${r.first_round}:${r.raised_by.lab}:${r.id}`), ['1:la:O-a1', '1:la:O-a2', '1:lb:O-b1', '2:la:O-c1']);
  assert.equal(ra[0].raised_by.layer, 1);
});

test('E4 ledger (advisor round, real shapes): a CARRIED failure (carried_from_round) is the harness restating, never a new raise by the judge', () => {
  const rows = ledger(base({ openByRound: [{ round: 1, failures: [F('la', 'O-a1')] }, { round: 3, failures: [F('la', 'O-a1', { carried_from_round: 1 })] }], currentRound: 4, heardByRound: { 1: ['la'], 2: ['la'], 3: ['la'] } }));
  assert.equal(rows[0].last_raised_round, 1, 'the carried failure of round 3 does not move the last raise');
  assert.equal(rows[0].observed.not_raised_again_in, 2, 'so the later rounds still read as "not raised again"');
  const only = ledger(base({ openByRound: [{ round: 3, failures: [F('la', 'O-a1', { carried_from_round: 1 })] }], currentRound: 4 }));
  assert.equal(only[0].first_round, 1, 'with no own raise in the data, the first round is the one it was carried FROM');
  assert.equal(only[0].last_raised_round, 1);
});

test('E4 ledger (advisor round, real shapes): an unknown_id answer after a consumed withdrawal does not reopen the closed row', () => {
  const [row] = ledger(base({ replies: [reply(2, {}), reply(3, { effect: 'unknown_id', status: 'withdrawn' })], currentRound: 4, heardByRound: { 1: ['la'], 2: ['la'], 3: ['la'] } }));
  assert.equal(row.status, 'closed');
  assert.equal(row.judge.last_disposition, 'withdrawn');
});

test('E4 ledger (advisor round, real shapes): two failures with one id in a round (same criterion, no quote) are JOINED in a stable order, not last-wins', () => {
  const two = (a, b) => ledger(base({ openByRound: [{ round: 1, failures: [F('la', 'O-a1', { problem: a }), F('la', 'O-a1', { problem: b })] }] }))[0];
  assert.equal(two('second problem', 'first problem').problem, 'first problem / second problem');
  assert.equal(two('first problem', 'second problem').problem, 'first problem / second problem', 'input order does not matter');
  assert.equal(two('same', 'same').problem, 'same', 'an identical problem is not doubled');
});

test('E4 ledger (advisor round 2, real flow): a SUSTAINED answer (the harness carries the objection) is not "not raised again": the judge explicitly kept it', () => {
  const rows = ledger(base({
    openByRound: [{ round: 1, failures: [F('la', 'O-a1')] }, { round: 2, failures: [F('la', 'O-a1', { carried_from_round: 1 })] }],
    replies: [reply(2, { effect: 'sustained', status: 'sustained' })], currentRound: 3, heardByRound: { 1: ['la'], 2: ['la'] },
  }));
  assert.equal(rows[0].status, 'active');
  assert.equal(rows[0].judge.last_disposition, 'sustained');
  assert.equal(rows[0].observed.not_raised_again_in, undefined, 'the disposition field speaks for round 2; no "looks fixed" beside "still open"');
  const silent = ledger(base({ replies: [reply(2, { effect: 'unanswered', status: null })], currentRound: 3, heardByRound: { 1: ['la'], 2: ['la'] } }));
  assert.equal(silent[0].observed.not_raised_again_in, 2, 'a judge that was silent (unanswered) is the one observation left');
});

test('E4 ledger (advisor round 2, real flow): the reviser lookup follows the LAST APPEARANCE (own or carried), the closed test and the observation follow the last OWN raise', () => {
  const rows = ledger(base({
    openByRound: [{ round: 1, failures: [F('la', 'O-a1')] }, { round: 2, failures: [F('la', 'O-a1', { carried_from_round: 1 })] }],
    reviserByRound: { 1: { declined: [], draftChanged: true }, 2: { declined: [{ id: 'O-a1', reason: 'still out of scope' }], draftChanged: false } },
    replies: [reply(2, { effect: 'sustained', status: 'sustained' })], currentRound: 3, heardByRound: { 1: ['la'], 2: ['la'] },
  }));
  assert.equal(rows[0].last_raised_round, 1, 'the own raise');
  assert.deepEqual(rows[0].reviser, { declined: true, reason: 'still out of scope', draft_changed: false }, 'the round-2 decline of the carried objection is not dropped');
});

test('E4 tokensEst: equal to chars/4 for ASCII, LARGER for multi-byte text (so the second measure can bind first)', () => {
  assert.equal(OL.tokensEst('abcdefgh'), 2);
  assert.equal(OL.tokensEst(''), 0);
  assert.ok(OL.tokensEst('日本語のテキスト'.repeat(10)) > Math.ceil('日本語のテキスト'.repeat(10).length / 4));
  assert.deepEqual(OL.measure('abcd'), { chars: 4, tokens_est: 1 });
});

// A renderer like the held sentence's: one line per row; compact closed rows are shorter; omitted is named.
const render = ({ rows, omitted }) => [...rows.map(r => (r.compact ? `${r.id} ${r.criterion} (withdrawn)` : `${r.id} ${r.status} ${r.criterion}: ${r.problem} ${r.judge?.reasoning ?? ''}`)), omitted ? `${omitted.count} earlier closed rows omitted (${omitted.ids.join(', ')})` : ''].join('\n');
const mk = (n, status, round, size = 1) => Array.from({ length: n }, (_, i) => ({ id: `O-${status[0]}${round}${i}`, status, first_round: round, criterion: 'c', problem: 'p'.repeat(size), judge: { reasoning: 'r'.repeat(size) } }));

test('E4 fit: as is when it fits; otherwise closed rows compact, then the OLDEST closed rounds collapse into a named count; active rows are NEVER touched', () => {
  const rows = [...mk(3, 'closed', 1, 400), ...mk(3, 'closed', 2, 400), ...mk(2, 'active', 3, 400)];
  const whole = fit(rows, render, { maxChars: 1e9, maxTokens: 1e9 });
  assert.equal(whole.counts.closed_cut, 0); assert.equal(whole.overflow, false); assert.equal(whole.text, render({ rows, omitted: null }));
  const compact = fit(rows, render, { maxChars: render({ rows: rows.map(r => (r.status === 'closed' ? { ...r, compact: true } : r)), omitted: null }).length, maxTokens: 1e9 });
  assert.equal(compact.counts.compacted, 6); assert.equal(compact.omitted, null);
  const actives = rows.filter(r => r.status === 'active');
  const allClosed = rows.filter(r => r.status === 'closed').map(r => r.id).sort();
  const tight = fit(rows, render, { maxChars: render({ rows: actives, omitted: { count: allClosed.length, ids: allClosed } }).length, maxTokens: 1e9 }); // exactly what fits once every closed row is gone
  assert.equal(tight.overflow, false);
  assert.ok(tight.omitted.count >= 3 && tight.omitted.ids.every(id => id.startsWith('O-c')), 'closed rows only, oldest round first, ids named');
  assert.deepEqual(tight.rows.filter(r => r.status === 'active').map(r => r.id), rows.filter(r => r.status === 'active').map(r => r.id), 'every active row survives, unchanged');
  assert.ok(tight.rows.filter(r => r.status === 'active').every(r => !r.compact));
  assert.ok(tight.text.includes('earlier closed rows omitted'), 'the cut is printed, never silent');
});

test('E4 fit (known-bad input): when the ACTIVE rows alone exceed the budget it is an OVERFLOW (nothing to send), never a ledger with an active row missing', () => {
  const rows = [...mk(2, 'closed', 1, 100), ...mk(6, 'active', 2, 800)];
  const r = fit(rows, render, { maxChars: 2000, maxTokens: 1e9 });
  assert.equal(r.overflow, true);
  assert.equal(r.text, null);
  assert.equal(r.counts.active, 6, 'all six active rows are accounted for');
});

test('E4 fit (advisor round): the omitted-ids line is CAPPED (count exact) and falls back to count-only, so a long closed history never turns a fitting active set into an overflow', () => {
  const closed = Array.from({ length: 300 }, (_, i) => ({ id: `O-closed-${String(i).padStart(4, '0')}`, status: 'closed', first_round: 1, criterion: 'c', problem: 'p'.repeat(60), judge: null }));
  const active = mk(2, 'active', 2, 100);
  const rows = [...closed, ...active];
  const onlyActive = render({ rows: active, omitted: { count: 300, ids: [], more: 300 } }).length;
  const r = fit(rows, render, { maxChars: onlyActive, maxTokens: 1e9 });
  assert.equal(r.overflow, false, 'the active rows fit; only the closed history was cut');
  assert.equal(r.omitted.count, 300, 'the count stays exact');
  assert.ok(r.omitted.ids.length <= OL.OMITTED_IDS_MAX, 'the id list is capped');
  assert.equal(r.omitted.ids.length + r.omitted.more, 300);
  const tooSmall = fit(rows, render, { maxChars: onlyActive - 1, maxTokens: 1e9 });
  assert.equal(tooSmall.overflow, true, 'one character less and the ACTIVE rows alone do not fit');
});

test('E4 fit: BOTH limits hold: multi-byte text binds on tokens_est while chars still fits', () => {
  const cjk = [{ id: 'O-1', status: 'active', first_round: 1, criterion: '日'.repeat(2000), problem: '本'.repeat(2000), judge: null }];
  const ascii = [{ id: 'O-1', status: 'active', first_round: 1, criterion: 'a'.repeat(2000), problem: 'b'.repeat(2000), judge: null }];
  const lim = { maxChars: 5000, maxTokens: 1100 };
  assert.equal(fit(ascii, render, lim).overflow, false, 'ASCII: 4,000 chars = 1,000 tokens fits');
  assert.equal(fit(cjk, render, lim).overflow, true, 'the same number of characters in CJK is ~3,000 tokens_est by bytes: over');
});

test('E4 module: no imports (a leaf), the budget constants are named, and the dated tunables are what the page says', () => {
  const src = readFileSync(join(here, '..', 'src', 'objection-ledger.js'), 'utf8');
  const importsOf = text => [...text.matchAll(/^import\s+(?:[^'"\n]*?\s+from\s+)?['"]([^'"]+)['"]/gm)].map(m => m[1]);
  const specs = importsOf(src);
  assert.deepEqual(importsOf('import x from "node:fs";\nimport "./y.js";\n// import z from "w"'), ['node:fs', './y.js'], 'self-test: the reader sees imports and not a comment');
  assert.deepEqual(specs, [], 'this module imports nothing');
  assert.equal(OL.LEDGER_MAX_CHARS, 40000);
  assert.equal(OL.LEDGER_MAX_TOKENS_EST, 10000);
  assert.equal(typeof OL.EVIDENCE_CAP_CHARS, 'number');
  assert.match(src, /under-counts non-Latin text; tuned when an input-window table exists/);
});
