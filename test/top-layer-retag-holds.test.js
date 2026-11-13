// 0.8.4 (Muad 11 Nov 2026, "2:a"): the TOP LAYER's own lowering of an objection below 4 holds like the handling session's. When layer 3 re-tags an objection below 4, the judge it lowered may
// answer on it again (restate it with `continues`, stay quiet, or sustain it by answer without restating) and is HEARD: no continues_not_standing refusal, no re-ask, no solo, no silent-judge stop;
// the objection is in force at layer 3's rating and holds no layer's sign-off; what the judge wrote stays in the stage files.
// Offline, mock seats, $0, in the RECORDED state (no held override: a probe on the tip ran the rig under five held maps and got the same ends). The rig is the shape of the seven planning chains (ladder 3/3, layer 1 = 3 judges, layer 2 = 3, layer 3 = 2, answer_back and dispute as shipped, no layer bounds): a layer-2 judge
// raises Y at its first ask and keeps it every ask; layer 3's first verdict objects with its own concern and, in the RETAG variant, also re-tags Y to 3; later layer-3 asks sign clean. The HANDLER variant lowers Y
// through the handling session's `retags` at pass 4 (the path built for the handler: the reference for what "heard" ends in on the same rig). The real `council retag-add` verb is pinned by
// severity-handler-retag.test.js (C1, R-b); here the handler's act enters runChain as the CLI hands it over (`retags`).
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { runChain, setPromptSpy, setCache, setBudget, ExternalPause } from '../src/chain.js';
import { objectionId } from '../src/objection-ids.js';
import { reportJsonShape } from '../src/report-shape.js';
import { addHandlerRetag, handlerRetagsOf } from '../src/handler-retags.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CRITERION as LCRIT } from './helpers/layer-two-run.js';

afterEach(() => { setPromptSpy(null); setCache(null); setBudget(null); });
const hit = text => ({ text, provider: 'mock', model: 'm', usage: { input: 0, output: 0 }, usd: 0 });
const Y = { criterion: LCRIT, problem: 'No owner is named.', relation: 'new' }; const idY = objectionId('mid-beta', Y);
const L3F = { criterion: LCRIT, problem: 'Layer three has its own concern.', quote: 'The worker', severity: 5, relation: 'new' }; const idL3 = objectionId('top-gamma', L3F);
// The evidence a withdrawal must carry: a passage the plan really contains (a withdrawal whose evidence the plan does not carry is refused, the objection stays standing and layer 3 stalls on it at passes 4, 8, 12: a first box run of this file with other words stopped every variant at `stall_stop`).
const FOUND = 'It reads "The worker retries failed requests."';
const verdictOf = (failures, extra = {}) => JSON.stringify({ meets: false, criteria: [{ criterion: LCRIT, verdict: 'FAILED', evidence: 'Missing.' }], failures, verdict_line: 'no', ...extra });
const meetsOf = extra => JSON.stringify({ meets: true, criteria: [{ criterion: LCRIT, verdict: 'MET', evidence: 'Section two sets it.' }], failures: [], verdict_line: 'ok', ...extra });
const seat = (lab, layer) => ({ provider: 'mock', model: 'mock-review-fixture', lab, maxTokens: 3000, layer });
const builder = { provider: 'mock', model: 'mock-builder', lab: 'writer' };
const config = { name: 'top-layer-retag', criteria: [LCRIT], signoff: 'unanimous', answer_back: { enabled: true }, dispute: { enabled: true, stall_rounds: 3 }, ladder: { block: 3, visits: 3 }, draft_end_marker: { enabled: true }, prompt_cache: { enabled: true, ttl: '5m' },
  seats: { builder, reviser: builder, critics: [seat('l1a', 1), seat('l1b', 1), seat('l1c', 1), seat('mid-beta', 2), seat('l2b', 2), seat('l2c', 2), seat('top-gamma', 3), seat('l3b', 3)] } };

