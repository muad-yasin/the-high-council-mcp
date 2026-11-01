// A scripted three-layer run for the layer-2 section tests (JUDGE unit L2) and for taking pin digests on a pre-change tree: no helper here touches an export that L2 adds. Offline, $0: the real mock provider and a label-keyed scripted cache.
import { runChain, setPromptSpy, setCache, setBudget } from '../../src/chain.js';
import { objectionId } from '../../src/objection-ids.js';
import { promptHashOf } from '../../src/cache-integrity.js';

export const CRITERION = 'The plan defines a retry limit.';
export const DRAFT = 'The worker retries failed requests.';
const EV = 'Section two sets the retry limit to five attempts.';
export const failureOf = severity => ({ criterion: CRITERION, problem: 'No retry limit is specified.', fix: 'Specify one.', quote: 'retries failed requests', severity });
export const idOf = severity => objectionId('la', failureOf(severity));

// opts: severity (switch on), answerBack, ladder (the ladder's block of three layer-1 passes: pass 4 then starts at layer 2 while layer 1's objection is still open), l1Severity (the rating layer 1's judge gives), l1Replies (label -> reply text overrides)
export async function scenario({ severity = true, answerBack = true, ladder = false, l1Severity = 5, extraFailures = [], overrides = {}, extra = {}, critics = null, runExtra = {} } = {}) {
  const signoff = () => JSON.stringify({ meets: true, criteria: [{ criterion: CRITERION, verdict: 'MET', evidence: EV }], failures: [], verdict_line: 'ok' });
  const raise = JSON.stringify({ meets: false, criteria: [{ criterion: CRITERION, verdict: 'FAILED', evidence: 'Missing.' }], failures: [failureOf(l1Severity), ...extraFailures], verdict_line: 'no' });
  const replies = label => overrides[label] ?? (label === 'panel-1-la' ? raise : undefined);
  const hashes = new Map(); const prompts = new Map(); const served = [];
  setPromptSpy(p => { hashes.set(p.label, promptHashOf(p.system, p.user)); prompts.set(p.label, { system: p.system, user: p.user, cacheHead: p.cacheHead }); });
  setCache({ invalidate: () => {}, get(label) { served.push(label); const text = label.startsWith('panel-') ? (replies(label) ?? signoff()) : label.startsWith('revise-') ? `${DRAFT}\n\nRevision ${label.slice(7)}.` : DRAFT; return { text, provider: 'mock', model: 'm', usage: { input: 0, output: 0 }, usd: 0, promptHash: hashes.get(label) }; } });
  const seat = ([lab, layer]) => ({ provider: 'mock', model: 'mock-review-fixture', lab, maxTokens: 3000, layer });
  const config = { name: 'fixture-l2', criteria: [CRITERION], maxRounds: 4, maxOverseerRounds: 3, layerRevisions: { 1: 7, 2: 5 }, signoff: 'unanimous', ...(answerBack ? { answer_back: { enabled: true } } : {}), ...(severity ? { severity: { enabled: true } } : {}),
    seats: { builder: seat(['writer']), reviser: seat(['writer']), critics: (critics ?? [['la', 1], ['lb', 2], ['lc', 3]]).map(seat) }, ...extra };
  try {
    const result = await runChain({ request: 'Write a worker plan with a retry limit.', runId: 'r-l2', log: () => {}, config, ...(ladder ? { ladder: { block: 3, visits: 3, credit: 0, exchange: 0 } } : {}), ...runExtra });
    return { result, prompts, served };
  } finally { setPromptSpy(null); setCache(null); setBudget(null); }
}
