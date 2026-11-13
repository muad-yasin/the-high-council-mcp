// 0.8.4 the persona form for ONE run (src/persona-form.js; Muad 11 Nov 2026: "Add a run-time switch too"): the decision, pure and in-process. Offline, $0. WRITTEN WITHOUT A RUN (no tests on the laptop): the box decides; the premise asserts of each row say what it relies on.
// PF-1 the value (bare, not a form) and "nothing typed"; PF-2 a start: the overlay, the record, the other form, the original chain untouched; PF-3 a chain on which it would change nothing is refused (never ignored); PF-4 a resume: the saved form is applied, the same form is accepted,
// the other form is refused naming the form the run uses; PF-5 the lint runs on the overlaid chain (a proposer's role.persona is refused under `voice`, as under a chain file that says `voice`); PF-6 the prompts of a whole run follow the overlay, as relations (the same before and after the apply): typed title = the title chain, typed voice = a chain file that says voice and differs from the title chain; PF-7 the sentences: A-DRAFT constants, each refusal ends with the sentence every start refusal ends with, no em-dash.
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runChain, setCache, setBudget, setPromptSpy } from '../src/chain.js';
import { setHeldForTest } from '../src/held-roles.js';
import { lintJudgePersonas } from '../src/judge-persona.js';
import { estimateChainRows } from '../src/cost.js';
import {
  decidePersonaForm, personaFormLines, chainFileFormOf, PERSONA_FORM_FLAG, PERSONA_FORM_ARGUMENT, PERSONA_FORM_HELP_LINES, PERSONA_FORM_ARGUMENT_DESCRIPTION,
  personaFormNeedsValueSentence, personaFormNotAFormSentence, personaFormNoSwitchSentence, personaFormResumeSentence, personaFormLineSentence, personaFormFlagRefusal, personaFormSideSentence,
} from '../src/persona-form.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const chainFile = name => JSON.parse(readFileSync(join(root, 'chains', `${name}.json`), 'utf8'));
afterEach(() => { setHeldForTest(null); setCache(null); setBudget(null); setPromptSpy(null); });
const NOTHING = 'Nothing was started and nothing was spent.';

const critic = (model, lab, layer, persona) => ({ provider: 'mock', model, lab, layer, ...(persona ? { persona } : {}) });
/** The chain of test/seat-title.test.js fullConfig (two proposers and four judges in two layers with the exchange), copied: names on every seat kind, the switch as given (null = no switch at all). */
function fullConfig(switchCfg) {
  const base = chainFile('mock-debate');
  return {
    ...base, name: 'persona-form-test', maxRounds: 2, signoff: 'unanimous',
    ...(switchCfg ? { seat_personas: switchCfg } : {}),
    seats: { ...base.seats,
      proposers: base.seats.proposers.map((p, i) => ({ ...p, persona: ['Husayn', 'Abraham'][i] })),
      critics: [critic('mock-exch-support-keep', 'e1', 1, 'Moses'), critic('mock-exch-contest-keep', 'e2', 1, 'Noah')] },
  };
}
const TITLE = { enabled: true, form: 'title' };

test('PF-1 the value: a bare flag and a value that is not a form are refused with their own sentence (the flag\'s name and the argument\'s), nothing typed changes nothing', () => {
  const cfg = fullConfig(TITLE);
  const bare = decidePersonaForm(cfg, { typed: true });
  assert.equal(bare.refusal, `--persona-form needs a value: title or voice. ${NOTHING}`);
  const bad = decidePersonaForm(cfg, { typed: 'maybe' });
  assert.equal(bad.refusal, `--persona-form: "maybe" is not a seat form. Use title or voice. ${NOTHING}`);
  const viaArgument = decidePersonaForm(cfg, { typed: 'maybe', source: PERSONA_FORM_ARGUMENT });
  assert.equal(viaArgument.refusal, `the persona_form argument: "maybe" is not a seat form. Use title or voice. ${NOTHING}`);
  for (const r of [bare, bad, viaArgument]) assert.equal(r.config, cfg, 'a refusal hands the chain back unchanged');
  assert.equal(decidePersonaForm(cfg, { typed: 'x'.repeat(200) }).refusal.includes('x'.repeat(41)), false, 'a long value is cut in the sentence');
  const none = decidePersonaForm(cfg, {});
  assert.deepEqual([none.refusal, none.form, none.changed, none.record], [null, null, false, false]);
  assert.equal(none.config, cfg, 'nothing typed: the same chain object');
  assert.deepEqual(personaFormLines(none), []);
});

