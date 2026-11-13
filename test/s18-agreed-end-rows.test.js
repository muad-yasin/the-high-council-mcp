// 0.8.4 S18 (Q7, ruled by C&C as F6: derived from existing records, no new field; T21s, T21bc, T21t, T21ak): the agreed-end halves carried from S17. At an AGREED ending the dispute stage does not run, so nothing marks dispute.open_objections; the build list (HANDOFF.md) reads what the top layer's closing words did to the
// objections still standing from the failures, the ruling's own predicate and final_read's sorting: "Closed below 4" lists those rated below 4 (never 7 or above) that every top-layer seat sorted may-leave (T21s, T21bc: closed, kept on the record, not required of the build); "Open objections the top layer sorted may-leave" lists those it
// sorted may-leave that the sorting does NOT close (rated 4 or above, or once rated 7 or above) with the sorting's reasons (T21t) and, where one was re-tagged, the re-tag (T21ak: shown as re-tagged and still open). Offline, mock seats, $0; the check's words, the rating/sorting words are HELD and injected. Fixture: the T17ag fixture of
// test/helpers/s8-handler-rows.js (itself C3-23), COPIED, with a block Wo rated 8.0 that the handler re-tags to 3.0 at pass 3 and layer 3 sorts may-leave, and a handoff seat. Written without a run (no tests on the laptop). The reds are the parent commit (no section) and a swapped-input variant (S18_SWAPS.json).
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { runChain, setPromptSpy, setCache, setBudget, ExternalPause } from '../src/chain.js';
import { setHeldForTest } from '../src/held-roles.js';
import { objectionId } from '../src/objection-ids.js';
import { combineSortings } from '../src/sorting.js';
import { DEMAND, SORTING } from './helpers/rating-demand.js';
import { CHECK, answer } from './helpers/build-check.js';
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

// rateZ: the rating of the block layer 3 sorts may-leave that the ruling closes when it is below 4
async function run({ rateZ }) {
  const Xo = { criterion: CRITERION, problem: 'No limit on retries.', quote: 'retries failed requests', fix: 'State a limit.', severity: 5 };
  const Yo = { criterion: CRITERION, problem: 'No owner is named.', quote: 'The worker', fix: 'Name an owner.', severity: 5 };
  const Zo = { criterion: CRITERION, problem: 'The wording is loose.', quote: 'failed requests', fix: 'Tighten it.', severity: rateZ };
  const Wo = { criterion: CRITERION, problem: 'The retry pause is not stated.', quote: 'retries', fix: 'State the pause.', severity: 8 };
  const idX = objectionId('raiser', Xo); const idYo = objectionId('raiser', Yo); const idZ = objectionId('raiser', Zo); const idWo = objectionId('raiser', Wo);
  try {
    setHeldForTest({ ...HESC_INJECT, ...DEMAND, ...SORTING, relationRule: HB084.relationRule, dissentRecordSection: () => '', ...CHECK });   // the dissent words are a stub: only the RECORD is under test (Yo is a sorting-source dissent as well as an open may-leave objection)
    const rel = (f, relation) => ({ ...f, relation });
    const topSorted = meets({ sorting: [{ id: idZ, sort: 'may_leave', reason: 'Loose wording only.' }, { id: idX, sort: 'must_do', reason: 'The limit is missing.', criterion: CRITERION }, { id: idYo, sort: 'may_leave', reason: 'Minor for the build.' }, { id: idWo, sort: 'may_leave', reason: 'The pause can be chosen in the build.' }] });
    const script = { 'panel-1-raiser': objects(rel(Xo, 'new'), rel(Zo, 'new')), 'panel-2-raiser': objects(rel(Xo, `continues ${idX}`), rel(Yo, 'new'), rel(Zo, `continues ${idZ}`), rel(Wo, 'new')), 'rule-3-mid': JSON.stringify({ rulings: [{ id: idX, ruling: 'overrule', reason: 'Section two sets the limit.' }] }), 'panel-3-top': topSorted };
    const writer = { provider: 'external', model: 'claude-code-session', lab: 'handler' };
    const config = { name: 'fixture-s18-agreed', criteria: [CRITERION], signoff: 'unanimous', answer_back: { enabled: true }, dispute: { enabled: true, stall_rounds: 2 }, maxRounds: 4, handoff: true,
      seats: { handoff: { provider: 'mock', model: 'mock-handoff' }, builder: writer, reviser: writer, critics: [['raiser', 1], ['mid', 2], ['top', 3]].map(seatOf) } };
    const make = (extra, retags) => {
      setCache({ invalidate() {}, get(label) {
        const all = { ...script, ...extra };
        if (label in all) return OK(all[label]);
        if (label.startsWith('build-check-')) return null;
        return OK(label.startsWith('panel-') ? meets() : label.startsWith('revise-') ? `${DRAFT}\n\nRevision ${label.slice(7)}.` : DRAFT);
      } });
      return runChain({ request: 'Write a worker plan with a retry limit.', runId: 'r-s18-agreed', log: () => {}, config, ...(retags ? { retags } : {}) });
    };
    const retags = [{ pass: 3, id: idWo, severity: 3, reason: 'A missing pause does not change what is built.' }];
    const ask = await make({}, retags).then(() => null, e => e);
    const second = await make({ 'build-check-1': answer('good_to_build', `${idX}, ${idYo} and ${idWo}: the build can leave the last two, section two covers them.`) }, retags).then(result => ({ result }), error => ({ error }));
    return { ask, second, idX, idYo, idZ, idWo };
  } finally { setCache(null); setPromptSpy(null); setBudget(null); setHeldForTest(null); }
}

