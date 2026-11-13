// 0.8.4 S7b, commit A5 (money; plan item g, row RS-14): the MAXIMUM figure of a layer-2 call also carries the section that asks layer 2 to rule on layer 1's open objections: 400 input tokens per layer-1 judge (K1), per call, on the existing `panel-L2-*` row.
// Gated on the terms of the section itself (src/chain.js): a layered chain with answer_back, a layer between the first and the top one, and the five gate names recorded. Held (any one name), without answer_back, or on a two-layer chain: nothing moves. The expected figure never moves.
// $0, offline: estimateChainRows over the shipped layered chains (cloned with answer_back switched on), the held map as test/s7b-prompt.test.js.
// Rows raised (each REACHABLE by trace in src/chain.js): the `panel-L2-*` review rows, their in-pass `-reask` rows (a re-ask goes through the same prompt build, layerOneNote), and on a layered chain WITHOUT overseer rounds the per-pass `panel-<n>-*` rows and their `-reask` rows.
// NOT BUILT (named): the plan's output gain (the MAXIMUM already prices output at the call's cap). NOT DRIVEN: "layer 1 signed off in this pass" is a runtime fact; the MAXIMUM assumes it true.
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import * as HB from './held-prompts/held-084-b.js';
import { estimateChainRows } from '../src/cost.js';
import { setHeldForTest } from '../src/held-roles.js';
import { DEMAND } from './helpers/rating-demand.js';

afterEach(() => setHeldForTest(null));

const NAMES = ['ratingDemand', 'relationRule', 'layerOneRulingsSection', 'layerOneRulingsReplyTail', 'layerOneRulingsLedgerSection'];
const LIVE = Object.freeze({ ...DEMAND, relationRule: HB.relationRule, layerOneRulingsSection: HB.layerOneRulingsSection, layerOneRulingsReplyTail: HB.layerOneRulingsReplyTail, layerOneRulingsLedgerSection: HB.layerOneRulingsLedgerSection });
const without = name => ({ ...LIVE, [name]: undefined });
// The section's term is gated on all five names (layerOneRulingActive). Two of them also move the judges' prompt text, hence the figures of EVERY row: the rating demand (src/stage-system.js, ratingsDemanded) and the relation rule (the panel prompt's tail, stage-system.js relationTail). The three section names are read by no row's prompt build (src/chain.js only), so in the estimate they act through the term alone. A held map is therefore never compared with `{}`: it is compared with the SAME map minus the three section names, which switches the term off and nothing else (08 Nov fix-up: on the box both rows failed, 'panel-L1-... is unchanged' and 'without ratingDemand', because LIVE and every without(...) map differ from `{}` by the two prompt words).
const SECTION_NAMES = ['layerOneRulingsSection', 'layerOneRulingsReplyTail', 'layerOneRulingsLedgerSection'];
const termOff = held => ({ ...held, ...Object.fromEntries(SECTION_NAMES.map(n => [n, undefined])) });
const dir = new URL('../chains/', import.meta.url);
const shipped = readdirSync(dir).filter(f => f.endsWith('.json')).map(f => JSON.parse(readFileSync(new URL(f, dir), 'utf8')))
  .map(c => ('ladder' in c ? (({ ladder: _ladder, ...rest }) => ({ ...rest, maxOverseerRounds: 7, layerRevisions: { 1: 7, 2: 3 } }))(c) : c))   // FINDING (not on the owed list of the ladder unit; 10 Nov 2026): the shipped planning chains carry the ladder key (no overseer-round keys). These rows test the overseer-round mechanics, so they read each shipped chain as an overseer chain (the key replaced by 7 rounds, bounds 7 and 3), as test/overseer-keys.test.js does.
  .filter(c => c.signoff === 'unanimous' && Number.isInteger(c.maxOverseerRounds) && (c.seats?.critics || []).length && c.seats.critics.every(k => Number.isInteger(k.layer)) && c.seats.critics.some(k => k.layer === 3) && c.seats.critics.some(k => k.layer === 2));
