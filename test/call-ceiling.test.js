// 0.8.4 S11 (36c; MONEY): the cost output of Part 0, the most Council CALLS a layered unanimous chain with overseer rounds can make, counted in calls and never in money (src/call-ceiling.js, gates in src/call-gates.js).
// Figures are DERIVED from reading, by hand and by a text-only script (S11_EXPECTED_REDS.md, section 2); T13's mini roster: K 4/3/2, C = 4, b1 = 7, b2 = 5, w = 3, PR reading, external writer, final_read on.
// SEAMS (named so the unit that merges second re-derives): at this merge Cl is 4 (ONE runFinalRead site per run until S16 adds the second read: +4) and Pn is 27 (S9 builds the proposer returns, behind callGatesOf(config).proposerReturn: decisions rule on, the S9 words recorded, P >= 1; it was 0 at the S11 merge), so T13's total is 14890
// here (14863 at the S11 merge) and 14894 after S16 too. Every row that hard-codes a figure that depends on the held wording is marked "MOVES AT THE APPLY": when the apply records the rating demand and the go-up words the released-tree figure becomes the injected one.
// Rows read `dryRunReport(config).callCeiling` and the spawned `--dry-run` through optional chaining, so on a tree without the feature the FIRST assertion fails (undefined != the figure), never a TypeError and never a missing import.
// Pure helpers (exchangeCallsOf, proposerReturnCalls) are NAMED PINS: a dynamic guarded import, so a tree without the module fails the row and the file still loads.
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setHeldForTest } from '../src/held-roles.js';
import { estimateChainRows } from '../src/cost.js';
import * as DRY from '../src/dry-run.js';
import * as HB from './held-prompts/held-084-b.js';
import * as HESC from './held-prompts/held-escalation.js';
import * as HS9 from './held-prompts/held-084-s9.js';
import { DEMAND } from './helpers/rating-demand.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CEIL = await import('../src/call-ceiling.js').catch(() => ({}));
const GATES = await import('../src/call-gates.js').catch(() => ({}));
afterEach(() => setHeldForTest(null));

// ---- the wording that switches every feature on (held text injected in-process; a spawned CLI cannot inject it)
const PAIR = { shortExchangeRule: HB.shortExchangeRule, signoffLineRule: HB.signoffLineRule };
const NOTE = { signoffRefusedReaskNote: HB.signoffRefusedReaskNote };
const ENDING = { lateFindingRule: HB.lateFindingRule, lastRoundReplyRule: HB.lastRoundReplyRule };
const GOUP = { layerOneGoUpLine: HB.layerOneGoUpLine, goUpRulingSystem: HB.goUpRulingSystem, goUpRulingUser: HB.goUpRulingUser, goUpRulingsSection: HB.goUpRulingsSection };
const RULINGS = { escalationRulingSystem: HESC.escalationRulingSystem, escalationRulingUser: HESC.escalationRulingUser, ledgerRulingsSection: HESC.ledgerRulingsSection };
const S9WORDS = Object.fromEntries(Object.entries(HS9).filter(([, v]) => typeof v === 'function'));   // S9: the proposer return's words (one batch; the gate reads decisionLevelRule for all of them)
const ALL = { ...DEMAND, ...PAIR, ...NOTE, ...ENDING, ...GOUP, ...RULINGS, ...S9WORDS };
/** Every wording this unit reads OFF, whatever src/roles.js records (a map with an undefined value switches a held name off). */
const OFF = Object.freeze(Object.fromEntries(Object.keys(ALL).map(n => [n, undefined])));

const seat = (lab, layer, provider = 'mock', model = 'mock-review-fixture') => ({ provider, model, lab, layer, maxTokens: 3000 });
const critics = (ks, provider, model) => ks.flatMap((k, i) => Array.from({ length: k }, (_, j) => seat(`l${i + 1}x${j + 1}`, i + 1, provider, model)));
/** T13's chain (mini roster 4/3/2) or another roster; `over` replaces top-level keys. */
const cfgOf = (ks = [4, 3, 2], over = {}) => ({
  name: 'ceil', signoff: 'unanimous', decisions: { enabled: true },   // S9: the proposer return needs a Decisions section to contest; DELIBERATE, calls (not tokens) are counted here
   maxOverseerRounds: 4, layerRevisions: { 1: 7, 2: 5 }, answer_back: { enabled: true }, dispute: { enabled: true, stall_rounds: 3 },
  estimate: { promptTokens: 4000, draftTokens: 6000, critiqueTokens: 1200 },
  seats: { criteria: { provider: 'mock', model: 'mock-criteria' }, builder: { provider: 'external', model: 'claude-code-session' }, reviser: { provider: 'external', model: 'claude-code-session' },
    proposers: [0, 1, 2].map(i => ({ provider: 'mock', model: 'mock-proposer', lab: `p${i}` })), critics: critics(ks) },
  ...over,
});
const ceilOf = (cfg, held, opts) => { setHeldForTest(held); return DRY.dryRunReport(cfg, opts).callCeiling; };