test('T21s, T21bc, T21t, T21ak (agreed end): the build list carries "Closed below 4" for the block rated 3.0 that layer 3 sorted may-leave, and the open objections it sorted may-leave with the sorting\'s reasons, the one re-tagged from 8.0 to 3.0 shown as re-tagged and still open', async () => {
  const RATE_Z = 3;
  const d = await run({ rateZ: RATE_Z });
  assert.ok(d.ask instanceof ExternalPause && d.ask.label === 'build-check-1', `premise: the run waits at the build check (${String(d.ask)})`);
  assert.equal(d.second.error, undefined, `premise: the handler's good_to_build ends the run (${String(d.second.error)})`);
  assert.equal(d.second.result.ending?.kind, 'agreed', 'premise: an agreed ending (the dispute stage did not run)');
  assert.equal(d.second.result.dispute?.ran, false, 'premise: the dispute stage is skipped at an agreed ending');
  const h = d.second.result.handoff;
  assert.equal(typeof h, 'string', 'premise: a build list was written');
  assert.match(h, new RegExp(`## Closed below 4\\n\\nLayer 3 read the final plan and sorted each of these may-leave\\.[^\\n]*\\n\\n- ${d.idZ} \\(raised by raiser\\): The wording is loose\\. Layer 3's reason: top: Loose wording only\\.`), 'T21s, T21bc: the block rated 3.0 is listed as closed below 4 with layer 3\'s reason (kept on the record: it is in severity.swept)');
  assert.match(h, new RegExp(`## Open objections the top layer sorted may-leave\\n\\nLayer 3 read the final plan and sorted each of these may-leave\\.[^\\n]*\\n\\n- ${d.idYo} \\(raised by raiser; rated 5\\.0\\): No owner is named\\. Layer 3's reason: top: Minor for the build\\.`), 'T21t: the open objection rated 5.0 is listed with the sorting and its reasons');
  assert.match(h, new RegExp(`- ${d.idWo} \\(raised by raiser; rated 3\\.0; re-tagged from 8\\.0 to 3\\.0 by the handler in pass 3\\): The retry pause is not stated\\. Layer 3's reason: top: The pause can be chosen in the build\\.`), 'T21ak: the objection re-tagged from 8.0 to 3.0 is shown as re-tagged and still open');
  assert.equal(h.includes(`- ${d.idZ} (raised by raiser; rated`), false, 'the closed block is not in the open list');
  const closedSection = /## Closed below 4\n[\s\S]*?(?=\n## |$)/.exec(h)?.[0] ?? '';
  assert.deepEqual([...closedSection.matchAll(/^- (O-[0-9a-f]{8}(?:#r?\d+)?) /gm)].map(m => m[1]).sort(), (d.second.result.severityRun?.swept || []).map(x => x.id).sort(), 'the ids "Closed below 4" lists are the ids of severity.swept (the pin of the source change: standing failures, same data and predicate)');
  assert.ok((d.second.result.dissents || []).some(x => x.id === d.idYo), 'premise: Yo is also a sorting-source dissent');
  assert.equal(h.split(d.idYo).length - 1, 1, 'one id, one line: the agreed-end build list names the objection that is both an open may-leave one and a dissent once');
  // NAMED PIN (C&C's ruling on T21w, T21ag, T21bd, "matching values"; green on any tree whose climb and final read agree; FAIL CONDITION: for this one input, layer 3's own sorting rows combined by combineSortings (the final read's combiner) give a different sort, seat or reason than the line the climb's combiner (chain.js climbSortOf) put on the build list): the agreed end REUSES the climb's sorting, and the two combiners give equal values for it.
  const topRows = (d.second.result.panelVerdicts || []).filter(r => r.layer === 3 && Array.isArray(r.sorting) && r.sorting.some(x => x.id === d.idZ) && !r.carried && !r.cut).sort((a, b) => a.round - b.round);
  assert.ok(topRows.length >= 1, 'premise: the record holds layer 3\'s climb verdict with the sorting rows that name the objections of this fixture');
  const mine = combineSortings([{ seat: topRows.at(-1).lab, rows: topRows.at(-1).sorting }], [topRows.at(-1).lab]);
  for (const [id, why] of [[d.idZ, 'Loose wording only.'], [d.idYo, 'Minor for the build.'], [d.idWo, 'The pause can be chosen in the build.']]) {
    const c = mine.find(x => x.id === id);
    assert.deepEqual([c?.sort, (c?.reasons || []).map(x => [x.seat, x.reason])], ['may_leave', [['top', why]]], `NAMED PIN: combineSortings gives may_leave with the seat's own reason for ${id}`);
    assert.ok(h.includes(`${id} (raised by raiser`) && h.includes(`Layer 3's reason: ${c.reasons.map(x => `${x.seat}: ${x.reason}`).join('; ')}`), `NAMED PIN: the build list shows the same sort and reason for ${id} as the final read's combiner gives`);
  }
});
