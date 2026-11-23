// The dry run counts the draft boundary's lines in the prompts of an order-live seat (src/cost.js, 0.8.4 boundary fix-up). The exchange rows (ldebate, lreply) have counted them since the order was built; the panel review, the in-pass
// re-ask of a panel review, the sign-off re-ask and the first-mode critique did not, so the estimate sat about 70 tokens a call under the real prompt on every call of those four kinds; the `-solo` ask and the final read (and its
// re-ask) were measured short by 70 as well (probe_gap3 / probe_gap4) and count them now; the MARK'S HEAD of every marked kind (panel at the write price; re-ask, `-solo` and sign-off re-ask at the read price) holds them too (BK-8).
// THE BAR (C&C, 11 Nov 2026), per prompt kind, in the shipped state S (draft_end_marker on + prompt_cache 5m): the ESTIMATE's input per call minus the same row in BASE (marker off + cache off) equals the REAL prompt's size minus BASE's real
// prompt, within 3 tokens a call (chars / 4 rounds once on each side; the order's re-ask note swaps one phrase). The REAL side is read from the prompts a real run (mock seats, the stage cache fed) sends, never typed in.
// State M (marker on, cache off: the lines are sent, the order is not live) is printed in the table and not asserted: it has no estimate of its own (boundaryTokens counts an order-live seat only) and a person's own chain is the only way to reach it
// (the seven shipped chains are all in S); asserting it would pin a known undercount as correct.
// Fixtures are the three runs of the gap probe: G7 (a top-layer judge withdraws and ends "sign-off: no": reaches the panels, the shortened exchange and the sign-off re-ask), REASK (an unreadable first reply: the in-pass re-ask) and FIRST
// (a first-mode critic: critique-1). Each kind has its OWN test so one failing kind cannot hide another.
import test from 'node:test';
import assert from 'node:assert/strict';
import { runChain, setPromptSpy, setCache, setBudget } from '../src/chain.js';
import { setHeldForTest, held } from '../src/held-roles.js';
import { neverHeardChain } from './helpers/final-read-chain.js';
import { estimateChainRows, priceAt } from '../src/cost.js';
import { objectionId } from '../src/objection-ids.js';
import * as HB084 from './held-prompts/held-084-b.js';

const TOLERANCE = 3;
const CRITERION = 'The plan defines a retry limit.'; const DRAFT = 'The worker retries failed requests.';
const X3 = { criterion: CRITERION, problem: 'No limit on retries.', quote: 'retries failed requests', severity: 5 }; const idX3 = objectionId('r3', X3);
const meets = () => JSON.stringify({ meets: true, criteria: [{ criterion: CRITERION, verdict: 'MET', evidence: 'Section two sets it.' }], failures: [], verdict_line: 'ok' });
const objects = f => JSON.stringify({ meets: false, criteria: [{ criterion: CRITERION, verdict: 'FAILED', evidence: f.problem }], failures: [{ ...f, relation: 'new' }], verdict_line: 'no' });
const withdraw = (id, line) => `${JSON.stringify({ replies: [{ id, action: 'withdraw', text: 'The quoted passage settles it.', quote: 'retries failed requests' }] })}${line ? `\nsign-off: ${line}` : ''}`;
const support = id => JSON.stringify({ posts: [{ on: id, stance: 'support', text: 'It holds against the criteria.' }], new_objections: [] });
const PAIR = { shortExchangeRule: HB084.shortExchangeRule, signoffLineRule: HB084.signoffLineRule, signoffRefusedReaskNote: HB084.signoffRefusedReaskNote };
const seat = (lab, layer) => ({ provider: 'mock', model: 'mock-review-fixture', lab, maxTokens: 3000, ...(layer ? { layer } : {}) });
const builder = { provider: 'mock', model: 'mock-builder', lab: 'writer' };
const STATES = { BASE: {}, M: { draft_end_marker: { enabled: true } }, S: { draft_end_marker: { enabled: true }, prompt_cache: { enabled: true, ttl: '5m' } } };
const SCEN = {
  G7: { critics: [seat('l1', 1), seat('l2', 2), seat('r3', 3), seat('q3', 3)], signoff: 'unanimous', script: { 'panel-1-r3': objects(X3), 'ldebate-1-q3': support(idX3), 'lreply-1-r3': withdraw(idX3, 'no'), 'panel-1-r3-reask3': meets() } },
  REASK: { critics: [seat('l1', 1), seat('l2', 2), seat('l3', 3)], signoff: 'unanimous', script: { 'panel-1-l1': 'this is not json at all', 'panel-1-l1-reask1': meets() } },
  FIRST: { critics: [seat('k1')], signoff: 'first', script: {} },
  // the layer-1 judge is unreadable through both re-asks, so its `-solo` ask is reached (the gap probe's SOLO)
  SOLO: { critics: [seat('l1', 1), seat('l2', 2), seat('l3', 3)], signoff: 'unanimous', script: { 'panel-1-l1': 'this is not json at all', 'panel-1-l1-reask1': 'still not json', 'panel-1-l1-reask2': 'still not json either', 'panel-1-l1-solo': meets() } },
  // layer 1 is never heard (mock-unreadable), so the run ends not agreed and the unread layer-3 seats read once (test/helpers/final-read-chain.js neverHeardChain); the models are the chain's own, so NO stage cache is fed
  FINALREAD: { own: state => neverHeardChain(`bk${state.toLowerCase()}`, STATES[state]) },
};
const toks = p => Math.ceil((String(p.system ?? '').length + String(p.user ?? '').length) / 4);
const configOf = (sc, state) => sc.own ? sc.own(state) : ({ name: 'boundary-kinds', criteria: [CRITERION], signoff: sc.signoff, maxRounds: 1, ...STATES[state], seats: { builder, reviser: builder, critics: sc.critics } });