// ---------------------------------------------------------------------------------------------------------------- R-T13: the figure and its terms
test('R-T13 (T13, base 3072): the mini under PR with every feature live: terms X 10896, V 864, Ia 2652, Rk 24, Cl 8 (4 before S16), Pn 27 (0 at the S11 merge), S 255, CR 0, Nd 168; maximum 14894 (14890 before S16, 14863 at the S11 merge); base term 3072', () => {
  const cc = ceilOf(cfgOf(), ALL);
  // CHANGED ACCEPTED (0.8.4 ladder unit, owed list 'call-ceiling rows that pin ...': the layer-1 exchange stops after 3 rounds (lowEx 24), the in-pass asks are 3 per seat (2 re-asks + the solo ask), F3 stays 3 (the lone-heard pass of layer 1 keeps its two re-ask passes); 10 Nov 2026). OLD: maximum 14894, terms { X: 10896, V: 864, Ia: 2652, Rk: 24, Pn: 27, Cl: 8, S: 255, CR: 0, Nd: 168 }, base 3072. NEW (derived: lowEx = 3 x (4 + 4) = 24; base = 4 x (24 x 13 + 6 x 6 + 4) = 1408; X = 3 x (1408 + 560) = 5904; V = 864; Ia = 3 x (864 + 3 x 140 + 3 x 14) = 3978; Rk = 3 x 2 x 4 = 24; S = 3 x 53 = 159; Nd = 3 x 56 = 168): maximum 5904 + 864 + 3978 + 24 + 27 + 8 + 159 + 168 = 11132.
  assert.equal(cc?.maximum, 11132, JSON.stringify(cc?.terms));   // 14890 before S16 (Cl 4: ONE read), 14863 at the S11 merge, + Pn 27 = 3 x 3 x (4 - 1)
  assert.deepEqual(cc?.terms, { X: 5904, V: 864, Ia: 3978, Rk: 24, Pn: 27, Cl: 8, S: 159, CR: 0, Nd: 168 });
  assert.equal(cc?.base, 1408, 'the base term is the exchange calls of the productive passes only, before the factor 3 and the extras');
  assert.equal(cc?.reading, 'per_round');
});

test('R-IA-parts (S11-R2 reading B): the in-pass term is on EVERY blind-review call the figure counts: V 864 -> 1728, the reviews inside E_r 420 -> 840, the reviews inside S 42 -> 84', () => {
  const cc = ceilOf(cfgOf(), ALL);
  // CHANGED ACCEPTED (0.8.4 ladder unit, owed list 'call-ceiling rows that pin ...': the layer-1 exchange stops after 3 rounds (lowEx 24), the in-pass asks are 3 per seat (2 re-asks + the solo ask), F3 stays 3 (the lone-heard pass of layer 1 keeps its two re-ask passes); 10 Nov 2026). OLD: { IaV: 1728, IaE: 840, IaS: 84 }, Ia 2652. NEW: IaV = 3 x 864 = 2592, IaE = 3 x 3 x 140 = 1260, IaS = 3 x 3 x 14 = 126, Ia = 3978.
  assert.deepEqual(cc?.parts, { IaV: 2592, IaE: 1260, IaS: 126 });
  assert.equal(cc?.terms?.Ia, 3978);
});

test('R-T13 b2 variants: b2 = 3 and b2 = 7 (PR): 12470 and 17318 after S16 (12466 and 17314 before it, 12439 and 17287 at the S11 merge, + Pn 27; Part 0 printed 10274 and 14162)', () => {
  assert.equal(ceilOf(cfgOf([4, 3, 2], { layerRevisions: { 1: 7, 2: 3 } }), ALL)?.maximum, 9236);   // CHANGED ACCEPTED (0.8.4 ladder unit, owed list 'call-ceiling rows that pin ...': the layer-1 exchange stops after 3 rounds (lowEx 24), the in-pass asks are 3 per seat (2 re-asks + the solo ask), F3 stays 3 (the lone-heard pass of layer 1 keeps its two re-ask passes); 10 Nov 2026). OLD 12470   // 12466 before S16, 12439 at the S11 merge
  assert.equal(ceilOf(cfgOf([4, 3, 2], { layerRevisions: { 1: 7, 2: 7 } }), ALL)?.maximum, 13028);   // CHANGED ACCEPTED (0.8.4 ladder unit, owed list 'call-ceiling rows that pin ...': the layer-1 exchange stops after 3 rounds (lowEx 24), the in-pass asks are 3 per seat (2 re-asks + the solo ask), F3 stays 3 (the lone-heard pass of layer 1 keeps its two re-ask passes); 10 Nov 2026). OLD 17318   // 17314 before S16, 17287 at the S11 merge
});