// One run (or two, when `resume`: the first pauses at an external stop right after the lowering is on the record, the second replays the saved stages and goes on).
// variant: CONTROL (no lowering), RETAG (layer 3 lowers Y to 3 at its first verdict), HANDLER (the handling session lowers Y to 3 at pass 4).
// behaviour of the lowered judge after the lowering: REPEATS restates Y with `continues`, QUIET signs clean and never mentions it, SUSTAINS signs and answers the listed id `sustained` without restating; DIFFERENT (TL-5 only) restates Y at ANOTHER rating of its own (the rating plus one).
async function drive(variant, rating, behaviour, resume = false) {
  const store = new Map(); let midAsks = 0, topAsks = 0, armed = false, armedPass = null, paused = null, pauseOn = resume;
  const filler = label => label.startsWith('panel-') || label.startsWith('final-read-') ? meetsOf() : label.startsWith('revise-') ? `The worker retries failed requests.\n\nRevision ${label.slice(7)}.` : 'The worker retries failed requests.';
  const fresh = label => {
    if (/^panel-\d+-mid-beta(-reask\d+|-solo)?$/.test(label)) {
      midAsks += 1; if (midAsks === 1) return hit(verdictOf([{ ...Y, severity: rating }]));
      const sustained = { id: idY, status: 'sustained', evidence: 'Still no owner is named.' };
      return hit(behaviour === 'QUIET' ? meetsOf() : behaviour === 'SUSTAINS' ? meetsOf({ answers: [sustained] }) : verdictOf([{ ...Y, relation: `continues ${idY}`, severity: behaviour === 'DIFFERENT' ? rating + 1 : rating }], { answers: [sustained] }));
    }
    if (/^panel-\d+-top-gamma$/.test(label)) {
      topAsks += 1; if (topAsks === 1 && variant === 'RETAG') { armed = true; armedPass = Number(/^panel-(\d+)-top-gamma$/.exec(label)[1]); }   // the pass layer 3's re-tag is made in: it is applied when THAT pass settles, so the pause must fall in a LATER pass
      return hit(topAsks === 1 ? verdictOf([L3F], variant === 'RETAG' ? { retags: [{ id: idY, severity: 3, reason: 'The seat\'s reason: section two names the owner.' }] } : {}) : meetsOf({ answers: [{ id: idL3, status: 'withdrawn', evidence: FOUND }] }));
    }
    if (/^rule-\d+-/.test(label)) return hit(JSON.stringify({ rulings: [{ id: idY, ruling: 'overrule', reason: 'Section two names the owner.' }] }));
    return hit(filler(label));
  };
  const cache = { invalidate() {}, get(label) {
    if (store.has(label)) return store.get(label);
    const m = /^(?:panel|ldebate|lreply)-(\d+)/.exec(label);
    if (pauseOn && !paused && m && ((variant === 'HANDLER' && Number(m[1]) >= 4) || (variant === 'RETAG' && armed && Number(m[1]) > armedPass))) { paused = label; throw new ExternalPause(label, 'pause for the resume row', 'pause for the resume row', 'test'); }
    const r = fresh(label); store.set(label, r); return r; } };
  // the handler's act is written by the real verb's writer (src/handler-retags.js addHandlerRetag, what `council retag-add` calls) into a run folder and read back by the real reader (handlerRetagsOf, what src/cli.js reads at a resume): not a hand-built array. The CLI hand-over itself (cli.js:3410 passes the read array to runChain) is not driven here.
  let retagArg = {};
  if (variant === 'HANDLER') {
    const dir = mkdtempSync(join(tmpdir(), 'tl-retag-'));
    try {
      const made = addHandlerRetag(dir, { pass: 4, id: idY, severity: 3, reason: 'It does not change what is built.' });
      assert.equal(made.ok, true, JSON.stringify(made));
      const read = handlerRetagsOf(dir); assert.equal(read.ok, true); assert.deepEqual(read.unreadable, []);
      retagArg = { retags: read.retags };
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }
  const once = async tag => {
    const labels = []; const logs = []; let calls = 0;
    setBudget(null); setCache(cache);
    setPromptSpy(p => { labels.push(p.label); calls += 1; if (calls > 700) throw Object.assign(new Error('bound: 700 calls'), { controlFlow: true }); });
    let result = null, err = null;
    try { result = await runChain({ request: 'Write a worker plan with a retry limit.', runId: `r-tl-${variant}-${rating}-${behaviour}-${tag}`, log: l => logs.push(String(l)), config, ...retagArg }); } catch (e) { err = e; }
    setPromptSpy(null); setCache(null);
    const highestPass = Math.max(0, ...labels.map(l => Number(/^(?:panel|ldebate|lreply)-(\d+)/.exec(l)?.[1] ?? 0)));
    return { result, err, labels, logs, calls, highestPass };
  };
  const first = await once('first');
  if (!resume) return { ...first, paused: null };
  pauseOn = false;
  const second = await once('resumed');
  return { ...second, paused, armedPass, first };
}
const refused = r => r.logs.some(l => /continues_not_standing|not standing/i.test(l)) || r.labels.some(l => /-solo$/.test(l));

for (const rating of [5, 8]) {
  test(`TL-1 (rating ${rating}): without a lowering the lowered-judge rig does not end agreed (the control: the lowering is what changes the end)`, async () => {
    const c = await drive('CONTROL', rating, 'REPEATS');
    assert.equal(c.err, null, String(c.err?.message ?? ''));
    assert.notEqual(c.result?.passed, true, `control ended agreed at pass ${c.highestPass}`);
  });
  for (const behaviour of ['REPEATS', 'QUIET', 'SUSTAINS']) {
    test(`TL-2 (rating ${rating}, ${behaviour}): layer 3 lowers Y to 3, the judge answers on it again: it is heard (no refusal, no solo), holds no layer, and the run ends where the handler's lowering ends on the same rig`, async () => {
      const handler = await drive('HANDLER', rating, behaviour);
      assert.equal(handler.err, null, `the reference (handler) run: ${String(handler.err?.message ?? '')}`);
      assert.equal(handler.result?.passed, true, 'the reference: the handler\'s lowering ends agreed');
      const top = await drive('RETAG', rating, behaviour);
      assert.equal(top.err, null, `layer 3's lowering, ${behaviour}: ${String(top.err?.message ?? '')}`);
      assert.equal(refused(top), false, `no continues_not_standing refusal and no -solo ask: ${top.logs.filter(l => /not standing/i.test(l)).slice(0, 2).join(' | ')} ${top.labels.filter(l => /-solo$/.test(l)).join(',')}`);
      assert.equal(top.result?.passed, true, `the run ends agreed (the handler's does); highest pass ${top.highestPass}`);
      assert.equal(top.highestPass, handler.highestPass, 'it ends at the pass the handler\'s lowering ends at');
    });
  }
  for (const variant of ['RETAG', 'HANDLER']) {
    test(`TL-3 (rating ${rating}, ${variant}, resume): a run that pauses after the lowering and is resumed still hears the judge's repeat (the source of a re-tag is not a record field: it is derived again from the replay)`, async () => {
      const r = await drive(variant, rating, 'REPEATS', true);
      assert.notEqual(r.paused, null, 'the first run paused after the lowering');
      const pausedPass = Number(/^(?:panel|ldebate|lreply)-(\d+)/.exec(r.paused)[1]);
      assert.ok(variant === 'HANDLER' ? pausedPass >= 4 : pausedPass > r.armedPass, `premise: the pause (${r.paused}) falls AFTER the lowering took effect (re-tag pass ${r.armedPass ?? 'n/a'}, handler pass 4), not before it`);
      assert.equal(r.err, null, String(r.err?.message ?? ''));
      assert.equal(refused(r), false, 'no refusal after the resume');
      assert.equal(r.result?.passed, true, 'the resumed run ends agreed');
    });
  }
}

// 0.8.4 FIX-1 (C&C 11 Nov 2026, Mini-C&C's review of the top-layer unit): a re-tag below 4 (the top layer's or the handling session's) puts a value in force for the raiser's own carried entry. A judge that stays quiet or sustains has given NO rating after that, so report.json
// must show no `severity.overrides` row for it; the lowering stays on record in `severity.retags` under whoever gave it (by, seat, from, to, reason). A judge that gives a different rating of its own after the lowering still gets its row (TL-5). The report is built by the real writer (reportJsonShape).
const reportOf = r => JSON.parse(JSON.stringify(reportJsonShape({ runId: 'r-tl', chain: 'top-layer-retag', task: 't.md', result: r.result, config })));
for (const rating of [5, 8]) {
  for (const variant of ['RETAG', 'HANDLER']) {
    for (const behaviour of ['QUIET', 'SUSTAINS', 'REPEATS']) {
      test(`TL-4 (rating ${rating}, ${variant}, ${behaviour}): the judge gave no new rating after the lowering: no severity.overrides row is made for it, and the lowering is on record in severity.retags under whoever gave it${behaviour === 'REPEATS' ? ' (control, NO RED OF ITS OWN: a restate at its own first rating makes no row today either; it pins what held, green on the code before FIX-1 too)' : ''}`, async () => {
        const r = await drive(variant, rating, behaviour);
        assert.equal(r.err, null, String(r.err?.message ?? ''));
        assert.equal(r.result?.passed, true, 'premise: the run ends agreed, the judge was heard');
        const sev = reportOf(r).severity;
        assert.deepEqual(sev.overrides.rows, [], `no override row: ${JSON.stringify(sev.overrides.rows)}`);
        assert.deepEqual(sev.overrides.by_direction, { downgrade: 0, upgrade: 0 });
        assert.deepEqual(sev.retags.map(t => [t.id, t.from, t.to, t.by]), [[idY, rating, 3, variant === 'RETAG' ? 'layer3' : 'handler']], 'the lowering is recorded once, under the one who gave it');
      });
    }
    test(`TL-5 (rating ${rating}, ${variant}, control): a judge that gives a different rating of its own after the lowering still gets its overrides row (every row: first ${rating}, claimed ${rating + 1}, upgrade; none claims the re-tag's 3)`, async () => {
      const r = await drive(variant, rating, 'DIFFERENT');
      assert.equal(r.err, null, String(r.err?.message ?? ''));
      const sev = reportOf(r).severity;
      // the judge restates at the other rating on every ask after the first (several passes): at least one row, every row is its own claim (first rating, rating plus one, an upgrade), and none carries the re-tag's value (3)
      const rows = sev.overrides.rows.filter(o => o.id === idY);
      // CHANGED ACCEPTED TEST (0.8.4 FIX-1 control, C&C 12 Nov 2026). OLD: at least one idY row, every row its own claim. NEW: also a premise (the judge was asked again in a pass AFTER the re-tag's pass) and a row whose own pass is after the re-tag's pass. WHY: the judge restates at rating+1 on every ask after its first, so an upgrade row from pass 2, before any lowering, satisfied the old asserts on a tree whose commit loop skipped every claim made after the lowering (the box run of that tree was 28/28 green); the new line can only be met by a claim made after the lowering.
      const retag = sev.retags.find(x => x.id === idY);
      assert.ok(retag && Number.isInteger(retag.pass), `premise: the lowering is on record in severity.retags with its pass: ${JSON.stringify(sev.retags)}`);
      assert.ok(r.labels.some(l => Number(/^panel-(\d+)-mid-beta/.exec(l)?.[1] ?? 0) > retag.pass), `premise: the judge was asked again in a pass after the re-tag's pass ${retag.pass} (asks: ${r.labels.filter(l => /mid-beta/.test(l)).join(', ')})`);
      assert.ok(rows.length >= 1, `its own different rating is an override: ${JSON.stringify(sev.overrides.rows)}`);
      assert.ok(rows.every(o => Number.isInteger(o.pass)), `premise: every override row carries its pass: ${JSON.stringify(rows)}`);
      assert.ok(rows.some(o => o.pass > retag.pass), `a claim made after the lowering is an override row (re-tag pass ${retag.pass}): ${JSON.stringify(rows)}`);
      assert.ok(rows.every(o => o.lab === 'mid-beta' && o.first === rating && o.claimed === rating + 1 && o.direction === 'upgrade'), JSON.stringify(rows));
    });
  }
}