test('PF-2 a start: the voice form overlays seat_personas.form on a title chain, is recorded and said; the title form on a title chain changes nothing but is recorded; the chain as written is never touched', () => {
  const cfg = fullConfig(TITLE); const before = JSON.stringify(cfg);
  assert.equal(chainFileFormOf(cfg), 'title', 'premise: the chain file says title');
  const v = decidePersonaForm(cfg, { typed: 'voice' });
  assert.equal(v.refusal, null);
  assert.equal(v.config.seat_personas.form, 'voice'); assert.equal(v.config.seat_personas.enabled, true, 'the switch itself is the chain\'s, never turned on here');
  assert.deepEqual([v.form, v.fileForm, v.changed, v.record], ['voice', 'title', true, true]);
  assert.deepEqual(personaFormLines(v), [personaFormLineSentence('voice', 'title')]);
  assert.equal(personaFormLineSentence('voice', 'title'), 'Seat personas: the voice form for this run (the chain file says title).');
  assert.equal(JSON.stringify(cfg), before, 'the chain object that was passed in is not changed');
  assert.notEqual(v.config, cfg);
  const t = decidePersonaForm(cfg, { typed: 'title' });
  assert.equal(t.config, cfg, 'the form the file already names: the same chain object');
  assert.deepEqual([t.form, t.changed, t.record], ['title', false, true]);
  assert.deepEqual(personaFormLines(t), [], 'nothing to say when the form is the chain file\'s own');
  const back = decidePersonaForm(fullConfig({ enabled: true, form: 'voice' }), { typed: 'title' });   // the other direction (a chain whose file says voice, the flagship after the apply): the second value
  assert.equal(back.config.seat_personas.form, 'title'); assert.deepEqual([back.changed, back.record, back.fileForm], [true, true, 'voice']);
  assert.deepEqual(personaFormLines(back), [personaFormLineSentence('title', 'voice')]);
});

test('PF-3 a chain on which the setting would change nothing is refused, never ignored: no switch, a switch that is off, a switch on with no named seat', () => {
  const noPersonas = fullConfig(TITLE); noPersonas.seats.proposers.forEach(p => { delete p.persona; }); noPersonas.seats.critics.forEach(c => { delete c.persona; });
  const cases = [['no switch at all', fullConfig(null)], ['the switch is off', fullConfig({ enabled: false, form: 'title' })], ['no seat carries a persona', noPersonas]];
  for (const [what, cfg] of cases) {
    for (const typed of ['voice', 'title']) {
      const r = decidePersonaForm(cfg, { typed });
      assert.equal(r.refusal, personaFormNoSwitchSentence(PERSONA_FORM_FLAG), `${what} (${typed})`);
      assert.equal(r.config, cfg); assert.equal(r.record, false);
    }
    assert.equal(decidePersonaForm(cfg, {}).refusal, null, `${what}: no setting typed is never refused`);
  }
  assert.equal(personaFormNoSwitchSentence(PERSONA_FORM_FLAG), `--persona-form would change nothing on this chain: it does not switch seat_personas on, or none of its seats has a persona. ${NOTHING}`);
});