test('R-T13b/d/e/f (PN, the pending P1 reading, `callReading: run_wide`): base 2142 enters X once inside the factor 3; V 549; maximum 10349 (10345 before S16, 10318 at the S11 merge; Part 0: 8573); one continue 2084 (2075 at the S11 merge; Part 0: 1736)', () => {
  setHeldForTest(ALL);
  const cc = DRY.dryRunReport(cfgOf(), { callReading: 'run_wide' }).callCeiling;
  assert.equal(cc?.reading, 'run_wide');
  // CHANGED ACCEPTED (0.8.4 ladder unit, owed list 'call-ceiling rows that pin ...': the layer-1 exchange stops after 3 rounds (lowEx 24), the in-pass asks are 3 per seat (2 re-asks + the solo ask), F3 stays 3 (the lone-heard pass of layer 1 keeps its two re-ask passes); 10 Nov 2026). OLD: base 2142, V 549, X 7566, maximum 10349, one continue 2084. NEW: base = 24 x 37 + 6 x 9 + 4 x 4 = 958, V 549 (unchanged), X = 3 x (958 + 380) = 4014, maximum 3 x (2549 - 35) + 35 = 7577 (every term but Pn 27 and Cl 8 carries the factor 3), one continue 3 x 503 - 2 x 11 = 1487 (the proposer returns 9 and K3 2 carry no factor).
  assert.equal(cc?.base, 958);
  assert.equal(cc?.terms?.V, 549);
  assert.equal(cc?.terms?.X, 4014);
  assert.equal(cc?.maximum, 7577, JSON.stringify(cc?.terms));   // 10345 before S16 (Cl 4), 10318 at the S11 merge, + Pn 27
  assert.equal(cc?.perContinue, 1487);   // OLD 2084
});

