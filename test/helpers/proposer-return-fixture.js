// Shared fixture of the proposer-return rows (test/proposer-return.test.js, test/proposer-return-route.test.js): a three-layer chain with proposers, a plan with a numbered Decisions section, a cache stub that answers every stage by its label, and the helpers around them.
// No import from any *.test.js. Every global the fixture sets (held text, prompt spy, cache, budget) is reset by the test files' afterEach.
import { runChain, setPromptSpy, setCache } from '../../src/chain.js';
import { reportJsonShape } from '../../src/report-shape.js';
import { setHeldForTest } from '../../src/held-roles.js';
import { objectionId } from '../../src/objection-ids.js';
import { normProblem } from '../../src/objection-assign.js';
import * as HS9 from '../held-prompts/held-084-s9.js';

export const S9 = Object.fromEntries(Object.entries(HS9).filter(([, v]) => typeof v === 'function'));
export const CRITERION = 'The plan defines a retry limit.';
export const PLAN = `# Plan

## Decisions

### Decision 1: Storage
- Context: the plan stores orders.
- Options considered: SQLite; Postgres.
- Trade-offs: SQLite is simple; Postgres scales.
- Choice: SQLite for the first release, with a migration path to Postgres.
- Why the others lost: Postgres needs a server the request does not have.
- Consequences: a migration step later.

### Decision 2: Queue
- Context: jobs run in the background.
- Choice: an in-process queue for background jobs.
- Why the others lost: a broker is one more service.
`;
export const meets = () => JSON.stringify({ meets: true, criteria: [{ criterion: CRITERION, verdict: 'MET', evidence: 'Section two sets it.' }], failures: [], verdict_line: 'ok' });
export const objects = (...fs) => JSON.stringify({ meets: false, criteria: [{ criterion: CRITERION, verdict: 'FAILED', evidence: fs[0].problem }], failures: fs, verdict_line: 'no' });
// 0.8.4 wording apply: each failure is a FIRST raise (`relation: 'new'`) rated 5 (the rating demand is recorded on this layered unanimous chain). A test that needs the repeat of one in a later pass uses `repeatTopOf(f)`; one that needs the bare failure (no relation) spreads `{ ...D1, relation: undefined }`.
export const D1 = { criterion: CRITERION, problem: 'Decision 1 picks one store for all data.', fix: 'Pick two.', severity: 5, relation: 'new', level: 'decision', entry: 1, choice: '- Choice: SQLite for the first release, with a migration path to Postgres.' };
export const D2 = { criterion: CRITERION, problem: 'Decision 2 queues in process.', fix: 'Use a broker.', severity: 5, relation: 'new', level: 'decision', entry: 2, choice: 'an in-process queue for background jobs.' };
export const W1 = { criterion: CRITERION, problem: 'The wording of section two is vague.', fix: 'Tighten it.', severity: 5, relation: 'new', level: 'wording' };
/** The same seat's repeat of one of its own failures in a later pass: `continues <its standing id>` (valid only while the id stands). */
export const repeatTopOf = (f, lab = 'top-gamma') => ({ ...f, relation: `continues ${objectionId(lab, f)}` });
export const NAME = { 'prop-0': 'alpha', 'prop-1': 'beta', 'prop-2': 'gamma' };   // what each proposer's text says about itself: never its seat key, so a prompt that shows the text cannot show the seat
export const ALT = k => JSON.stringify({ alternative: { choice: `Two stores (${NAME[k]})`, trade_offs: 'More moving parts', why_original_wins_or_loses: 'The original loses on scale' } });
export const POST = k => JSON.stringify({ post: `Post one by ${NAME[k]}` });
export const ANSWER = k => JSON.stringify({ answer: `Answer one by ${NAME[k]}` });
export const returnLabels = served => served.filter(l => l.startsWith('return-'));
// The top seat keeps its objections open across the writer's revise (answer_back): in pass 2 it must ANSWER each one, here by withdrawing it with a quote of the revised plan, so the run ends signed off instead of re-asking.
export const failuresOf = text => { try { return (JSON.parse(text).failures || []).filter(f => f && typeof f.problem === 'string'); } catch { return []; } };
// 0.8.4 wording apply: D1, D2 and W1 quote nothing, so they share ONE derived key (seat, criterion, no quote): in one reply the first takes the plain id and each later failure of another text takes `#2`, `#3` (src/objection-assign.js, `new` whose key is already used); the same text twice is one objection. The ids a reply's withdrawal must name are computed the same way, in the order the reply lists them. Valid for a seat's FIRST reply only (it ignores ids the seat already holds from earlier passes).
export const idsInReply = (fs, lab = 'top-gamma') => { const count = new Map(); const byText = new Map(); return fs.map(f => { const base = objectionId(lab, f); const text = `${base}\u0000${normProblem(f.problem)}`; if (byText.has(text)) return byText.get(text); const n = (count.get(base) ?? 0) + 1; count.set(base, n); const id = n === 1 ? base : `${base}#${n}`; byText.set(text, id); return id; }); };
export const withdrawAll = fs => JSON.stringify({ meets: true, criteria: [{ criterion: CRITERION, verdict: 'MET', evidence: 'Section two sets it.' }], failures: [], verdict_line: 'ok', answers: idsInReply(fs).map(id => ({ id, status: 'withdrawn', evidence: 'It reads "SQLite for the first release, with a migration path to Postgres."' })) });