async function runOnce(sc, state) {
  const prompts = new Map(); setPromptSpy(p => { if (!prompts.has(p.label)) prompts.set(p.label, p); }); setHeldForTest({ ...PAIR }); setBudget(null);
  if (sc.own) setCache(null); else setCache({ invalidate() {}, get(label) { if (label in sc.script) return { text: sc.script[label], provider: 'mock', model: 'm', usage: { input: 0, output: 0 }, usd: 0 }; return { text: (label.startsWith('panel-') || label.startsWith('final-read-') || label.startsWith('critique-')) ? meets() : DRAFT, provider: 'mock', model: 'm', usage: { input: 0, output: 0 }, usd: 0 }; } });
  let err = null; try { await runChain({ request: 'Write a worker plan with a retry limit.', runId: `r-boundary-${state}`, log: () => {}, config: configOf(sc, state) }); } catch (e) { err = String(e?.message ?? e).slice(0, 160); }
  setPromptSpy(null); setHeldForTest(null); setCache(null);
  return { prompts, err };
}

let measured = null;
const measure = async () => {
  if (measured) return measured;
  measured = (async () => {
    const out = {};
    for (const [name, sc] of Object.entries(SCEN)) {
      const runs = {}; for (const st of Object.keys(STATES)) runs[st] = await runOnce(sc, st);
      setHeldForTest({ ...PAIR });
      const rows = {}; for (const st of Object.keys(STATES)) rows[st] = estimateChainRows(configOf(sc, st), { maximum: true });
      setHeldForTest(null);
      out[name] = { runs, rows };
    }
    return out;
  })();
  return measured;
};