test('PF-4 a resume: the saved form is applied again, the same form is accepted and records nothing, the other form is refused before anything is sent and names the form the run uses', () => {
  const cfg = fullConfig(TITLE);
  const kept = decidePersonaForm(cfg, { saved: 'voice', resumed: true });
  assert.equal(kept.refusal, null); assert.equal(kept.config.seat_personas.form, 'voice', 'a plain resume keeps the form the run began with'); assert.deepEqual([kept.changed, kept.record], [true, false]);
  assert.deepEqual(personaFormLines(kept), [personaFormLineSentence('voice', 'title')]);
  const same = decidePersonaForm(cfg, { typed: 'voice', saved: 'voice', resumed: true });
  assert.equal(same.refusal, null); assert.equal(same.config.seat_personas.form, 'voice'); assert.equal(same.record, false, 'the run already has it');
  const other = decidePersonaForm(cfg, { typed: 'title', saved: 'voice', resumed: true });
  assert.equal(other.refusal, personaFormResumeSentence(PERSONA_FORM_FLAG, 'title', 'voice'));
  assert.equal(personaFormResumeSentence(PERSONA_FORM_FLAG, 'title', 'voice'), `--persona-form title: this run uses the voice form, and a run keeps the form it began with, because the stages it already wrote carry that form's text. ${NOTHING}`);
  // a run that began WITHOUT the setting uses the chain file's form: the other form is refused, the same form accepted
  const plainOther = decidePersonaForm(cfg, { typed: 'voice', resumed: true });
  assert.equal(plainOther.refusal, personaFormResumeSentence(PERSONA_FORM_FLAG, 'voice', 'title'));
  const plainSame = decidePersonaForm(cfg, { typed: 'title', resumed: true });
  assert.deepEqual([plainSame.refusal, plainSame.config === cfg, plainSame.record], [null, true, false]);
  // a saved value that is not a form is no record at all; a chain edited since to switch nothing on gets no overlay and no refusal when nothing is typed
  assert.equal(decidePersonaForm(cfg, { saved: 'method', resumed: true }).config, cfg);
  assert.equal(decidePersonaForm(fullConfig(null), { saved: 'voice', resumed: true }).config.seat_personas, undefined, 'the setting never turns the switch on');
  // a start with a stale saved value is a start: nothing is read from `saved`
  assert.equal(decidePersonaForm(cfg, { saved: 'voice', resumed: false }).config, cfg);
});

test('PF-5 the lint runs on the overlaid chain: a proposer\'s role.persona is refused under the voice form (as with a chain file that says voice) and under the title form its own refusal stands', () => {
  const cfg = fullConfig(TITLE);
  cfg.seats.proposers.push({ provider: 'mock', model: 'mock-proposer-b', lab: 'mock-c', role: { persona: 'einstein' } });
  const kinds = c => lintJudgePersonas(c).map(f => f.kind);
  assert.ok(kinds(cfg).includes('seat-persona-voice-under-title'), 'premise: under the file\'s title form the voice route is refused');
  const voice = decidePersonaForm(cfg, { typed: 'voice' }).config;
  assert.ok(kinds(voice).includes('seat-persona-role-under-voice'), 'under the typed voice form the lint says what it says for a file that says voice');
  assert.ok(!kinds(voice).includes('seat-persona-voice-under-title'));
});

async function promptsOf(cfg) {
  const seen = [];
  setPromptSpy(p => seen.push({ label: p.label, system: p.system }));
  await runChain({ request: 'A mock task.', log: () => {}, runId: 'r-persona-form', config: cfg });
  setPromptSpy(null);
  seen.sort((a, b) => (a.label < b.label ? -1 : a.label > b.label ? 1 : a.system < b.system ? -1 : 1));
  return seen;
}

test('PF-6 the prompts of a whole run follow the overlay (relations, so the row reads the same before and after the apply): typing the file\'s own form sends what no flag sends; typing voice sends what a chain file that says voice sends and not what the title chain sends; the judges\' prompts name their own seat under it', async () => {
  const none = await promptsOf(fullConfig(null));
  const fileTitle = await promptsOf(fullConfig(TITLE));
  const fileVoice = await promptsOf(fullConfig({ enabled: true, form: 'voice' }));
  assert.ok(none.length > 10, 'premise: the run sent prompts');
  assert.deepEqual(await promptsOf(decidePersonaForm(fullConfig(TITLE), { typed: 'title' }).config), fileTitle, 'typed title on a title chain: nothing moves');
  const voice = await promptsOf(decidePersonaForm(fullConfig(TITLE), { typed: 'voice' }).config);
  assert.equal(voice.length, fileTitle.length, 'the same calls are made');
  assert.deepEqual(voice, fileVoice, 'typing voice = a chain file that says voice');
  assert.notDeepEqual(voice, fileTitle, 'the voice form changes prompts');
  assert.ok((voice.find(p => p.label === 'panel-1-e1')?.system ?? '').includes('Moses'), 'the judge\'s verdict prompt carries its own name under the voice form');
  assert.equal((none.find(p => p.label === 'panel-1-e1')?.system ?? '').includes('Moses'), false, 'premise: a chain with no switch names nobody');
});