const withAnswerBack = c => ({ ...c, answer_back: { enabled: true } });
const figures = (c, held) => { setHeldForTest(held); return { max: estimateChainRows(c, { maximum: true }), exp: estimateChainRows(c, { maximum: false }) }; };
const labOf = k => k.lab || k.provider;
// is this row a layer-2 review row (overseer shape `panel-L2-<lab>` or per-pass shape `panel-<n>-<lab>`), or its in-pass re-ask row?
// CHANGED ACCEPTED TEST (0.8.4 seats unit, the same-layer seat key): OLD: a layer-2 row is `panel-L2-<lab>` or its `-reask` / the per-pass shape. NEW: a second seat of one model on one layer is labelled `<lab>-<n>`, so each shape takes an optional `-<n>` after the lab (plan-claude-council seats Sonnet twice on layer 2). WHY: the dry run's row labels gain `-<n>` for such a seat.
// FINDING (not on the owed list of the ladder unit; found by the box set, 10 Nov 2026): the overseer-shape pattern lacked `-solo`; the solo row carries the layer-2 section like its re-ask row, so it gains the same input.
const isLayerTwoRow = (label, c) => c.seats.critics.filter(k => k.layer === 2).some(k => { const lab = labOf(k).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); return new RegExp(`^panel-L2-${lab}(-\\d+)?(-reask|-solo)?$`).test(label) || new RegExp(`^panel-\\d+-${lab}(-\\d+)?(-reask|-solo)?$`).test(label); });   // FINDING (not on the owed list of the ladder unit; 10 Nov 2026). OLD: only `-reask`; the solo ask's `-solo` row is a layer-2 row too (cost.js)
// the per-pass rows are labelled `panel-<n>-<lab>` with no layer in them, and two shipped chains seat one lab in two layers (china-high, claude-council): the clone gives every seat a lab of its own, in the held and the live run alike
const noOverseer = c => { const { maxOverseerRounds: _m, layerRevisions: _l, ladder: _ladder, ...rest } = c; return { ...rest, maxRounds: 3, seats: { ...rest.seats, critics: rest.seats.critics.map(k => ({ ...k, lab: `${labOf(k)}-l${k.layer}` })) } }; };

test('RS-14 (A5): live, each layer-2 row of the MAXIMUM (review, in-pass re-ask; with and without overseer rounds) gains exactly 400 x K1 x times input tokens and nothing else moves; the expected figure never moves', () => {
  assert.ok(shipped.length >= 7, `the shipped layered chains were found (${shipped.length})`);   // CHANGED ACCEPTED TEST (0.8.4 seats and retirements unit): OLD bar 8. NEW bar: 7 (seven planning chains left after the three retirements and the China mini). WHY: the count moves with the thing it counts
  let priced = 0; let gained = 0;
  for (const base of shipped) for (const [shape, c] of [['overseer rounds', withAnswerBack(base)], ['no overseer rounds', withAnswerBack(noOverseer(base))]]) {
    const off = figures(c, termOff(LIVE));
    const on = figures(c, LIVE);
    const k1 = c.seats.critics.filter(k => k.layer === 1).length;
    assert.deepEqual(on.max.map(r => r.label), off.max.map(r => r.label), `${c.name} (${shape}): the same rows in the same order`);
    on.max.forEach((r, i) => {
      const was = off.max[i];
      if (isLayerTwoRow(r.label, c)) {
        assert.equal(r.input - was.input, 400 * k1 * (r.times ?? 1), `${c.name} (${shape}): ${r.label} gains 400 x K1 (${k1}) per call`);
        assert.ok(r.usd >= was.usd, `${c.name} (${shape}): ${r.label} does not fall`);
        gained++;
        if (r.usd > was.usd) priced++;
      } else assert.deepEqual(r, was, `${c.name} (${shape}): ${r.label} is unchanged`);
    });
    assert.deepEqual(on.exp, off.exp, `${c.name} (${shape}): the expected figure never changes`);
  }
  assert.ok(gained > 0 && priced > 0, 'at least one priced layer-2 row gained (this row can fail)');
});

test('RS-14 (A5): with any one of the five names held, without answer_back, or on a two-layer chain, the MAXIMUM is what it was', () => {
  for (const base of shipped) {
    const c = withAnswerBack(base);
    for (const name of NAMES) assert.deepEqual(figures(c, without(name)).max, figures(c, termOff(without(name))).max, `${c.name}: without ${name}`);
    const { answer_back: _a, ...noAnswerBack } = c;
    assert.deepEqual(figures(noAnswerBack, LIVE).max, figures(noAnswerBack, termOff(LIVE)).max, `${c.name}: no answer_back`);
    const plain = noOverseer(c);
    for (const name of NAMES) assert.deepEqual(figures(plain, without(name)).max, figures(plain, termOff(without(name))).max, `${c.name}: no overseer rounds, without ${name}`);
    const two = { ...c, seats: { ...c.seats, critics: c.seats.critics.filter(k => k.layer < 3) } };
    assert.deepEqual(figures(two, LIVE).max, figures(two, termOff(LIVE)).max, `${c.name}: two layers, layer 2 is the top layer and is shown the ledger, not the section`);
  }
});
