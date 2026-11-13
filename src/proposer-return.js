// 0.8.4 S9 + S9a (the proposer return; Q10, D8, D29): a layer-3 objection that is about a DECISION (fixing it would change which option a Decisions entry chooses) ends an overseer round; on a chain with proposer seats that one decision goes back to every
// proposer (a blind alternative, one anonymised post on the others', one answer), and the writer's revise step integrates one alternative or keeps the original with its reasons (W13). On a chain with no proposer seat the same objection takes the route writer
// (S9a): no proposer call, the contested entry in full in the writer's step (W29(ii)).
// This file is PURE except runProposerReturn, which makes its calls through functions the caller hands in (chain.js owns invoke, the stage record, settleAll and the control-flow rule; importing them here would make a cycle). It reads the drafted words only through
// the held-text registry (src/held-roles.js), so nothing is sent until src/roles.js records them. NO RETRY of any call: an unreadable reply is recorded and the return goes on with the readable ones (Q10(c)); control-flow errors are rethrown by the caller's rule.
import { createHash } from 'node:crypto';
import { held } from './held-roles.js';
import { seatKeyOf } from './seat-key.js';
import { decisionEntryOf, choiceQuoteFound, refusalWords } from './decision-entry.js';
export { refusalWords };   // kept as an export of this module for its callers; the ONE copy lives in src/decision-entry.js (an import-free file)

const byCode = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/** The labels of the three calls: kind, overseer round, seat key. One prefix per kind (stage-system.js RULES, stage-contract.js, run-state.js, verdict-stats.js read the prefix). */
export const returnLabelOf = (kind, ovRound, seatKey) => `return-${kind}-${ovRound}-${seatKey}`;

/** One return per overseer round (Q10(a); RU-S9-01). The caller keeps the set of overseer rounds that had theirs; a second return in the same round is refused. */
export const returnSlotFree = (done, ovRound) => !(done instanceof Set ? done.has(ovRound) : false);

// ---- classification (W8): the layer-3 reply marks each objection; the harness checks the mark against the plan's own text
const entryNumberOf = v => (Number.isInteger(v) ? v : typeof v === 'string' && /^\s*(?:decision\s+)?(\d{1,6})\s*$/i.test(v) ? Number(v.match(/(\d{1,6})/)[1]) : null);

/**
 * Reads the decision-level marks of the top layer's verdicts of ONE pass. `verdicts` = [{ lab, failures: [{ id, level, entry, choice, ... }], mostConsequential }] for the top-layer seats that gave a readable verdict (the caller supplies each failure's objection id).
 * A failure is a check-passing decision mark only if it says level 'decision', its `entry` is a whole number naming an entry that exists in `plan`, and its `choice` is that entry's Choice line (src/decision-entry.js). A mark that fails the check is NOT decision-level:
 * it goes to the writer as an ordinary objection and is recorded as refused with the reason (no retry). A reply that names no level at all is wording (the default of W8: "Otherwise it is about wording"), not a refusal.
 * Returns { marks: [{ lab, id, index, failure, number, entry }], refused: [{ lab, id, number, reason }], named: Map(lab -> entry number) }.
 */
export function classifyDecisionObjections({ plan, verdicts }) {
  const marks = []; const refused = []; const named = new Map();
  for (const v of verdicts || []) {
    const failures = Array.isArray(v.failures) ? v.failures : [];
    failures.forEach((f, index) => {
      if (String(f?.level ?? '').trim().toLowerCase() !== 'decision') return;
      const number = entryNumberOf(f.entry);
      const entry = number === null ? { ok: false, reason: 'entry_not_a_number' } : decisionEntryOf(plan, number);
      if (!entry.ok) { refused.push({ lab: v.lab, id: f.id, number, reason: entry.reason }); return; }
      if (!choiceQuoteFound(entry, f.choice)) { refused.push({ lab: v.lab, id: f.id, number, reason: 'choice_not_found' }); return; }
      marks.push({ lab: v.lab, id: f.id, index, failure: f, number, entry });
    });
    const n = entryNumberOf(v.mostConsequential);
    if (n !== null && marks.some(m => m.lab === v.lab && m.number === n)) named.set(v.lab, n);
  }
  return { marks, refused, named };
}