// the dry-run row that prices a real call's label: an in-pass re-ask is one row `-reask` (its number is the ask's), the sign-off re-ask and every other label are their own rows
const rowLabelOf = label => /^final-read-/.test(label) ? label.replace(/^final-read-(.+?)(-reask\d)?$/, (_, lab, re) => `final-read-L3-${lab}${re ? '-reask' : ''}`) : label.replace(/-reask[12]$/, '-reask');   // the final read's rows carry the top layer's number (neverHeardChain: layer 3)
const perCall = r => r.input / (r.times ?? 1);
// one pair of numbers for a real label in a scenario: the real gap (S minus BASE, tokens of the sent prompt) and the estimated gap (the same row's input per call in S minus BASE)
function gapOf(m, scenario, label) {
  const { runs, rows } = m[scenario];
  const real = { BASE: runs.BASE.prompts.get(label), M: runs.M.prompts.get(label), S: runs.S.prompts.get(label) };
  const rowLabel = rowLabelOf(label), row = st => rows[st].find(r => r.label === rowLabel);
  return { scenario, label, rowLabel, premise: !!(real.BASE && real.S && row('BASE') && row('S')),
    real: real.BASE && real.S ? toks(real.S) - toks(real.BASE) : null, realM: real.BASE && real.M ? toks(real.M) - toks(real.BASE) : null,
    estimated: row('BASE') && row('S') ? Math.round(perCall(row('S')) - perCall(row('BASE'))) : null, estimatedM: row('BASE') && row('M') ? Math.round(perCall(row('M')) - perCall(row('BASE'))) : null };
}
function check(m, scenario, labels, kind) {
  const gaps = labels.map(l => gapOf(m, scenario, l));
  console.log(`BOUNDARY ${kind}: ${gaps.map(g => `${g.label} real ${g.real} estimated ${g.estimated} (M real ${g.realM} estimated ${g.estimatedM})`).join('; ')}`);
  for (const g of gaps) assert.ok(g.premise, `premise: the call ${g.label} was sent in BASE and S of ${scenario} and has its dry-run row ${g.rowLabel} in both (else this proves nothing): ${JSON.stringify(g)}`);
  const bad = gaps.filter(g => Math.abs(g.estimated - g.real) > TOLERANCE);
  assert.deepEqual(bad.map(g => `${g.label}: real gap ${g.real}, estimated gap ${g.estimated}`), [], `${kind}: the estimate's input per call minus BASE must equal the real prompt minus BASE within ${TOLERANCE} tokens`);
}

test('BK-1 PANEL: the panel review of every judge counts the boundary lines the order puts in its prompt (real minus BASE = estimated minus BASE, within 3 tokens a call)', async () => {
  const m = await measure();
  check(m, 'G7', ['panel-1-l1', 'panel-1-l2', 'panel-1-r3', 'panel-1-q3'], 'panel');
});

test('BK-2 PANEL RE-ASK: the in-pass re-ask of an unreadable panel review counts them too', async () => {
  const m = await measure();
  check(m, 'REASK', ['panel-1-l1-reask1'], 'panel re-ask');
});

test('BK-3 SIGN-OFF RE-ASK: the re-ask of a top-layer judge that ended its reply with "sign-off: no" and left nothing of its own standing counts them too', async () => {
  const m = await measure();
  check(m, 'G7', ['panel-1-r3-reask3'], 'sign-off re-ask');
});

test('BK-4 FIRST-MODE CRITIQUE: the critique of a first-mode critic counts them too', async () => {
  const m = await measure();
  check(m, 'FIRST', ['critique-1'], 'critique');
});

test('BK-5 THE EXCHANGE ROWS ARE NOT COUNTED TWICE: a post and an answer of the shortened exchange still sit within 3 tokens of the real prompt (the lines were already in those rows)', async () => {
  const m = await measure();
  check(m, 'G7', ['ldebate-1-q3', 'lreply-1-r3'], 'exchange');
});

test('BK-6 SOLO ASK: the `-solo` ask of a silent layer-1 judge counts them too (measured 106 real against 36 estimated before)', async () => {
  const m = await measure();
  check(m, 'SOLO', ['panel-1-l1-solo'], 'solo');
});

test('BK-7 FINAL READ: the final read of an unread layer-3 seat, and the re-ask of an unreadable one, count them too (neverHeardChain; 106 real against 36 estimated before)', async () => {
  const m = await measure();
  check(m, 'FINALREAD', ['final-read-l3a', 'final-read-l3b', 'final-read-l3b-reask1'], 'final read');
});

