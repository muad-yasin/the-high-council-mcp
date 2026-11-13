// 0.8.4 S18 (the build check with ratings; FEATURE_SPECS Q15(e), Q15(f), D34, RU-S18-01, RU-S18-08; T15n, T21aa, T21z): the late findings in the handler's check. WHOLE-RUN rows, offline, mock seats, $0. The check's words (W33), the rating/sorting words and the final read's words (W31, W32: the rating of a
// new defect) are HELD and injected with setHeldForTest; as shipped buildCheckLive() is false and none of this is reachable. A defect a layer-3 seat names only in its sorting at its LAST verdict is a late finding (L- id, found 'last_verdict'); at an agreed ending that verdict IS layer 3's last
// read (the final read makes no call there), so the check, asked right after it, lists these findings and demands every one by id, whatever its rating.
// T15n/T21aa fixture: the T17ag fixture of test/helpers/s8-handler-rows.js (itself C3-23 of test/s8-closure.test.js), COPIED, with two defects in layer 3's sorting rated 2.0 and 6.0 (no *.test.js file is imported, no helper is changed). T21z: a three-layer run where everyone signs off in pass 1 and layer 3 names
// one defect rated 9.0. Each row also pins that every id the check demanded is in the text the handler is shown. Written without a run (no tests on the laptop). The reds are the parent commit (no late finding in the check) and swapped-input variants (S18_SWAPS.json): the same block with ONE input changed, every assert line byte-identical.
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { runChain, setPromptSpy, setCache, setBudget, ExternalPause } from '../src/chain.js';
import { setHeldForTest } from '../src/held-roles.js';
import { objectionId } from '../src/objection-ids.js';
import { isAgreed } from '../src/ending.js';
import { reportJsonShape, renderBoardMd } from '../src/report-shape.js';
import { lateFindingKey } from '../src/objection-ids.js';
import { DEMAND, SORTING } from './helpers/rating-demand.js';
import { CHECK, answer } from './helpers/build-check.js';
import { W31 } from './helpers/w31-held.js';
import * as HB084 from './held-prompts/held-084-b.js';
import * as HESC from './held-prompts/held-escalation.js';

afterEach(() => { setCache(null); setPromptSpy(null); setBudget(null); setHeldForTest(null); });