/**
 * The ONE objection that gets the return slot of an overseer round (Q10(a), D8): the entry layer 3 names as most consequential; if the seats name different entries, the one named by more seats, ties to the entry whose first mark comes first in the objection
 * ledger's order (`rankOf(mark)`, the full ledger: first round, lab, id); none named: when ONE seat holds all the marks (the other top-layer seats signed off or raised nothing of this kind) the first mark in THAT reply's order, which is what W8 promises ("the first one you list is taken"); when the marks come from several seats the ledger-first mark. Within the chosen entry the mark is picked the same way.
 * Returns { mark, selected_by: 'named' | 'majority' | 'first_listed' | 'first_recorded' } or null when there is no mark.
 */
export function selectReturnMark({ marks, named, rankOf }) {
  if (!marks?.length) return null;
  const ledgerFirst = list => list.slice().sort((a, b) => { const ra = rankOf(a); const rb = rankOf(b); return ra[0] - rb[0] || byCode(ra[1], rb[1]) || byCode(ra[2], rb[2]); })[0];
  const votes = new Map();
  for (const n of named.values()) votes.set(n, (votes.get(n) ?? 0) + 1);
  if (votes.size) {
    const top = Math.max(...votes.values());
    const entries = [...votes].filter(([, c]) => c === top).map(([n]) => n);
    const number = entries.length === 1 ? entries[0] : ledgerFirst(marks.filter(m => entries.includes(m.number))).number;
    const here = marks.filter(m => m.number === number);
    const namers = [...named].filter(([, n]) => n === number).map(([lab]) => lab);
    const mine = here.filter(m => namers.includes(m.lab));
    return { mark: (namers.length === 1 ? mine.slice().sort((a, b) => a.index - b.index)[0] : ledgerFirst(mine)), selected_by: votes.size === 1 ? 'named' : 'majority' };
  }
  if (new Set(marks.map(m => m.lab)).size === 1) return { mark: marks.slice().sort((a, b) => a.index - b.index)[0], selected_by: 'first_listed' };
  return { mark: ledgerFirst(marks), selected_by: 'first_recorded' };
}

// ---- reading the three replies. Unreadable = no JSON object, or the key missing or empty: recorded, never retried.
const text = (v, cap) => (typeof v === 'string' ? cap(v) : v == null ? '' : cap(JSON.stringify(v)));
export function readAlternative(parsed, cap = s => s) {
  const a = parsed && !Array.isArray(parsed) && typeof parsed === 'object' ? parsed.alternative : null;
  if (!a || Array.isArray(a) || typeof a !== 'object') return null;
  const choice = text(a.choice, cap);
  return choice.trim() ? { choice, trade_offs: text(a.trade_offs, cap), why_original_wins_or_loses: text(a.why_original_wins_or_loses, cap) } : null;
}
const readKey = key => (parsed, cap = s => s) => { const t = parsed && !Array.isArray(parsed) && typeof parsed === 'object' ? text(parsed[key], cap) : ''; return t.trim() ? t : null; };
export const readPost = readKey('post');
export const readAnswer = readKey('answer');

/** A deterministic order for what a reader is shown: by key, or (with the chain's debate_hygiene.shuffle on) by a seeded hash of the run, the overseer round, the call kind, the reader and the item, so a resume replays the same text. */
export function orderedFor(items, { keyOf, reader, kind, ovRound, runId, shuffle }) {
  const seed = it => (shuffle ? createHash('sha256').update(`${runId ?? ''}|return-${ovRound}|${kind}|${reader}|${keyOf(it)}`).digest('hex') : keyOf(it));
  return items.slice().sort((a, b) => byCode(seed(a), seed(b)));
}

const unreadableReason = (parsed, error) => (error ? `no reply (${String(error).slice(0, 100)})` : parsed == null ? 'the reply is not a JSON object' : 'the reply has no usable answer');

/**
 * The return itself: alt (P calls), post (a proposer posts only if at least one OTHER proposer's alternative was readable), answer (a proposer answers only if its OWN alternative was readable and at least one OTHER proposer's post was). 3P calls when everything
 * reads; fewer, never more. No readable alternative: status 'failed' after the first round and the objection goes to the writer as an ordinary one.
 * `deps` = { invoke, record, settleAll, skipChosen, offerSkip, rethrowControlFlow, parseJson, cap(value, seat, field) , log }. `ctx` = { seats, ovRound, number, entryText, choice, objection: { criterion, problem, fix }, request, criteria, skeleton, plan, runId, shuffle }.
 * Returns { status, alternatives: [{ lab, status, reason?, alt? }], posts: [{ lab, status, reason?, text? }], answers: [...], calls, note }. `note` is the writer's integration note (W13), '' when the return failed.
 */