// BK-8 THE MARK'S HEAD. The order sends ONE neutral head H for every laid call kind (test/cache-order.test.js), and H holds the boundary lines (neutralHeadOf: the neutral sentence and the start line before the draft, the end line as its last line). So the
// head the dry run prices at the write price (panel) or the read price (re-ask, `-solo`, sign-off re-ask) must hold them too. The estimate's head is not an absolute number comparable to the real one (it carries the judge system text, the real head is the
// neutral head), so each kind is measured against the EXCHANGE row of the same seat in the expected figure (whose head has counted the lines since the order was built): the estimated head of each kind minus the exchange's must equal the REAL head delta,
// which is 0 (one head for every kind), within 3 tokens. The estimated head is derived from the row's own dollars: adding D draft tokens grows the input AND the head, so the dollar slope gives the multiple (write or read) the head is billed at.
test('BK-8 HEAD: every marked kind carries the boundary lines in the head it prices (panel, re-ask, -solo, sign-off re-ask against the exchange row), and the real heads of all kinds, the exchange included, are one text with the lines inside', async () => {
  const m = await measure();
  // the real side: one cacheHead for every laid call, the lines inside it, the user prompt starting with it
  setHeldForTest({ ...PAIR });
  const lines = ['draftBoundarySentenceNeutral', 'draftStartLine', 'draftEndLineNeutral'].map(n => held(n)());
  setHeldForTest(null);
  const heads = [['G7', 'panel-1-r3'], ['G7', 'ldebate-1-q3'], ['G7', 'lreply-1-r3'], ['G7', 'panel-1-r3-reask3'], ['REASK', 'panel-1-l1-reask1'], ['SOLO', 'panel-1-l1-solo']].map(([sc, l]) => ({ l, p: m[sc].runs.S.prompts.get(l) }));
  for (const { l, p } of heads) {
    assert.equal(typeof p?.cacheHead, 'string', `${l}: the real call is laid and carries a head`);
    assert.ok(String(p.user).startsWith(p.cacheHead), `${l}: the user prompt starts with the head`);
    for (const line of lines) assert.ok(p.cacheHead.includes(line), `${l}: the head holds the boundary line "${line.slice(0, 40)}..."`);
    assert.ok(p.cacheHead.endsWith(lines[2]), `${l}: the end line is the head's last line`);
  }
  assert.deepEqual([...new Set(heads.map(({ p }) => Math.ceil(p.cacheHead.length / 4)))].length, 1, `the real heads of every kind, the exchange included, are one size: ${heads.map(({ l, p }) => `${l} ${Math.ceil(p.cacheHead.length / 4)}`).join(', ')}`);
  // the estimate side
  const claude = (lab, layer) => ({ provider: 'anthropic', model: 'claude-sonnet-5', lab, layer, maxTokens: 3000 });
  const D = 30000, DELTA = 1000;
  const cfg = d => ({ name: 'bk-head', signoff: 'unanimous', maxOverseerRounds: 1, layerRevisions: { 1: 1, 2: 1 }, estimate: { promptTokens: 20000, draftTokens: d, critiqueTokens: 2000 }, ...STATES.S,
    seats: { criteria: { provider: 'mock', model: 'mock-criteria' }, builder: { provider: 'mock', model: 'mock-builder' }, reviser: { provider: 'mock', model: 'mock-builder' }, critics: [claude('a', 1), claude('b', 1), claude('c', 2), claude('d', 2)] } });
  setHeldForTest({ ...PAIR });
  const headOf = (label, maximum, wantMult) => {
    const find = c => estimateChainRows(c, { maximum }).find(r => r.label === label);
    const r0 = find(cfg(D)), r1 = find(cfg(D + DELTA));
    assert.ok(r0 && r1, `premise: the dry run has the row ${label}`);
    const times = r0.times ?? 1, per = x => x.usd / (x.times ?? 1), input = r0.input / times, price = priceAt('anthropic', 'claude-sonnet-5', input);
    const mult = ((per(r1) - per(r0)) * 1e6) / (DELTA * price.in);
    assert.ok(Math.abs(mult - wantMult) < 1e-6, `premise: ${label}'s head is billed at ${wantMult} times the plain price (derived ${mult})`);
    return Math.round(((((per(r0) - (r0.output / times / 1e6) * price.out) * 1e6) / price.in) - input) / (mult - 1));
  };
  const exchange = headOf('ldebate-L1-a', false, 0.1);
  const est = { panel: headOf('panel-L1-a', false, 1.25), 're-ask': headOf('panel-L1-a-reask', true, 0.1), 'solo': headOf('panel-L1-a-solo', true, 0.1), 'sign-off re-ask': headOf('panel-L2-c-reask3', true, 0.1) };
  setHeldForTest(null);
  console.log(`BOUNDARY heads (estimated, exchange ${exchange}): ${Object.entries(est).map(([k, v]) => `${k} ${v}`).join('; ')}`);
  const bad = Object.entries(est).filter(([, v]) => Math.abs(v - exchange) > TOLERANCE).map(([k, v]) => `${k}: head ${v} against the exchange's ${exchange}`);
  assert.deepEqual(bad, [], `each marked kind's head differs from the exchange row's by what the real heads differ by (0) within ${TOLERANCE} tokens`);
});
