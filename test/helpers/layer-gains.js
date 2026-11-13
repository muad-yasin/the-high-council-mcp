// 0.8.4 apply, group 7 (the money rows on the RECORDED state): the shipped layered chains read as overseer chains, and the per-call GAIN of a panel row of the MAXIMUM over the expected figure, DERIVED BY TERM from the chain's own seat counts (never read back
// from the estimator's arithmetic). The terms (src/cost.js 744-800; printed on all seven shipped chains, job 97): a review row of a seat below the top layer carries the top layer's reasons section (400 tokens per top-layer judge, K_top);
// the second layer of a chain of three layers or more also carries the section that asks it to rule on layer 1's objections (400 x K1); a top-layer row carries the sort list (400 x the judges below the top layer). Zero without answer_back (the real off).
// Not a test file.
import { readdirSync, readFileSync } from 'node:fs';
import { estimateChainRows, estimateTokens, IN_PASS_REASKS_PER_SEAT } from '../../src/cost.js';
import * as R from '../../src/roles.js';

const dir = new URL('../../chains/', import.meta.url);
/** The shipped layered chains as overseer chains (the ladder key replaced by 7 rounds and bounds 7 and 3, as test/overseer-keys.test.js does), answer_back switched on. */
export const shippedOverseerChains = () => readdirSync(dir).filter(f => f.endsWith('.json')).map(f => JSON.parse(readFileSync(new URL(f, dir), 'utf8')))
  .map(c => ('ladder' in c ? (({ ladder: _ladder, ...rest }) => ({ ...rest, maxOverseerRounds: 7, layerRevisions: { 1: 7, 2: 3 } }))(c) : c))
  .filter(c => c.signoff === 'unanimous' && Number.isInteger(c.maxOverseerRounds) && (c.seats?.critics || []).length && c.seats.critics.every(k => Number.isInteger(k.layer)) && c.seats.critics.some(k => k.layer === 3) && c.seats.critics.some(k => k.layer === 2));
export const withAnswerBack = c => ({ ...c, answer_back: { enabled: true } });
export const withoutAnswerBack = c => { const { answer_back: _a, ...rest } = c; return rest; };
export const labOf = k => k.lab || k.provider;
/** The same chain without overseer rounds (per-pass `panel-<n>-<lab>` rows); every seat gets a lab of its own per layer so the labels name the layer (`<lab>-l<layer>`). */
export const noOverseer = c => { const { maxOverseerRounds: _m, layerRevisions: _l, ...rest } = c; return { ...rest, maxRounds: 3, seats: { ...rest.seats, critics: rest.seats.critics.map(k => ({ ...k, lab: `${labOf(k)}-l${k.layer}` })) } }; };
/** A chain of EXACTLY TWO layers: the top layer removed, the dispute stage off. */
export const twoLayers = c => ({ ...withAnswerBack(c), dispute: { ...(c.dispute || {}), enabled: false }, seats: { ...c.seats, critics: c.seats.critics.filter(k => k.layer < 3) } });

/** The judges per layer of a chain: { layers: [1, 2, 3], K: { 1: k1, 2: k2, 3: k3 }, top }. */
export const layersOf = c => { const layers = [...new Set(c.seats.critics.map(k => k.layer))].sort((x, y) => x - y); const K = Object.fromEntries(layers.map(l => [l, c.seats.critics.filter(k => k.layer === l).length])); return { layers, K, top: layers[layers.length - 1] }; };
/** The per-call gain of a review row of `layer`, by term. */
export const layerGain = (c, layer) => {
  const { layers, K, top } = layersOf(c);
  const reasons = layer < top ? 400 * K[top] : 0;                                   // the top layer's reasons section (K_top judges)
  const rulesOnLayerOne = layers.length >= 3 && layer === layers[1] ? 400 * K[layers[0]] : 0;   // the second layer of three or more: layer 1's open objections
  const sortList = layer === top ? 400 * layers.filter(l => l < top).reduce((t, l) => t + K[l], 0) : 0;   // the top layer's sort list: one objection per judge below
  return reasons + rulesOnLayerOne + sortList;
};
/** How many times a row runs: overseer chains n x ({1: b1 + b2 + 1, 2: b2 + 1}[layer] ?? 1) in the maximum, a chain without overseer rounds once per pass. `kind`: review | reask (IN_PASS_REASKS_PER_SEAT per visit) | solo | reask3 (one per visit of the top layer). */
export const rowTimes = (c, layer, kind, { maximum = true } = {}) => {
  const visits = Number.isInteger(c.maxOverseerRounds) ? c.maxOverseerRounds * ({ 1: c.layerRevisions[1] + c.layerRevisions[2] + 1, 2: c.layerRevisions[2] + 1 }[layer] ?? 1) : 1;
  return kind === 'reask' ? IN_PASS_REASKS_PER_SEAT * visits : visits;
};
const kindOf = label => (/-reask3$/.test(label) ? 'reask3' : /-reask$/.test(label) ? 'reask' : /-solo$/.test(label) ? 'solo' : 'review');
/** The layer a panel row label names: `panel-L<l>-<seat>` (overseer chains) or `panel-<n>-<lab>-l<layer>` (no overseer rounds). */
export const layerOfRow = label => { const a = /^panel-L(\d+)-/.exec(label); if (a) return Number(a[1]); const b = /^panel-\d+-.*-l(\d+)(?:-\d+)?(?:-reask3?|-solo)?$/.exec(label); return b ? Number(b[1]) : null; };
/** Every panel row of the maximum with its per-call input, the per-call input of the SAME seat's expected review row, its times, and its kind. */
export const panelRows = c => {
  const mx = estimateChainRows(c, { maximum: true }); const ex = new Map(estimateChainRows(c, { maximum: false }).map(r => [r.label, r]));
  return mx.filter(r => layerOfRow(r.label) !== null).map(r => {
    const base = r.label.replace(/-(reask3?|solo)$/, ''); const e = ex.get(base);
    return { label: r.label, layer: layerOfRow(r.label), kind: kindOf(r.label), times: r.times ?? 1, perCall: r.input / (r.times ?? 1), expPerCall: e ? e.input / (e.times ?? 1) : null, priced: r.priced, usd: r.usd };
  });
};
/** The gain a panel row of the maximum carries over its seat's expected review row, by term: its layer's gain, plus (a top seat's `-reask3`, the one extra verdict call after a refused sign-off, which carries only the sort list and never the reasons sections) the tokens of the recorded refused-sign-off note (src/cost.js signoffReaskRows: promptTokens + draftTokens + noteTokens + the sort list). */
export const rowGain = (c, row) => layerGain(c, row.layer) + (row.kind === 'reask3' ? estimateTokens(R.signoffRefusedReaskNote()) : 0);
/** The gain a row carries with NO ledger (answer_back removed): none of the sections apply; the one sign-off-refusal note a top seat's `-reask3` row carries does not depend on answer_back (job 103 printed 74 tokens on it). */
export const noLedgerGain = row => (row.kind === 'reask3' ? estimateTokens(R.signoffRefusedReaskNote()) : 0);