export async function runProposerReturn(ctx, deps) {
  const { seats, ovRound, number, entryText, choice, objection, request, criteria, skeleton, plan, runId, shuffle } = ctx;
  const system = held('proposerReturnSystem')();
  const form = kind => held('proposerReturnReplyForm')(kind);
  const keyOf = seat => seatKeyOf(seat);
  let calls = 0;
  const ask = async (seat, kind, user, read) => {
    const lab = keyOf(seat); const label = returnLabelOf(kind, ovRound, lab); const lines = []; const say = m => lines.push(m);
    let parsed = null; let error = null;
    try {
      deps.skipChosen(seat, [label]);
      const st = deps.record(await deps.invoke(seat, { system, user: `${user}${deps.noticeFor?.(seat, ovRound) ?? ''}\n\n${form(kind)}`, log: say, label, group: `return-${kind}-${ovRound}` }));
      calls += 1;
      parsed = deps.parseJson(st.text);
    } catch (err) {
      deps.offerSkip(err, seat, seats);
      deps.rethrowControlFlow(err);
      error = err.message;
    }
    const value = parsed == null ? null : read(parsed, v => deps.cap(v, seat, `${label}`));
    return { lab, seat, lines, value, reason: value ? null : unreadableReason(parsed, error) };
  };
  const flush = results => { for (const r of results) r.lines.forEach(m => deps.log(m)); };

  deps.log(`\nStage: proposer return (decision ${number}: ${seats.length} proposer(s) each write an alternative, blind)`);
  const altResults = await deps.settleAll(seats.map(seat => ask(seat, 'alt', held('proposerReturnAltUser')({ request, criteria, skeleton, plan, number, entryText, choice, objection }), readAlternative)));
  flush(altResults);
  const alternatives = altResults.map(r => (r.value ? { lab: r.lab, status: 'readable', alt: r.value } : { lab: r.lab, status: 'unreadable', reason: r.reason }));
  const readableAlts = alternatives.filter(a => a.status === 'readable');
  const done = { status: readableAlts.length ? 'ran' : 'failed', alternatives, posts: [], answers: [], note: '' };
  if (!readableAlts.length) { deps.log('  proposer return: no alternative could be read; the objection goes to the writer as an ordinary one.'); return { ...done, calls }; }

  const order = (items, keyFn, reader, kind) => orderedFor(items, { keyOf: keyFn, reader, kind, ovRound, runId, shuffle });
  deps.log(`\nStage: proposer return posts (each proposer reads the others' alternatives, anonymised)`);
  const postResults = await deps.settleAll(seats.flatMap(seat => {
    const me = keyOf(seat); const others = readableAlts.filter(a => a.lab !== me);
    if (!others.length) return [];
    return [ask(seat, 'post', held('proposerReturnPostUser')({ request, criteria, number, entryText, choice, objection, alternatives: order(others, a => a.lab, me, 'post').map(a => a.alt) }), readPost)];
  }));
  flush(postResults);
  const posts = postResults.map(r => (r.value ? { lab: r.lab, status: 'readable', text: r.value } : { lab: r.lab, status: 'unreadable', reason: r.reason }));
  const readablePosts = posts.filter(p => p.status === 'readable');

  deps.log(`\nStage: proposer return answers (each author answers the posts on its alternative)`);
  const answerResults = await deps.settleAll(seats.flatMap(seat => {
    const me = keyOf(seat); const own = readableAlts.find(a => a.lab === me); const theirs = readablePosts.filter(p => p.lab !== me);
    if (!own || !theirs.length) return [];
    return [ask(seat, 'answer', held('proposerReturnAnswerUser')({ request, criteria, number, entryText, choice, objection, own: own.alt, posts: order(theirs, p => p.lab, me, 'answer').map(p => p.text) }), readAnswer)];
  }));
  flush(answerResults);
  const answers = answerResults.map(r => (r.value ? { lab: r.lab, status: 'readable', text: r.value } : { lab: r.lab, status: 'unreadable', reason: r.reason }));

  const shown = items => order(items, x => x.lab, '', 'note');
  const note = held('returnIntegrationNote')({
    number, entryText, objection,
    alternatives: shown(readableAlts).map(a => a.alt), posts: shown(readablePosts).map(p => p.text), answers: shown(answers.filter(a => a.status === 'readable')).map(a => a.text),
  });
  return { ...done, posts, answers, note, calls };
}