export async function run({ proposers = 3, top = [D1], extraTop = null, scripts = {}, held = S9, ov = { rounds: 2, bounds: { 1: 1, 2: 1 } }, roundChoices = [], decisions = true, shuffle = false, proposals = false, topSeats = ['top-gamma'] } = {}) {
  const prompts = new Map(); const served = [];
  setPromptSpy(p => { prompts.set(p.label, p); });
  setHeldForTest(held);
  const script = { 'panel-1-top-gamma': objects(...top), ...(extraTop ?? {}), ...scripts };
  if (!('panel-2-top-gamma' in script)) script['panel-2-top-gamma'] = withdrawAll(failuresOf(script['panel-1-top-gamma']));
  setCache({ invalidate() {}, get(label) {
    served.push(label);
    const hit = (text) => ({ text, provider: 'mock', model: 'm', usage: { input: 0, output: 0 }, usd: 0 });
    if (label in script) return script[label] === null ? null : hit(script[label]);
    if (label.startsWith('return-alt-')) return hit(ALT(label.split('-').slice(3).join('-')));
    if (label.startsWith('return-post-')) return hit(POST(label.split('-').slice(3).join('-')));
    if (label.startsWith('return-answer-')) return hit(ANSWER(label.split('-').slice(3).join('-')));
    if (label === 'skeleton') return hit('SKELETON-MARKER-TEXT');
    if (label.startsWith('propose-')) return hit(JSON.stringify({ proposals: [{ title: 'T', serves: 's', what: 'w', why: 'y', how: 'h', acceptance_test: 'a' }] }));
    if (label === 'build') return hit(PLAN);
    return hit(label.startsWith('panel-') ? meets() : label.startsWith('revise-') ? `${PLAN}\n\nRevision ${label.slice(7)}.` : PLAN);
  } });
  const seat = (lab, layer) => ({ provider: 'mock', model: 'mock-review-fixture', lab, maxTokens: 3000, layer });
  const builder = { provider: 'mock', model: 'mock-builder', lab: 'writer' };
  const config = {
    name: 'fixture-return', criteria: [CRITERION], signoff: 'unanimous', answer_back: { enabled: true }, dispute: { enabled: true, stall_rounds: 9 }, ...(decisions ? { decisions: { enabled: true } } : {}),
    ...(shuffle ? { debate_hygiene: { shuffle: true } } : {}),
    ...(proposals ? { proposals: { parts: 1, maxTokens: 400 } } : {}),
    maxOverseerRounds: ov.rounds, layerRevisions: ov.bounds,
    seats: { builder, reviser: builder, ...(proposers ? { proposers: Array.from({ length: proposers }, (_, i) => ({ provider: 'mock', model: 'mock-proposer', lab: `prop-${i}`, maxTokens: 3000 })) } : {}), critics: [seat('raiser-alpha', 1), seat('mid-beta', 2), ...topSeats.map(l => seat(l, 3))] },
  };
  try {
    const result = await runChain({ request: 'Write a worker plan with a retry limit.', runId: 'r-return', log: () => {}, config, roundChoices });
    return { result, prompts, served, returns: result.proposerReturns ?? [], config, report: JSON.parse(JSON.stringify(reportJsonShape({ runId: 'r-return', chain: 'fixture-return', task: 't.md', result, config }))) };
  } catch (e) { e.served = served; e.prompts = prompts; throw e; }
}