const CRITERION = 'The plan defines a retry limit.';
const DRAFT = 'The worker retries failed requests.';
const OK = text => ({ text, provider: 'mock', model: 'm', usage: { input: 0, output: 0 }, usd: 0 });
const crow = verdict => ({ criterion: CRITERION, verdict, evidence: 'Section two.' });
const meets = (extra = {}) => JSON.stringify({ meets: true, criteria: [crow('MET')], failures: [], verdict_line: 'ok', ...extra });
const objects = (...fs) => JSON.stringify({ meets: false, criteria: [crow('FAILED')], failures: fs, verdict_line: 'no' });
const seatOf = ([lab, layer]) => ({ provider: 'mock', model: 'mock-review-fixture', lab, maxTokens: 3000, layer });
const HESC_INJECT = { escalationRulingSystem: HESC.escalationRulingSystem, escalationRulingUser: HESC.escalationRulingUser, ledgerRulingsSection: HESC.ledgerRulingsSection };
const defect = (reason, rating) => ({ sort: 'must_do', reason, criterion: CRITERION, quote: 'retries failed requests', rating });   // a quote, so the climb keeps it as a new defect
const LOW = defect('No timeout is stated anywhere.', 2);
const HIGH = defect('No owner is named for the retries.', 6);
const lateIdsOf = user => [...String(user).matchAll(/^- (L-[0-9a-f]{8}(?:#\d+)?) \(found by [^;]+; rated ([0-9.]+)/gm)].map(m => ({ id: m[1], rating: Number(m[2]) }));

// reasons: the handler's reply to the check, given the ids of the two objections and of the late findings the check listed
async function runEscalated({ reasons }) {
  const Xo = { criterion: CRITERION, problem: 'No limit on retries.', quote: 'retries failed requests', fix: 'State a limit.', severity: 5 };
  const idX = objectionId('raiser', Xo);
  const prompts = new Map(); const invalidated = [];
  try {
    setHeldForTest({ ...HESC_INJECT, ...DEMAND, ...SORTING, ...W31, relationRule: HB084.relationRule, ...CHECK });
    setPromptSpy(p => { prompts.set(p.label, p); });
    const rel = (f, relation) => ({ ...f, relation });
    const topSigns = meets({ sorting: [{ id: idX, sort: 'must_do', reason: 'The limit is missing.', criterion: CRITERION }, LOW, HIGH] });
    const script = { 'panel-1-raiser': objects(rel(Xo, 'new')), 'panel-2-raiser': objects(rel(Xo, `continues ${idX}`)), 'rule-3-mid': JSON.stringify({ rulings: [{ id: idX, ruling: 'overrule', reason: 'Section two sets the limit.' }] }), 'panel-3-top': topSigns };
    const make = extra => {
      setCache({ invalidate: (l, why, kind) => { invalidated.push([l, why, kind]); }, get(label) {
        const all = { ...script, ...extra };
        if (label in all) return OK(all[label]);
        if (label.startsWith('build-check-')) return null;
        return OK(label.startsWith('panel-') ? meets() : label.startsWith('revise-') ? `${DRAFT}\n\nRevision ${label.slice(7)}.` : DRAFT);
      } });
      const writer = { provider: 'external', model: 'claude-code-session', lab: 'handler' };
      return runChain({ request: 'Write a worker plan with a retry limit.', runId: 'r-s18-late', log: () => {}, config: { name: 'fixture-s18-late', criteria: [CRITERION], signoff: 'unanimous', answer_back: { enabled: true }, dispute: { enabled: true, stall_rounds: 2 }, maxRounds: 4,
        seats: { builder: writer, reviser: writer, critics: [['raiser', 1], ['mid', 2], ['top', 3]].map(seatOf) } } });
    };
    const ask = await make({}).then(() => null, e => e);
    const listed = lateIdsOf(ask?.user);
    const second = await make({ 'build-check-1': answer('good_to_build', reasons({ idX, listed })) }).then(result => ({ result }), error => ({ error }));
    return { ask, askUser: ask?.user || '', listed, idX, second, invalidated };
  } finally { setCache(null); setPromptSpy(null); setBudget(null); setHeldForTest(null); }
}

test('T15n: a good_to_build that names every must-do id but omits one late-finding id, the omitted one rated 2.0, counts as no answer: the answer is set aside and the run waits at the build check (the rule shown is that every late finding is named, whatever its rating)', async () => {
  const NAME_LOW = false;   // whether the handler's reasons also name the late finding rated 2.0
  const d = await runEscalated({ reasons: ({ idX, listed }) => `${idX}: the build can leave it. ${listed.filter(l => NAME_LOW || l.rating >= 4).map(l => `${l.id}: I agree the defect holds.`).join(' ')}` });
  assert.ok(d.ask instanceof ExternalPause && d.ask.label === 'build-check-1', `premise: the first run waits at the build check (${String(d.ask)})`);
  assert.deepEqual(d.listed.map(l => l.rating).sort((a, b) => a - b), [2, 6], `T15n: the check lists both late findings, the one rated 2.0 included (the check text: ${d.askUser.slice(-400)})`);
  assert.ok(d.second.error instanceof ExternalPause && d.second.error.label === 'build-check-1', `T15n: the answer that omits the 2.0 late finding is no answer: the run waits at the build check again (${d.second.error ? String(d.second.error) : 'the run ended: ' + d.second.result?.ending?.kind})`);
  assert.ok(d.invalidated.some(x => x[2] === 'build_check_refused' && x[1].includes(`does not name ${d.listed.find(l => l.rating === 2)?.id}`)), 'T15n: the refusal names the omitted late finding');
});

test('T21aa: two late findings rated 2.0 and 6.0: the check lists the 6.0 first, and an answer that omits the 2.0 counts as no answer', async () => {
  const NAME_LOW = false;   // whether the handler's reasons also name the late finding rated 2.0
  const d = await runEscalated({ reasons: ({ idX, listed }) => `${idX}: the build can leave it. ${listed.filter(l => NAME_LOW || l.rating >= 4).map(l => `${l.id}: I agree the defect holds.`).join(' ')}` });
  assert.ok(d.ask instanceof ExternalPause && d.ask.label === 'build-check-1', `premise: the first run waits at the build check (${String(d.ask)})`);
  assert.deepEqual((d.ask.user.match(/^- O-[0-9a-f]{8}/gm) || []).length >= 1, true, 'premise: the objection is listed as before');
  assert.deepEqual(d.listed.map(l => l.rating), [6, 2], 'T21aa: the check lists the late finding rated 6.0 before the one rated 2.0');
  assert.ok(d.second.error instanceof ExternalPause && d.second.error.label === 'build-check-1', `T21aa: the answer that omits the 2.0 late finding is no answer (${d.second.error ? String(d.second.error) : 'the run ended: ' + d.second.result?.ending?.kind})`);
});

// The statement rows: the fixtures carry the seat's closing words in `verdict_line` of its signing verdict (a full verdict); a top-layer stated pass is never a sign-off (layerState explicit, chain.js:5500), so the pass_reason source has no row.
// T21z: everyone signs off in pass 1; layer 3 names one defect rated RATING in its sorting
async function runSimple({ rating, naming, line = 'ok' }) {
  const prompts = new Map();
  try {
    setHeldForTest({ ...DEMAND, ...SORTING, ...W31, ...CHECK });
    setPromptSpy(p => { prompts.set(p.label, p); });
    const top = meets({ sorting: [defect('A timeout is missing.', rating)], verdict_line: line });
    const make = extra => {
      setCache({ invalidate() {}, get(label) {
        const all = { 'panel-1-top': top, ...extra };
        if (label in all) return OK(all[label]);
        if (label.startsWith('build-check-')) return null;
        return OK(label.startsWith('panel-') ? meets() : DRAFT);
      } });
      const writer = { provider: 'external', model: 'claude-code-session', lab: 'handler' };
      return runChain({ request: 'Write a worker plan with a retry limit.', runId: 'r-s18-late-z', log: () => {}, config: { name: 'fixture-s18-late-z', criteria: [CRITERION], signoff: 'unanimous', answer_back: { enabled: true }, maxRounds: 3,
        seats: { builder: writer, reviser: writer, critics: [['raiser', 1], ['mid', 2], ['top', 3]].map(seatOf) } } });
    };
    const ask = await make({}).then(() => null, e => e);
    const again = await make({}).then(() => null, e => e);   // a resume: the check is rebuilt from the replayed stage files
    const listed = lateIdsOf(ask?.user);
    const second = await make({ 'build-check-1': answer('good_to_build', naming(listed)) }).then(result => ({ result }), error => ({ error }));
    return { ask, again, listed, second };
  } finally { setCache(null); setPromptSpy(null); setBudget(null); setHeldForTest(null); }
}

test('T21z: layer 3 signs off and the only open item is a late finding rated 9.0: the run reaches the handler\'s check and is not held by the late finding, and a good_to_build that names it ends the run agreed', async () => {
  const NAME_IT = true;   // whether the handler's reasons name the late finding
  const d = await runSimple({ rating: 9, naming: listed => (NAME_IT ? listed.map(l => `${l.id}: I agree the defect holds, the build can handle it.`).join(' ') : 'The build can do it.') });
  assert.ok(d.ask instanceof ExternalPause && d.ask.label === 'build-check-1', `premise: layer 3 signed off and the run waits at the build check, not ended by the late finding (${String(d.ask)})`);
  assert.deepEqual(d.listed.map(l => l.rating), [9], 'T21z: the check lists the late finding rated 9.0');
  assert.match(d.ask.user, /# Layer 3's final statement\n\n- top: <critic-claim>ok<\/critic-claim>/, 'T21z: the check carries layer 3\'s final statement: the seat\'s own words from its signing verdict, on this text');
  assert.equal(d.second.error, undefined, `T21z: the good_to_build that names the late finding is accepted (${String(d.second.error)})`);
  assert.deepEqual([d.second.result.ending?.kind, isAgreed(d.second.result)], ['agreed', true], 'T21z: the run ends agreed: the late finding does not hold the ending');
  assert.deepEqual(d.second.result.buildChecks[0].required, d.listed.map(l => l.id), 'T21z: the check demanded exactly the late finding, and every id it demanded is in the text the handler was shown');
});

test('W33 (3), Q15(a) l.541: the check carries each layer-3 seat\'s own closing words from its signing verdict; a seat that wrote none gets "no statement given."', async () => {
  const LINE = 'The plan is sound; the retry limit is stated.';
  const said = await runSimple({ rating: 6, naming: () => '', line: LINE });
  assert.ok(said.ask instanceof ExternalPause && said.ask.label === 'build-check-1', `premise: the run waits at the build check (${String(said.ask)})`);
  assert.equal(said.again?.user, said.ask.user, 'a resumed run\'s check shows exactly the same statement (the replay is the record)');
  assert.match(said.ask.user, new RegExp(`# Layer 3's final statement\\n\\n- top: <critic-claim>${LINE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}</critic-claim>`), 'the seat\'s own words, escaped, in the container');
  const none = await runSimple({ rating: 6, naming: () => '', line: '' });
  assert.ok(none.ask instanceof ExternalPause && none.ask.label === 'build-check-1', `premise: a sign-off with no verdict line still waits at the build check (${String(none.ask)})`);
  assert.match(none.ask.user, /# Layer 3's final statement\n\n- top: no statement given\./, 'a seat that signed off and wrote no verdict line gets the held "no statement given" line');
});

// C&C's L- ruling: a late finding a check demanded stays resolvable. Check 1 demands finding A; the handler answers not_yet; the top seat's next verdict names the same defect in other words (a new id B): check 2 demands B.
async function runReworded() {
  const prompts = new Map();
  try {
    setHeldForTest({ ...DEMAND, ...SORTING, ...W31, ...CHECK });
    setPromptSpy(p => { prompts.set(p.label, p); });
    const script = { 'panel-1-top': meets({ sorting: [defect('No timeout is stated anywhere.', 6)] }), 'panel-2-top': meets({ sorting: [defect('No time limit is given for the retries.', 6)] }) };
    const config = { name: 'fixture-s18-late-r', criteria: [CRITERION], signoff: 'unanimous', answer_back: { enabled: true }, maxRounds: 4, handoff: true,
      seats: { handoff: { provider: 'mock', model: 'mock-handoff' }, builder: { provider: 'external', model: 'claude-code-session', lab: 'handler' }, reviser: { provider: 'external', model: 'claude-code-session', lab: 'handler' }, critics: [['raiser', 1], ['mid', 2], ['top', 3]].map(seatOf) } };
    const make = extra => {
      setCache({ invalidate() {}, get(label) {
        const all = { ...script, ...extra };
        if (label in all) return OK(all[label]);
        if (label.startsWith('build-check-')) return null;
        return OK(label.startsWith('panel-') ? meets() : label.startsWith('revise-') ? `${DRAFT}\n\nRevision ${label.slice(7)}.` : DRAFT);
      } });
      return runChain({ request: 'Write a worker plan with a retry limit.', runId: 'r-s18-late-r', log: () => {}, config });
    };
    const one = await make({}).then(() => null, e => e);
    const A = lateFindingKey('top', { criterion: CRITERION, problem: 'No timeout is stated anywhere.' }).base;   // computed, not read from the check (a tree without late findings in the check then fails at the behaviour, not a premise)
    const notYet = { 'build-check-1': answer('not_yet', `${A}: this must be fixed first.`) };
    const two = await make(notYet).then(() => null, e => e);
    const B = lateFindingKey('top', { criterion: CRITERION, problem: 'No time limit is given for the retries.' }).base;
    const full = { ...notYet, 'build-check-2': answer('good_to_build', `${B}: I agree the defect holds.`) };
    const end = await make(full).then(result => ({ result }), error => ({ error }));
    const again = await make(full).then(result => ({ result }), error => ({ error }));   // a resume: a new run over the same stage files
    return { one, two, A, B, end, again };
  } finally { setCache(null); setPromptSpy(null); setBudget(null); setHeldForTest(null); }
}

test('L- ruling: after a not_yet the seat names the same defect in other words (a new id): the old id stays in late_findings with demanded_in [1] and dropped_after_check, the new id is live, check 1\'s required resolves, and the board shows only the new one; a resumed run rebuilds exactly the same list', async () => {
  const d = await runReworded();
  assert.ok(d.one instanceof ExternalPause && d.one.label === 'build-check-1' && d.A, `premise: the first check lists a late finding (${String(d.one)})`);
  assert.ok(d.two instanceof ExternalPause && d.two.label === 'build-check-2' && d.B, `premise: after the not_yet the second check lists a late finding (${String(d.two)})`);
  assert.notEqual(d.A, d.B, 'premise: the reworded finding has another id');
  assert.equal(d.end.error, undefined, `premise: the run ends (${String(d.end.error)})`);
  const rep = reportJsonShape({ runId: 'r-s18-late-r', chain: 'fixture-s18-late-r', task: 't.md', result: d.end.result, config: null });
  const byId = new Map((rep.late_findings || []).map(l => [l.id, l]));
  assert.deepEqual([byId.get(d.A)?.demanded_in, byId.get(d.A)?.dropped_after_check, byId.get(d.B)?.demanded_in, byId.get(d.B)?.dropped_after_check], [[1], true, [2], undefined], 'the old id is kept as dropped (demanded in check 1), the new id is live (demanded in check 2)');
  assert.ok(rep.build_checks.every(c => c.required.filter(id => id.startsWith('L-')).every(id => byId.has(id))), 'every late id a check demanded resolves inside report.json');
  assert.deepEqual(d.end.result.lateFindings.map(l => l.id), [d.B], 'the carried list (what the sort list, the build list and every count read) holds only the new one');
  assert.equal(typeof d.end.result.handoff, 'string', 'premise: the run wrote a HANDOFF (the build list)');
  assert.ok(d.end.result.handoff.includes(d.B) && !d.end.result.handoff.includes(d.A), 'the build list (HANDOFF) carries only the late finding that is still carried');
  const board = renderBoardMd({ runId: 'r-s18-late-r', result: d.end.result });
  assert.ok(board.includes(d.B) && !board.includes(d.A), 'the board shows only the late finding that is still carried');
  const again = reportJsonShape({ runId: 'r-s18-late-r', chain: 'fixture-s18-late-r', task: 't.md', result: d.again.result, config: null });
  assert.deepEqual(again.late_findings, rep.late_findings, 'a resumed run (new process memory over the same stage files) rebuilds the same list');
});
