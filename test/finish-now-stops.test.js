// 0.8.4 (the ladder unit, commit 4b; C&C 10 Nov): FINISH AT ONCE AT EVERY STOP, both ways in. ONE table, keyed by the stop kind: each reachable kind is stopped by the real command, then finished once typed (--finish-now) and once relayed (stop_decide, finish_now with
// person_words); both end the run NOT agreed with the same report (stop.finished_at_once, final_read finished_at_once) and the entry says who: typed = actor unknown, channel cli; relayed = actor person, channel session, relayed true. Offline, $0.
// WRITTEN WITHOUT A RUN (no tests on the laptop): the first run on the box decides.
// Kinds the mock fixtures cannot reach through the command, with the reason: layer_bound revisions / unheard / final_read (no command-line fixture makes a silent top layer or a bound-limited layer 1 stop at exit 23 offline; the engine rows are FN-1 and FN-5 of
// test/finish-now.test.js, and both entry points are kind-blind: classifyStop admits layer_bound, and the CLI's marker check admits every round-stop marker). A run with no handling session: nobody is named to choose, the tool refuses with NO_CHOOSER_REFUSAL
// (test/s16-final-read-stop.test.js). The budget stop, the credential pause and the owner pause are other tools (their rows come with their commits).
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stoppedProject, stallProject, untilRunIdle } from './helpers/round-stop-project.js';
import { session } from './helpers/mcp-stdio-session.js';

const projects = [];
afterEach(() => { while (projects.length) projects.pop().done(); });
const make = (maker, tag, opts) => { const p = maker(tag, opts); projects.push(p); return p; };
const call = (p, args) => session(p.dir, [{ name: 'stop_decide', arguments: { run: p.id, ...args } }]).then(a => a[0]);
const reportOf = p => JSON.parse(readFileSync(join(p.runDir, 'report.json'), 'utf8'));
const WORDS = 'Finish it now, please.';

const KINDS = [
  ['overseer_cap below seven', (tag) => make(stoppedProject, tag), 'overseer_cap'],
  ['overseer_cap at seven (the hard stop, a person stop)', (tag) => make(stoppedProject, tag, { rounds: 7 }), 'overseer_cap'],
  ['stall_stop', (tag) => make(stallProject, tag), 'stall_stop'],
];

for (const [name, maker, kind] of KINDS) {
  test(`FS-1 (${name}): typed --finish-now and a relayed finish_now both end the run NOT agreed at once, with the same record; only the entry differs in who gave it`, async () => {
    const typed = maker('fst'); const rel = maker('fsr');
    assert.equal(JSON.parse(readFileSync(join(typed.runDir, 'report-partial.json'), 'utf8')).stop.kind, kind, 'the premise: the stop the command raised');
    typed.run(['--resume', typed.runDir, '--finish-now']);
    const q = await call(rel, { step: 'quote' });
    const r = await call(rel, { step: 'answer', gate: q.gate, shown: q.shown, choice: 'finish_now', person_words: WORDS });
    assert.equal(r.error, undefined, JSON.stringify(r).slice(0, 300));
    await untilRunIdle(rel.runDir);
    for (const p of [typed, rel]) {
      const rep = reportOf(p);
      // MOVED BAR (round-stop finding): the reason was finished_at_once for every kind; where the top layer had already read the current text (a stall) it is every_top_seat_read_this_plan, as for the ordinary end
      assert.deepEqual([rep.passed, rep.stop.kind, rep.stop.chosen, rep.stop.finished_at_once], [false, kind, 'finish', true]);
      // FINDING (not a moved bar: this row is not on the owed list of the ladder unit; 10 Nov 2026, first box run): the pin above was a PREDICTION from reading chain.js (a stall -> every_top_seat_read_this_plan, a cap -> finished_at_once) and the box showed the reverse. The rule (GO, ONE RESULT FOR EVERY FINISH-NOW): the reason follows whether the top layer read the CURRENT text. So the row now pins the reason to a FACT in the record: no text-changing stage after the last panel stage -> every_top_seat_read_this_plan; one (a revise or the dispute rewrite) -> finished_at_once.
      const stages = (rep.stages ?? []).map(s => s.label); const lastPanel = stages.map(l => /^panel-\d+-/.test(l)).lastIndexOf(true);
      const changedAfter = stages.slice(lastPanel + 1).some(l => /^(revise|dispute|challenge-revise|final-edit)/.test(l));
      assert.equal(rep.final_read?.reason, changedAfter ? 'finished_at_once' : 'every_top_seat_read_this_plan', `the reason follows the record: stages after the last panel: ${stages.slice(lastPanel + 1).join(' ')}`);
      assert.equal(changedAfter, kind === 'stall_stop', 'the stall of this fixture changes the text after the top layer read it (the dispute stage), the cap does not');
    }
    const t = typed.runJson().roundChoices[0]; const e = rel.runJson().roundChoices[0];
    assert.deepEqual([t.choice, t.actor, t.channel, t.relayed, t.person_words], ['finish_now', 'unknown', 'cli', undefined, undefined]);
    assert.deepEqual([e.choice, e.actor, e.channel, e.relayed, e.person_words], ['finish_now', 'person', 'session', true, WORDS]);
    assert.equal(reportOf(typed).stop.relayed, undefined, 'the control: a typed finish carries no relay mark');
    assert.equal(reportOf(rel).stop.relayed, true);
  });
}
