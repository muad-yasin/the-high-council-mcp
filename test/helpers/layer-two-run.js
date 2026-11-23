// A scripted three-layer run for the layer-2 section tests (JUDGE unit L2) and for taking pin digests on a pre-change tree: no helper here touches an export that L2 adds. Offline, $0: the real mock provider and a label-keyed scripted cache.
import { runChain, setPromptSpy, setCache, setBudget } from '../../src/chain.js';
import { objectionId } from '../../src/objection-ids.js';
import { promptHashOf } from '../../src/cache-integrity.js';

export const CRITERION = 'The plan defines a retry limit.';
export const DRAFT = 'The worker retries failed requests.';
const EV = 'Section two sets the retry limit to five attempts.';
// 0.8.4 S16 (D): a layer-3 seat 'lc' that READS the final plan and raises nothing. A run that ends with layer 3 unread now STOPS at the final read, so a fixture that ends that way gives its top seat this reply (`overrides: FINAL_READ_OK`).
export const FINAL_READ_OK = { 'final-read-lc': JSON.stringify({ meets: true, criteria: [{ criterion: CRITERION, verdict: 'MET', evidence: EV }], failures: [], verdict_line: 'ok' }) };
// 0.8.4 wording apply: with the relation wording recorded a failure a judge writes must declare its relation (`relation_missing` otherwise: an unreadable reply). `failureOf` is a FIRST raise (`relation: 'new'`); a SAME-SEAT repeat in a later pass is `repeatOf` (`continues <the seat's own standing id>`; valid only while that id stands: a withdrawn or closed id needs `reopens`); `bareFailureOf` is the failure with NO relation, for a test that pins the refusal.
export const bareFailureOf = severity => ({ criterion: CRITERION, problem: 'No retry limit is specified.', fix: 'Specify one.', quote: 'retries failed requests', severity });
export const failureOf = severity => ({ ...bareFailureOf(severity), relation: 'new' });
// The handler's answer to a build check (a `handler: true` run on a layered chain pauses at `build-check-1` once layer 3 signs off, and is not answered by default: script it as `overrides: { 'build-check-1': checkAnswerOf([...every open id the check lists]) }`; the reasons must name every id the check demands, else the answer is refused). The same JSON as test/helpers/build-check.js `answer`, kept here so this file imports nothing new.
export const checkAnswerOf = (ids, answer = 'good_to_build', note = 'The build can leave it.') => JSON.stringify({ answer, reasons: ids.map(id => `${id}: ${note}`).join(' ') });
export const idOf = severity => objectionId('la', bareFailureOf(severity));
export const repeatOf = (severity, lab = 'la') => ({ ...bareFailureOf(severity), relation: `continues ${objectionId(lab, bareFailureOf(severity))}` });

// opts: answerBack, ladder (the ladder's block of three layer-1 passes: pass 4 then starts at layer 2 while layer 1's objection is still open), l1Severity (the rating layer 1's judge gives), l1Replies (label -> reply text overrides), cutLabels (0.8.4 S8, test-only: labels the cache stub answers with a MISS, so an armed --finish (setOutboundScan({ finish: true })) cuts the run at the first of them)
// 0.8.4 S16 (E): `nonMockSlot: true` lists one non-mock seat (the security reviewer, a stage that is OFF: it is never called) so the chain is not the offline mock chain (chain.js isOfflineMockChain); with no handler the run then ends at a cap or a silent lower seat by rule.
// 0.8.4 S16 (D): `handler: true` makes the reviser seat external (a handling session, src/ending.js hasHandlingSession); a critic row may carry a third item, its model (`mock-unreadable` never reads). An error thrown by the run carries `served` and `prompts` (the labels asked and the prompts sent) for the stop tests.
export async function scenario({ answerBack = true, ladder = false, l1Severity = 5, extraFailures = [], overrides = {}, extra = {}, critics = null, runExtra = {}, cutLabels = [], handler = false, nonMockSlot = false, silentLabs = [], lines = null } = {}) {
  const signoff = () => JSON.stringify({ meets: true, criteria: [{ criterion: CRITERION, verdict: 'MET', evidence: EV }], failures: [], verdict_line: 'ok' });
  const raise = JSON.stringify({ meets: false, criteria: [{ criterion: CRITERION, verdict: 'FAILED', evidence: 'Missing.' }], failures: [failureOf(l1Severity), ...extraFailures], verdict_line: 'no' });
  const replies = label => overrides[label] ?? (label === 'panel-1-la' ? raise : undefined);
  const hashes = new Map(); const prompts = new Map(); const served = [];
  setPromptSpy(p => { hashes.set(p.label, promptHashOf(p.system, p.user)); prompts.set(p.label, { system: p.system, user: p.user, cacheHead: p.cacheHead }); });
  setCache({ invalidate: () => {}, get(label) { served.push(label); if (cutLabels.includes(label) || silentLabs.some(s => new RegExp(`^panel-\\d+-${s}(-|$)`).test(label))) return null; const text = overrides[label] !== undefined && !label.startsWith('panel-') ? overrides[label] : label.startsWith('panel-') ? (replies(label) ?? signoff()) : label.startsWith('revise-') ? `${DRAFT}\n\nRevision ${label.slice(7)}.` : DRAFT; return { text, provider: 'mock', model: 'm', usage: { input: 0, output: 0 }, usd: 0, promptHash: hashes.get(label) }; } });
  const seat = ([lab, layer, model]) => ({ provider: 'mock', model: model ?? 'mock-review-fixture', lab, maxTokens: 3000, layer });
  const config = { name: 'fixture-l2', criteria: [CRITERION], maxRounds: 4, maxOverseerRounds: 3, layerRevisions: { 1: 7, 2: 5 }, signoff: 'unanimous', ...(answerBack ? { answer_back: { enabled: true } } : {}),
    seats: { builder: seat(['writer']), reviser: handler ? { ...seat(['writer']), provider: 'external' } : seat(['writer']), ...(nonMockSlot ? { security_reviewer: { provider: 'anthropic', model: 'claude-opus-5-5', lab: 'unused' } } : {}), critics: (critics ?? [['la', 1], ['lb', 2], ['lc', 3]]).map(seat) }, ...extra };
  try {
    const result = await runChain({ request: 'Write a worker plan with a retry limit.', runId: 'r-l2', log: m => { lines?.push(m); }, config, ...(ladder ? { ladder: { block: 3, visits: 3, credit: 0, exchange: 0 } } : {}), ...runExtra });
    return { result, prompts, served };
  } catch (e) { if (e && typeof e === 'object') { e.served = served; e.prompts = prompts; } throw e; }
  finally { setPromptSpy(null); setCache(null); setBudget(null); }
}