test('PF-6b the flag is refused on every command that is not a start or a resume of a council run (the lists of src/excerpt-approval.js), and only there', () => {
  assert.equal(personaFormFlagRefusal(['--task', 'tasks/x.md', '--chain', 'plan-mini-council', '--persona-form', 'voice']), null, 'a start');
  assert.equal(personaFormFlagRefusal(['--resume', 'runs/x', '--persona-form', 'voice']), null, 'a resume');
  assert.equal(personaFormFlagRefusal(['--task', 'tasks/x.md', '--dry-run']), null, 'no flag, nothing to refuse');
  assert.equal(personaFormFlagRefusal(['handoff', 'runs/x', '--persona-form', 'voice']), personaFormSideSentence('`handoff`'));
  assert.equal(personaFormFlagRefusal(['tree', 'start', '--persona-form', 'voice']), personaFormSideSentence('`tree`'));
  assert.equal(personaFormFlagRefusal(['--rematch', 'runs/x', '--persona-form', 'voice']), personaFormSideSentence('--rematch'));
  assert.equal(personaFormFlagRefusal(['--replay', 'runs/x', '--persona-form', 'voice']), personaFormSideSentence('--replay'));
  assert.equal(personaFormSideSentence('`doctor`'), '--persona-form: it sets the form of a council run you start or resume, so on `doctor` it would change nothing. Nothing was run and nothing was spent.');
});

test('PF-8 the estimate prices the form chosen (GO result 5): with the voice form the judges\' rows carry the recorded voice frame and cost more input than the title form, no row shrinks, and typing the file\'s own form prices as typing nothing', () => {
  const rowsOf = cfg => Object.fromEntries(estimateChainRows(cfg).map(r => [r.label, r.input]));
  const none = rowsOf(fullConfig(TITLE));
  const title = rowsOf(decidePersonaForm(fullConfig(TITLE), { typed: 'title' }).config);
  const voice = rowsOf(decidePersonaForm(fullConfig(TITLE), { typed: 'voice' }).config);
  assert.deepEqual(title, none, 'typing the form the file names prices as typing nothing');
  assert.deepEqual(voice, rowsOf(fullConfig({ enabled: true, form: 'voice' })), 'typing voice prices as a chain file that says voice');
  const grew = Object.keys(none).filter(l => voice[l] > none[l]);
  assert.ok(grew.some(l => l.startsWith('panel-')), `premise: a judge's verdict row grows under the voice form (${grew.join(', ')})`);
  assert.deepEqual(Object.keys(none).filter(l => voice[l] < none[l]), [], 'no row shrinks');
  assert.ok(Object.values(voice).reduce((a, b) => a + b, 0) > Object.values(none).reduce((a, b) => a + b, 0), 'the chain\'s input in all grows');
});

test('PF-7 the sentences: every refusal ends with the start refusals\' own closing sentence, the help block is four lines, no em-dash anywhere, the MCP description names the flag', () => {
  const all = [personaFormNeedsValueSentence(PERSONA_FORM_FLAG), personaFormNotAFormSentence(PERSONA_FORM_FLAG, 'x'), personaFormNoSwitchSentence(PERSONA_FORM_FLAG), personaFormResumeSentence(PERSONA_FORM_FLAG, 'title', 'voice')];
  for (const s of all) assert.ok(s.endsWith(NOTHING), s);
  assert.ok(personaFormSideSentence('--rematch').endsWith('Nothing was run and nothing was spent.'));
  for (const s of [...all, personaFormSideSentence('--rematch'), personaFormLineSentence('voice', 'title'), ...PERSONA_FORM_HELP_LINES, PERSONA_FORM_ARGUMENT_DESCRIPTION]) assert.doesNotMatch(s, /\u2014/, 'no em-dash');
  assert.equal(PERSONA_FORM_HELP_LINES.length, 4);
  assert.match(PERSONA_FORM_ARGUMENT_DESCRIPTION, /--persona-form/);
  assert.match(PERSONA_FORM_HELP_LINES.join('\n'), /--persona-form title\|voice/);
});