test('R-T13g/c (words): the sentence calls the figure a worst-case ceiling for no continue; it names neither a budget nor an allowance, carries no currency symbol, no token-cap word, no retry-allowance field; the two repeats stay outside in one clause', () => {
  for (const reading of ['per_round', 'run_wide']) {
    setHeldForTest(ALL);
    const cc = DRY.dryRunReport(cfgOf(), { callReading: reading }).callCeiling;
    const words = cc?.words ?? '';
    // CHANGED ACCEPTED TEST (0.8.4 apply, recorded state): OLD: "Calls: at most N model calls, the most this chain's rules allow (a worst-case ceiling on calls for a run with no continue added)" and "not a repeat of the same call (...)". NEW: "Calls: at most N model calls in a run with no continue added. That is the most this chain's rules allow; it counts calls, not money." and "A repeat of the same call (...) is not in it". WHY: the call-ceiling words (src/call-ceiling.js:151), the resolved text of the row (RESOLVED_LIST).
    assert.match(words, new RegExp(`Calls: at most ${cc?.maximum} model calls in a run with no continue added\\. That is the most this chain's rules allow; it counts calls, not money\\.`), `${reading}: ${words}`);
    assert.match(words, /A repeat of the same call \(a dropped connection asked again, an Anthropic seat's one retry\) is not in it/);
    assert.match(words, /The limit you type is what stops a run\./);
    assert.doesNotMatch(words, /budget|allowance|[$€£]|max_?tokens|token cap/i, 'no budget or allowance wording, no currency symbol, no token-cap field');
  }
});

// ---------------------------------------------------------------------------------------------------------------- continues, the writer, the hard bound
test('R-T13 continue (Q11): one continue under PR adds 3599 (3590 at the S11 merge; Part 0: 2951), the proposer share 3P = 9 now counted; under PN 2084 (see above)', () => {
  assert.equal(ceilOf(cfgOf(), ALL)?.perContinue, 2672);   // CHANGED ACCEPTED (0.8.4 ladder unit, owed list 'call-ceiling rows that pin ...': the layer-1 exchange stops after 3 rounds (lowEx 24), the in-pass asks are 3 per seat (2 re-asks + the solo ask), F3 stays 3 (the lone-heard pass of layer 1 keeps its two re-ask passes); 10 Nov 2026). OLD 3599
});

test('R-T13m (W_api): an API writer or reviser adds 82 calls (20 a round x 4 + 2) beside the maximum and 20 per continue; a session (external) writer adds none', () => {
  const api = cfgOf([4, 3, 2], {}); api.seats.builder = { provider: 'mock', model: 'mock-builder' }; api.seats.reviser = { provider: 'mock', model: 'mock-builder' };
  assert.deepEqual(ceilOf(api, ALL)?.apiWriter, { calls: 82, perContinue: 20 });
  assert.equal(ceilOf(cfgOf(), ALL)?.apiWriter, null, 'a session writer seat is no API call');
});

test('R-T13i / R-T22ag: one continue at a stop for a seat with no usable reply: 113 a pass, 226 for the two passes (Part 0: 85, 170); the handling session\'s hard bound c_u = 2 x 226 = 452 (Part 0: 340); the sentence calls it a hard bound against a runaway, not planned, with no allowance or budget word', () => {
  const cc = ceilOf(cfgOf(), ALL);
  assert.deepEqual(cc?.untilNoReply, { perPass: 95, perContinue: 190, handlingBound: 380 });   // CHANGED ACCEPTED (0.8.4 ladder unit, owed list 'call-ceiling rows that pin ...': the layer-1 exchange stops after 3 rounds (lowEx 24), the in-pass asks are 3 per seat (2 re-asks + the solo ask), F3 stays 3 (the lone-heard pass of layer 1 keeps its two re-ask passes); 10 Nov 2026). OLD { 113, 226, 452 }: rerunPass = S 53 + 3 x 14 = 95
  assert.match(cc?.words ?? '', /one continue adds at most 190 calls; the handling session can make at most 2 of these on its own, so at most 380 more in all\. That is a hard bound against a runaway, not something planned or expected\./);
});

// ---------------------------------------------------------------------------------------------------------------- the terms that are zero or once-per-run
test('R-T13h/p/q/x/y/k/n/v (CR): the manners step is 0 calls at every one of the C + 1 agreement points, on the mini, the medium (3/2/2) and the high chain (6/4/2); it is not priced as a closing round and carries no factor 3', () => {
  for (const ks of [[4, 3, 2], [3, 2, 2], [6, 4, 2]]) {
    const cc = ceilOf(cfgOf(ks), ALL);
    assert.deepEqual(cc?.manners, { pointsPerRun: 5, perPoint: 0, total: 0 }, `roster ${ks}`);
    assert.equal(cc?.terms?.CR, 0);
  }
});

test('R-T13z (Nd): the ending exchange is 168 = 3 x 56, once per run; zero while its wording is held', () => {
  assert.equal(ceilOf(cfgOf(), ALL)?.terms?.Nd, 168);   // the ending exchange keeps its 7 rounds (7 x 8 = 56) and the factor 3 stays: unchanged by the ladder unit (the round before had moved it to 56 with a factor 1; the lone-heard ruling of 10 Nov 2026 put the factor back)
  assert.equal(ceilOf(cfgOf(), { ...ALL, lateFindingRule: undefined })?.terms?.Nd, 0, 'held: no ending exchange can run');
});

test('R-T13aa / R-T22ak / R-T13n (Cl): the final read is 2 x K3 = 4 calls a read and TWO reads per run (the read at the ending and the read before a finish) = 8 since S16 (4 before it, ONE read), never per agreement point; there is no switch: `final_read` set to false changes nothing', () => {
  const cc = ceilOf(cfgOf(), ALL);
  assert.deepEqual(cc?.finalReads, { perRead: 4, readsPerRun: 2, total: 8, perExtraPart: 4 });   // CHANGED ACCEPTED (S16, T21bp): OLD { perRead, readsPerRun, total }; NEW adds perExtraPart, the price of one extra part (Cp = 2 x K3 x (p_L - 1) at p_L = 2)
  assert.equal(cc?.terms?.Cl, 8);
  assert.equal(ceilOf(cfgOf([4, 3, 2], { final_read: { enabled: false } }), ALL)?.terms?.Cl, 8, 'N6: no switch, the key is read by nothing');
});

test('R-T22af: a layer-1 pass is priced at 56 calls (168 with the factor 3) inside X, and there is NO second exchange term: the base is 56 x 13 + 6 x 6 + 4 per overseer round', () => {
  const cc = ceilOf(cfgOf(), ALL);
  // CHANGED ACCEPTED (0.8.4 ladder unit, owed list 'call-ceiling rows that pin ...': the layer-1 exchange stops after 3 rounds (lowEx 24), the in-pass asks are 3 per seat (2 re-asks + the solo ask), F3 stays 3 (the lone-heard pass of layer 1 keeps its two re-ask passes); 10 Nov 2026). OLD: 56 x 13 x 4 and base 4 x (56 x 13 + 6 x 6 + 4) (the layer-1 exchange ran 7 rounds). NEW: 24 x 13 x 4 = 1248 and base 1408.
  assert.equal(cc?.rowTerms?.layer1Exchange, 24 * 13 * 4);
  assert.equal(cc?.base, 4 * (24 * 13 + 6 * 6 + 4));
});

// ---------------------------------------------------------------------------------------------------------------- the counting equality that outlives the unit (R-S5)
const timesOf = (rows, re, not) => rows.filter(r => re.test(r.label) && !(not && not.test(r.label))).reduce((t, r) => t + (r.times ?? 1), 0);
const GROUPS = {
  panel: [/^panel-L\d+-/, /-(reask3?|solo)$/], inPass: [/^panel-L\d+-.*-(reask|solo)$/],   // 0.8.4 ladder unit: the solo ask's `-solo` row is an in-pass ask, not a review row
  layer1Exchange: [/^(ldebate|lreply)-L1-/], upperExchange: [/^(ldebate|lreply)-L[23]-/], reask3: [/^panel-L\d+-.*-reask3$/],
  ruleBound: [/^rule-bound-L2-/], ruleGoUp: [/^rule-go-up-L3-/], endingExchange: [/^(ldebate|lreply)-end-L1-/], finalRead: [/^final-read-L3-/], proposerReturn: [/^return-(alt|post|answer)-/],
};

test('R-S5 (the equality): for the test config the formula\'s row terms (computed from the config, never from the rows) equal the calls in the USD maximum\'s rows, group by group; the differences are only the NAMED ones', () => {
  setHeldForTest(ALL);
  const cfg = cfgOf();
  const rows = estimateChainRows(cfg, { maximum: true });
  const cc = DRY.dryRunReport(cfg).callCeiling;
  for (const [group, [re, not]] of Object.entries(GROUPS)) assert.equal(cc?.rowTerms?.[group], timesOf(rows, re, not), `${group}`);
  // the numbers, so a drift in the rows OR the formula is named: panel 288, in-pass 576, layer-1 exchange 2912, layer-2/3 exchange 160, -reask3 8, rule-bound 72, rule-go-up 8, ending exchange 56, final read 4, proposer return 27 (S9)
  assert.deepEqual(cc?.rowTerms, { panel: 288, inPass: 864, layer1Exchange: 1248, upperExchange: 160, reask3: 8, ruleBound: 72, ruleGoUp: 8, endingExchange: 56, finalRead: 4, proposerReturn: 27 });
  // NAMED DIFFERENCES (not asserted as equal): the factor 3 on X, V, S and Nd (the USD maximum leaves the re-ask PASSES out, cost.js); E_r 1680 against the 80 rule rows; Ia on re-ask passes, E_r and S (reading B);
  // S (no rows); Pn equals its rows only when every proposer's alternative is readable (an unreadable reply makes fewer calls, never more) and P >= 2; the second final read (S16); `revise-all` (writer: 51) against W_api (82); `network-retries` (3, a re-send, outside by S11-R2); the rows of switches this config leaves off;
  // and free or external seats, whose re-ask rows pushExpected drops at $0 while the calls exist (R-free-seat).
});

test('R-gate-matrix: the terms whose rows match one to one (layer-2/3 exchange, -reask3, the ending exchange, the final read, in-pass re-asks, V, layer 1) are live exactly when their USD rows are, across six held-text and switch states', () => {
  const states = [
    ['all', ALL, cfgOf()], ['pair only', { ...DEMAND, ...PAIR }, cfgOf()], ['pair and note', { ...DEMAND, ...PAIR, ...NOTE }, cfgOf()], ['ending only', { ...DEMAND, ...ENDING }, cfgOf()],
    ['nothing held', { ratingDemand: undefined, shortExchangeRule: undefined, signoffLineRule: undefined, signoffRefusedReaskNote: undefined, lateFindingRule: undefined }, cfgOf()],
    ['final_read key set false (no switch since S16)', ALL, cfgOf([4, 3, 2], { final_read: { enabled: false } })],
    ['S9 words off', { ...ALL, decisionLevelRule: undefined }, cfgOf()],
  ];
  for (const [name, held, cfg] of states) {
    setHeldForTest(held);
    const rows = estimateChainRows(cfg, { maximum: true });
    const cc = DRY.dryRunReport(cfg).callCeiling;
    for (const g of ['panel', 'inPass', 'layer1Exchange', 'upperExchange', 'reask3', 'endingExchange', 'finalRead', 'proposerReturn']) {
      const [re, not] = GROUPS[g];
      assert.equal(cc?.rowTerms?.[g], timesOf(rows, re, not), `${name}: ${g}`);
    }
  }
});

test('R-free-seat: the call ceiling counts the calls of a free or external seat that the USD rows drop at $0 (pushExpected): in-pass re-asks and the final-read re-ask exist, they cost nothing', () => {
  setHeldForTest(ALL);
  const cfg = cfgOf();
  cfg.seats.critics = critics([4, 3, 2], 'ollama', 'llama3');
  const rows = estimateChainRows(cfg, { maximum: true });
  assert.equal(timesOf(rows, ...GROUPS.inPass), 0, 'the USD maximum has no in-pass re-ask row for a $0 seat');
  const cc = DRY.dryRunReport(cfg).callCeiling;
  assert.equal(cc?.rowTerms?.inPass, 864);   // CHANGED ACCEPTED (0.8.4 ladder unit, owed list 'call-ceiling rows that pin ...': the layer-1 exchange stops after 3 rounds (lowEx 24), the in-pass asks are 3 per seat (2 re-asks + the solo ask), F3 stays 3 (the lone-heard pass of layer 1 keeps its two re-ask passes); 10 Nov 2026). OLD 576
  assert.equal(cc?.terms?.Ia, 3978);   // OLD 2652
});

// ---------------------------------------------------------------------------------------------------------------- w: a parameter read where the run reads it
test('R-w: the ceiling reads the stall window the RUN reads (chain.js stallWindowOf): a chain that omits dispute.stall_rounds prints the figure for 2 (X 6048), one that sets 3 prints T13\'s (X 5904)', () => {   // CHANGED ACCEPTED (0.8.4 ladder unit, owed list 'call-ceiling rows that pin ...': the layer-1 exchange stops after 3 rounds (lowEx 24), the in-pass asks are 3 per seat (2 re-asks + the solo ask), F3 stays 3 (the lone-heard pass of layer 1 keeps its two re-ask passes); 10 Nov 2026). OLD X 11040 / 10896
  const omitted = cfgOf([4, 3, 2], { dispute: { enabled: true } });
  const cc = ceilOf(omitted, ALL);
  assert.equal(cc?.inputs?.w, 2);
  assert.equal(cc?.terms?.X, 6048);
  assert.equal(ceilOf(cfgOf(), ALL)?.terms?.X, 5904);
  assert.equal(GATES.stallWindowOf?.(omitted), 2);
  assert.equal(GATES.stallWindowOf?.(cfgOf()), 3);
});

// ---------------------------------------------------------------------------------------------------------------- the spawned CLI: the released tree (MOVES AT THE APPLY) and the JSON
const cliDir = () => {
  // the shipped offline layered chain (a chain that lints), re-rostered to T13's mini 4/3/2 with overseer rounds
  const dir = mkdtempSync(join(tmpdir(), 'ceil-'));
  mkdirSync(join(dir, 'chains')); mkdirSync(join(dir, 'tasks'));
  const { maxRounds: _m, ...base } = JSON.parse(readFileSync(join(root, 'chains', 'mock-layered.json'), 'utf8'));
  const chain = { ...base, name: 'ceil', maxOverseerRounds: 4, layerRevisions: { 1: 7, 2: 5 }, answer_back: { enabled: true },
    seats: { ...base.seats, critics: critics([4, 3, 2]).map(c => ({ ...c, model: 'mock-critic-a' })) } };
  writeFileSync(join(dir, 'chains', 'ceil.json'), JSON.stringify(chain));
  writeFileSync(join(dir, 'tasks', 't.md'), '# A plan\n');
  return dir;
};
const dry = (dir, extra = []) => spawnSync(process.execPath, [join(root, 'src', 'cli.js'), '--chain', 'ceil', '--task', 'tasks/t.md', '--dry-run', ...extra], { cwd: dir, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: dir } });

test('R-T13rel (the recorded state: the rating demand, the go-up words and the short exchange are recorded, so the stall pass, the rulings and the short exchange are in the ceiling): the printed block names the figure of the recorded tree, 11105 (7508 before the apply; the title said 11675, the figure of the released 0.8.3 tree, which no tree since the ladder unit prints), and the sentences', () => {
  const dir = cliDir();
  try {
    const r = dry(dir); assert.equal(r.status, 0, r.stderr);
    // CHANGED ACCEPTED TEST (0.8.4 apply, recorded state), SENTENCE HALF ONLY: OLD: "Calls: at most 7508 model calls, the most this chain's rules allow (a worst-case ceiling on calls for a run with no continue added)." NEW: "Calls: at most 7508 model calls in a run with no continue added. That is the most this chain's rules allow; it counts calls, not money." WHY: src/call-ceiling.js:151, the resolved text of the row (RESOLVED_LIST). [SUPERSEDED by the CHANGED ACCEPTED note below: the figure was re-pinned on 11 Nov 2026] The figure 7508 is a dry-run count that moved with the recorded exchange rows: it WAITED for the regeneration and was NOT re-pinned here.
    // CHANGED ACCEPTED (0.8.4 apply, 11 Nov 2026; C&C released the re-pin): OLD 7508 (33f57b69, 10 Nov 17:26: 3 x (2508 - 8) + 8). NEW 11105. WHY, one step, dc60423a (the 112 held names recorded): the terms of src/call-ceiling.js moved X 3768 -> 5904 (+2136), Ia 2763 -> 3978 (+1215), Rk 0 -> 24 (+24), S 105 -> 159 (+54) and Nd 0 -> 168 (+168), the others unchanged (V 864, Cl 8, Pn 0, CR 0): 2136 + 1215 + 24 + 54 + 168 = 3597 = 11105 - 7508, nothing left over; the gates that turned on are live.upperExchange, events, goUpRulings, signoffReask, endingExchange and finalReadParts (terms printed by a $0 probe on the parent and on dc60423a).
    assert.match(r.stdout, /\n  Calls: at most 11105 model calls in a run with no continue added\. That is the most this chain's rules allow; it counts calls, not money\./, r.stdout);
    assert.match(r.stdout, /\n  Each continue you choose adds at most \d+ calls\./);
    assert.match(r.stdout, /The limit you type is the only ceiling/, 'the existing money sentence is still there');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('R-json (MOVES AT THE APPLY: it hard-codes the released-tree figure): `--dry-run --json` keeps schemaVersion 1 and every key it had, adds `callCeiling`, and carries no printed block (the human line is not in the JSON document as a line)', () => {
  const dir = cliDir();
  try {
    const r = dry(dir, ['--json']); assert.equal(r.status, 0, r.stderr);
    const j = JSON.parse(r.stdout);
    assert.equal(j.schemaVersion, 1);
    assert.equal(j.callCeiling?.maximum, 11105);   // CHANGED ACCEPTED (0.8.4 apply, 11 Nov 2026, same split as R-T13rel above: 7508 + 3597 at dc60423a). EARLIER NOTE (0.8.4 ladder unit, the exchange and solo rulings, 10 Nov 2026): OLD 11675. NEW 7508 = 3 x (2508 - 8) + 8, where 2508 is the figure at the factor 1 (X 1256, V 288, Ia 921, Cl 8, S 35) and only Cl 8 carries no factor 3 here
    assert.ok(j.estimate && j.rows && j.seats, 'the existing keys are still there');
    assert.doesNotMatch(r.stdout, /^\s{2}Calls: at most/m, 'the human block is printed only without --json');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('R-w5 (the sentence moves with the code): the dry run\'s second paragraph says the upper estimate COUNTS the in-pass re-asks (it has since unit 4) and still ends with the money sentence', () => {
  const dir = cliDir();
  try {
    const r = dry(dir); assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /it counts the in-pass re-asks \(up to 2 per seat\) at the review's expected cost, but not up to 2 consecutive passes that re-ask a silent seat/);
    assert.doesNotMatch(r.stdout, /does not count the in-pass re-asks/);
    assert.match(r.stdout, /a pass that asks a silent seat again, the retry of a cut-off reply from another seat/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ---------------------------------------------------------------------------------------------------------------- NAMED PINS
test('NAMED PIN T13j/T13s/T4j (exchangeCallsOf): a round costs its K posts and, with two or more raisers, one reply each; a one-raiser round costs K, not K + 1; a posts-only round costs K and no reply; A = 1, 2, 2 at K = 4 costs 4 + 6 + 6 = 16. FAIL = a one-raiser round priced at K + 1, a three-round exchange not 16, or a reply priced for a posts-only round', () => {
  assert.equal(CEIL.exchangeCallsOf?.(4, [1, 2, 2]), 16);
  assert.equal(CEIL.exchangeCallsOf?.(4, [1]), 4, 'T13s: the round with one raiser costs K calls (4 here), not 5');
  assert.equal(CEIL.exchangeCallsOf?.(4, [0, 0]), 8, 'T4j: a converged two-round exchange of support and no-view posts: the posts alone, no reply');
  assert.equal(CEIL.exchangeCallsOf?.(4, Array(7).fill(4)), 56, 'the calls of seven rounds at K = 4 (the ENDING exchange keeps its seven)');
  assert.equal(CEIL.exchangeCallsOf?.(4, Array(3).fill(4)), 24, 'the layer-1 pass ceiling 3 x (K1 + A1) (MOVED BAR, exchange idea 2: it was 7 x)');
});

test('NAMED PIN Pn (seam S9): proposer returns are 3P(C-1) = 27 at P = 3, C = 4 in the helper and in the ceiling behind callGatesOf(config).proposerReturn, and 0 whenever one condition fails. FAIL = Pn is not 27 with all of them, or is not 0 without any one (words off, no Decisions rule, no proposer seat)', () => {
  assert.equal(CEIL.proposerReturnCalls?.(3, 4), 27);
  assert.equal(CEIL.PROPOSER_RETURNS_BUILT, true);
  assert.equal(ceilOf(cfgOf(), ALL)?.terms?.Pn, 27);
  assert.equal(ceilOf(cfgOf(), ALL)?.terms?.Pn, 3 * 3 * (4 - 1));
  assert.equal(ceilOf(cfgOf(), OFF)?.terms?.Pn, 0, 'the S9 words off (OFF switches every held name off, whatever src/roles.js records)');
  assert.equal(ceilOf(cfgOf([4, 3, 2], { decisions: undefined }), ALL)?.terms?.Pn, 0, 'no Decisions rule: a mark cannot name an entry');
  const noProposers = cfgOf(); delete noProposers.seats.proposers;
  assert.equal(ceilOf(noProposers, ALL)?.terms?.Pn, 0, 'no proposer seat (S9a): no return, the writer route; there is no fall back to the critics');
  assert.equal(ceilOf(cfgOf(), ALL)?.live?.proposerReturns, true);
  assert.equal(ceilOf(noProposers, ALL)?.live?.proposerReturns, false);
});

test('NAMED PIN N-gate-Er: E_r\'s pass gates are chain.js\'s own booleans (src/call-gates.js callGatesOf), not a restated expression. FAIL = chain.js tests ledgerOn && severityOn / the go-up line inline at the stall pass or the layer-1 go-up, or src/call-ceiling.js tests ledgerOn, severityOn, rulingActive or stall_rounds itself', () => {
  const chain = readFileSync(join(root, 'src', 'chain.js'), 'utf8'); const ceil = readFileSync(join(root, 'src', 'call-ceiling.js'), 'utf8');
  assert.match(chain, /const callGates = callGatesOf\(config\);/);
  assert.match(chain, /const stallGoUpOn = callGates\.goUpOn;/);
  assert.match(chain, /layer1BoundGoUp\(stop\) && callGates\.goUpOn && layerOneGoUpLineOn\(\) && !roundChoices/);
  assert.match(chain, /const stallRounds = stallWindowOf\(config\);/);
  assert.match(chain, /const disputeEnabled = disputeOn\(config\);/);
  const code = ceil.split('\n').filter(l => !l.trim().startsWith('//')).join('\n');
  assert.doesNotMatch(code, /ledgerOn\s*=|severityOn\s*=|rulingActive\(|ratingsDemanded\(|stall_rounds|dispute\??\.enabled/, 'call-ceiling.js imports the gates; it restates none (the dispute term included)');
});

test('NAMED PIN N-gate-S: S has no chain-level gate (a stale rerun is a resume event; the guard is armed only by the main run\'s CLI, never in a dry run), so the ceiling carries it for every such chain, dry run included: 255 with every feature live and 201 in the released tree (its components follow their own gates: this unit\'s reading, not the plan\'s). FAIL = S is 0 in a dry run, differs from the formula for the config, or call-ceiling.js tests the stale guard\'s arming', () => {
  assert.equal(ceilOf(cfgOf(), ALL)?.terms?.S, 159);   // CHANGED ACCEPTED (0.8.4 ladder unit, the exchange and solo rulings, 10 Nov 2026). OLD 255 and 201
  assert.equal(ceilOf(cfgOf(), OFF)?.terms?.S, 105, 'every wording off, whatever roles.js records: only the layer-3 reviews of the layer-2-bound go-up pass');
  const code = readFileSync(join(root, 'src', 'call-ceiling.js'), 'utf8').split('\n').filter(l => !l.trim().startsWith('//')).join('\n');
  assert.doesNotMatch(code, /stale-guard|wordingChanged|createWordingLedger/);
});

test('R-shape: a chain that is not a layered unanimous chain with overseer rounds and three layers numbered 1, 2, 3 has no callCeiling key (additive: every other dry-run document is what it was)', () => {
  setHeldForTest(ALL);
  const flat = { name: 'flat', signoff: 'unanimous', maxRounds: 3, seats: { criteria: { provider: 'mock', model: 'mock-criteria' }, builder: { provider: 'mock', model: 'mock-builder' }, critics: [{ provider: 'mock', model: 'mock-critic-a', lab: 'a' }] } };
  assert.equal('callCeiling' in DRY.dryRunReport(flat), false);
  assert.equal('callCeiling' in DRY.dryRunReport(cfgOf([2, 2])), false, 'two layers: outside Part 0\'s formulas (named limit)');
  assert.equal(typeof DRY.dryRunReport(cfgOf()).callCeiling, 'object');
});

test('S16-w55c (Cp): the dry run says what ONE extra part of the final read adds (one call and one re-ask for each judge of the top layer) and that the maximum of calls does not count it - because the part sentence is recorded', () => {
  const LINE = /The final read asks each judge of the top layer once; when the open objections do not fit a judge's input window it asks the judges again for the rest, in parts\. Each extra part adds at most 4 calls \(one call and one re-ask for each judge of the top layer\), and the maximum of calls above does not count them: how many parts a run needs depends on its objections\. A part the provider refuses for its size is split and asked again in halves; a list of n open objections and late findings takes at most 2 x n - 1 asks for each judge, and those asks are not in the maximum either\./;
  // CHANGED ACCEPTED TEST (0.8.4 apply, recorded state): OLD: the row first asserted the held state (no 'extra part' line while finalReadPartRule is not recorded) and injected finalReadPartRule. NEW: the held-state half and the injection are REMOVED; the recorded-state half of this same row stays. WHY: finalReadPartRule is recorded (src/prompts/recorded-084-s16.js:6).
  setHeldForTest(ALL);
  const cc = DRY.dryRunReport(cfgOf(), { callReading: 'run_wide' }).callCeiling;
  assert.match(cc.words, LINE);
  assert.doesNotMatch(cc.words, /budget|allowance|[$€£]|max_?tokens|token cap/i);
  assert.equal(cc.finalReads.perExtraPart, 4);
});
