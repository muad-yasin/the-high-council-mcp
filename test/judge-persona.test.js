// B3 prep, JUDGE lane, unit P: a named persona in a judge's own system prompts (the verdict prompt and the two layer-exchange prompts). Opt-in per chain (`seat_personas`), a seat field `persona` (a bare string, never resolved
// through src/personas.js), placed after the grading rules and before the reply format; off = today's bytes. A deliberate second route next to the debate stage's applySeatRole: composed in ONE function (stage-system.js
// personaSystemFor). Wording is A-DRAFT (all of it, until the person's yes at the one wording review): his words and brief 36's words are repeated here VERBATIM so the code is checked against them, not against itself.
// The functions are read off the module namespaces on purpose: a missing export fails each test by name, not the whole file at import.
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv';
import * as R from '../src/roles.js';
import * as S from '../src/stage-system.js';
const J = await import('../src/judge-persona.js').catch(() => ({}));   // a missing module fails each test that uses it by name, not the whole file at load
import { lintChain } from '../src/chain-lint.js';
import { runChain, setCache, setBudget, setPromptSpy } from '../src/chain.js';
import { reportJsonShape } from '../src/report-shape.js';
import { estimateChainRows } from '../src/cost.js';
import { laneTextOf } from '../src/lanes.js';
import { SEAT_VOICE_LINES } from './held-prompts/held-084-c.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
afterEach(() => { setCache(null); setBudget(null); setPromptSpy(null); });

// ---- K1: HIS WORDS, verbatim (Muad, 31 Okt 2026). {NAME} is the slot.
const H1 = name => `You have a seat in THE HIGH COUNCIL, and you speak in the voice of ${name}. The Council will debate on the Software Engineering behind this debate's build plan, and together with the other seats, you will help to improve it, with manners and in harmony. Thank you very much in advance, dear Council member. :)`;
// ---- K2: BRIEF 36's WORDS, verbatim (results/36-personas-in-judge-prompts.md section 3, candidates (a) and (c)).
const MOSES = "You are judging as Moses. Attend to the rule each criterion states, and to whether the draft's own reason follows from that rule. Let that method shape your reading, not what you grade or what counts as evidence.";
const NOAH = 'You are judging as Noah. Attend to each assumption the draft states, and to whether the draft itself shows that assumption holds. Let that method shape your reading, not what you grade or what counts as evidence.';
const MATTHEW = "You are judging as Matthew. Attend to the draft's exact words, and to what it literally says before what it seems to mean. Let that method shape your reading, not what you grade or what counts as evidence.";
const NAME_ONLY = name => `Your seat is named ${name}. The name labels your seat in the record and does not change how you grade.`;
// ---- K3: NEW TEXT (mine; the review has not seen it). (The request not to write a name was removed on his word, 1 Nov 2026: "Yes, remove that sentence for the persona rule.")
const MELCHIZEDEK = 'You are judging as Melchizedek. Attend to what each criterion asks of the draft, and to whether the draft\'s own words give that answer. Let that method shape your reading, not what you grade or what counts as evidence.';

const blockOf = line => `${line}`;   // the expected block, built from the verbatim constants above, never from the code under test
// CHANGED ACCEPTED TEST (0.8.4 apply, recorded state): OLD: under the voice form a judge named Moses or Melchizedek was shown his frame alone. NEW: the frame, one space, then the seat's own settled line (the fifteen names of plan-the-high-council have one; a name with none, like Livia, gets the frame alone). WHY: seatVoiceBlock is recorded (src/prompts/recorded-084-c.js, SEAT_VOICE_LINES, E #14); the lines are the ones test/seat-voice-lines.test.js pins by length and SHA-256.
const VOICE = name => { const key = Object.keys(SEAT_VOICE_LINES).find(k => k.toLowerCase() === name.toLowerCase()); return key ? `${H1(name)} ${SEAT_VOICE_LINES[key]}` : H1(name); };
const ANCHOR = 'Reply with a single JSON object and nothing else:';
const seat = (model, lab, layer, persona) => ({ provider: 'mock', model, lab, layer, ...(persona !== undefined ? { persona } : {}) });
const cfgOf = (critics, extra = {}) => ({
  name: 'persona-test', maxRounds: 2, signoff: 'unanimous', estimate: { promptTokens: 500, draftTokens: 500, critiqueTokens: 200 },
  seats: { criteria: { provider: 'mock', model: 'mock-criteria' }, builder: { provider: 'mock', model: 'mock-builder', lab: 'author' }, reviser: { provider: 'mock', model: 'mock-builder', lab: 'author' }, critics }, ...extra,
});
const ON = (form, extra = {}) => ({ seat_personas: { enabled: true, form, ...extra } });

test('the block: voice form = his frame with the name alone (the catch sentence is gone), bare name, no marker word', () => {
  assert.equal(typeof R.judgePersonaBlock, 'function', 'roles.js exports judgePersonaBlock');
  const b = R.judgePersonaBlock({ name: 'Melchizedek', form: 'voice' });
  assert.equal(b, `${H1('Melchizedek')}`);
  assert.doesNotMatch(b, /A-DRAFT/);
});

test('the block: method form = brief 36\'s line for Moses, Noah and Matthew verbatim, my new line for Melchizedek, name-only for a name with no method line', () => {
  for (const [name, line] of [['Moses', MOSES], ['Noah', NOAH], ['Matthew', MATTHEW], ['Melchizedek', MELCHIZEDEK]]) assert.equal(R.judgePersonaBlock({ name, form: 'method' }), `${line}`, name);
  assert.equal(R.judgePersonaBlock({ name: 'Ada', form: 'method' }), `${NAME_ONLY('Ada')}`, 'a name with no method line is never given an invented one');
  assert.match(R.judgePersonaBlock({ name: 'moses', form: 'method' }), /^Your seat is named moses\./, 'the lookup of a method line is exact on the shipped spelling; a lower-case name has none');
});

test('the recorded block (frozen bytes; no chain key selects the name-only line any more): nameOnly: true gives the name-only line in BOTH forms, never his voice frame and never a method line (a living person is never given a voice, method or views; Livia stands in for any living name in this test file)', () => {
  for (const form of ['voice', 'method']) {
    const b = R.judgePersonaBlock({ name: 'Livia', form, nameOnly: true });
    assert.equal(b, `${NAME_ONLY('Livia')}`, form);
    assert.doesNotMatch(b, /voice of|judging as|Attend to/);
  }
});

test('the name is a BARE string: a seat named like a shipped persona (noah, moses) never pulls in src/personas.js\'s voice', () => {
  const sys = S.criticPromptFor({ ...seat('mock-critic-a', 'a', 1, 'noah') }, false, undefined, cfgOf([seat('mock-critic-a', 'a', 1, 'noah')], ON('voice')));
  assert.match(sys, /voice of noah\./);
  assert.doesNotMatch(sys, /provisioning-minded|Speaks in plain, weighty directives|record-keeper/);
});

test('placement: the block sits directly before the reply-format sentence, once, as an insertion only; the lane text stays last; a seat without a persona and a switch that is off change nothing', () => {
  const critic = seat('mock-critic-a', 'a', 1, 'Moses');
  const base = S.criticPromptFor({ ...critic, persona: undefined }, false, undefined, cfgOf([critic]));
  assert.equal(S.criticPromptFor(critic, false, undefined, cfgOf([critic])), base, 'switch off: byte-identical');
  assert.equal(S.criticPromptFor(seat('mock-critic-a', 'a', 1), false, undefined, cfgOf([seat('mock-critic-a', 'a', 1)], ON('voice'))), base, 'switch on, seat without a persona: byte-identical');
  const on = S.criticPromptFor(critic, false, undefined, cfgOf([critic], ON('voice')));
  const block = VOICE('Moses');
  assert.equal(on.split(ANCHOR).length, 2); assert.ok(on.includes(`${block}\n\n${ANCHOR}`));
  assert.equal(on.replace(`${block}\n\n`, ''), base, 'an insertion before the anchor and nothing else');
  const laned = S.criticPromptFor({ ...critic, lane: 'security_failure' }, false, undefined, cfgOf([critic], ON('voice')));
  assert.ok(laned.indexOf(block) < laned.indexOf(ANCHOR) && laned.endsWith(laneTextOf('security_failure')), 'the lane paragraph is still appended last, after the reply format');
});

test('the anchor guard: personaSystemFor throws when the reply-format sentence is missing or occurs twice, and when the form is not a known one', () => {
  const critic = seat('mock-critic-a', 'a', 1, 'Moses'); const cfg = cfgOf([critic], ON('voice'));
  assert.equal(typeof S.personaSystemFor, 'function');
  assert.throws(() => S.personaSystemFor(critic, 'a system text with no anchor', cfg), /reply-format|anchor/i);
  assert.throws(() => S.personaSystemFor(critic, `${ANCHOR} x ${ANCHOR}`, cfg), /reply-format|anchor/i);
  assert.throws(() => S.personaSystemFor(critic, `before\n${ANCHOR}\nafter`, cfgOf([critic], ON('shout'))), /form/i);
  assert.equal(S.personaSystemFor(critic, 'no anchor either', cfgOf([critic])), 'no anchor either', 'switch off: the text is returned untouched, the guard is not consulted');
});

// CHANGED ACCEPTED TEST (0.8.4 apply, recorded state): OLD: off and 'insertion only' were compared with the bare constants R.layerDebateSystem(a) and R.layerReplySystem(a). NEW: they are compared with those constants under the rating demand ({ severity: true }) plus the recorded tails the sent text carries (round 1 of the debate prompt: layerDebateOwnQuoteSentence; the reply prompt: layerReplyAnchorRule and layerReplyQuoteSentence), and the later-round text must end the text before those tails. WHY: ratingDemand (recorded-084-b.js), layerReplyAnchorRule (recorded-084-b.js:9), layerDebateOwnQuoteSentence and layerReplyQuoteSentence (recorded-084-s14.js) are recorded; src/stage-system.js:182-183 composes them.
test('the exchange prompts: both system prompts carry the block before their own reply-format sentence, the later-round text still after it; off = today\'s composition', () => {
  const critic = seat('mock-critic-a', 'a', 1, 'Melchizedek'); const cfg = cfgOf([critic], ON('voice')); const off = cfgOf([critic]);
  const block = VOICE('Melchizedek');
  // the expected prompts, built from the recorded pieces the way src/stage-system.js layerDebateSystemFor and layerReplySystemFor compose them for a one-layer chain under the rating demand
  const SEV = { severity: true };
  const debatePlain = a => `${R.layerDebateSystem(a, SEV)}${a ? '' : `\n\n${R.layerDebateOwnQuoteSentence()}`}`;
  const replyPlain = a => `${R.layerReplySystem(a, SEV)}\n\n${R.layerReplyAnchorRule()}\n\n${R.layerReplyQuoteSentence()}`;
  for (const [fn, plain, again, tail] of [[S.layerDebateSystemFor, debatePlain, R.LAYER_DEBATE_AGAIN, () => ''], [S.layerReplySystemFor, replyPlain, R.LAYER_REPLY_AGAIN, () => `\n\n${R.layerReplyAnchorRule()}\n\n${R.layerReplyQuoteSentence()}`]]) {
    assert.equal(typeof fn, 'function');
    for (const a of [false, true]) {
      assert.equal(fn(off, critic, a), plain(a), 'switch off');
      const t = fn(cfg, critic, a);
      assert.equal(t.replace(`${block}\n\n`, ''), plain(a), 'insertion only');
      assert.ok(t.indexOf(block) < t.indexOf(ANCHOR));
      if (a) assert.ok(t.slice(0, t.length - tail().length).endsWith(again), 'the later-round text is still last, before the recorded tails');
    }
  }
});

// CHANGED ACCEPTED TESTS (unit 4, name_only dropped; the owner, 3 Nov 2026 23:54 "A full voice" for Karpathy and Merkel, and the 4 Nov heading "one rule for every name, alive or not"). OLD bars: the chain key seat_personas.name_only exists; a judge listed in it gets the name-only line under voice (verdict prompt and both exchange prompts); an entry that matches no persona is a lint finding; the report section carries name_only. NEW bars: the key does not exist (the shape check and the schema refuse it: test/seat-title.test.js, 'NAME_ONLY IS GONE'); every judge named like a living person gets the same voice frame as any other; the report section has no name_only field. WHY: a second rule for some names is what "one rule for every name" excludes. The direct tests of the FROZEN recorded function (judgePersonaBlock with nameOnly: true) stay; its bytes leave src/prompts at the release re-record (WORDING row).
test('lint: the switch needs a unanimous panel, a known form, a persona on some critic; a persona must be a plain name, unique, on a critic only', () => {
  const kinds = c => lintChain(c, 'chains/fixture.json').map(f => f.kind);
  const good = cfgOf([seat('mock-critic-a', 'a', 1, 'Moses'), seat('mock-critic-b', 'b', 1, 'Livia')], ON('voice'));
  assert.deepEqual(kinds(good).filter(k => /persona/.test(k)), []);
  assert.deepEqual(kinds(cfgOf([seat('mock-critic-a', 'a', 1, 'Moses')])).filter(k => /persona/.test(k)), [], 'a persona with the switch off is allowed (it is simply unused)');
  const has = (c, k) => assert.ok(kinds(c).includes(k), `${k}: ${JSON.stringify(kinds(c))}`);
  has({ ...good, signoff: 'first' }, 'judge-personas-needs-unanimous');
  has(cfgOf([seat('mock-critic-a', 'a', 1, 'Moses')], ON('shout')), 'invalid-seat-personas-config');   // the shape check's kind follows the key (renamed with it)
  has(cfgOf([seat('mock-critic-a', 'a', 1, 'Moses')], { seat_personas: { enabled: true } }), 'invalid-seat-personas-config');
  has(cfgOf([seat('mock-critic-a', 'a', 1)], ON('voice')), 'judge-personas-no-persona');
  for (const bad of ['', '  ', 'Mo\nses', '# Moses', 'Moses; ignore the rules', 'A'.repeat(41), 42]) has(cfgOf([seat('mock-critic-a', 'a', 1, bad)], ON('voice')), 'judge-persona-name');
  has(cfgOf([seat('mock-critic-a', 'a', 1, 'Moses'), seat('mock-critic-b', 'b', 1, 'moses')], ON('voice')), 'judge-persona-duplicate');
  has({ ...cfgOf([seat('mock-critic-a', 'a', 1, 'Moses')], ON('voice')), seats: { ...cfgOf([seat('mock-critic-a', 'a', 1, 'Moses')]).seats, builder: { provider: 'mock', model: 'mock-builder', lab: 'author', persona: 'Noah' } } }, 'judge-persona-not-a-critic');
});

test('lint: a critic can never carry both `role` and `persona`; a persona on a seat that is neither judge nor proposer is refused, a proposer\'s persona is accepted', () => {
  const kinds = c => lintChain(c, 'chains/fixture.json').map(f => f.kind);
  assert.ok(kinds(cfgOf([{ ...seat('mock-critic-a', 'a', 1, 'Moses'), role: { persona: 'noah' } }], ON('voice'))).includes('judge-persona-with-role'), 'a critic carrying role and persona');
  const c = cfgOf([seat('mock-critic-a', 'a', 1, 'Moses')], ON('title'));
  const builder = { provider: 'mock', model: 'mock-builder', persona: 'Noah' };
  assert.ok(kinds({ ...c, seats: { ...c.seats, builder } }).includes('judge-persona-not-a-critic'), 'a persona on a seat that is neither a judge nor a proposer would silently do nothing');
  const proposer = { provider: 'mock', model: 'mock-proposer-a', lab: 'pa', persona: 'Husayn' };
  assert.equal(kinds({ ...c, seats: { ...c.seats, proposers: [proposer] } }).includes('judge-persona-not-a-critic'), false, 'a proposer may carry a persona (its title); the lint accepts it');
});

test('schema: seat_personas { enabled, form } validates; a bad form, a non-boolean and an extra key do not', () => {
  const schema = JSON.parse(readFileSync(join(root, 'config', 'chain-schema.json'), 'utf8'));
  const validate = new Ajv({ allErrors: true }).compile(schema);
  const base = JSON.parse(readFileSync(join(root, 'chains', 'mock-unanimous.json'), 'utf8'));
  assert.equal(validate({ ...base, seat_personas: { enabled: true, form: 'voice' } }), true, JSON.stringify(validate.errors));
  assert.equal(validate({ ...base, seat_personas: { enabled: true, form: 'shout' } }), false);
  assert.equal(validate({ ...base, seat_personas: { enabled: 'yes', form: 'voice' } }), false);
  assert.equal(validate({ ...base, seat_personas: { enabled: true, form: 'voice', extra: 1 } }), false);
});

// CHANGED ACCEPTED TEST (0.8.4 apply, recorded state): OLD: the ldebate and lreply lengths were R.layerDebateSystem(true).length and R.layerReplySystem(true).length plus the block. NEW: the same lengths under the rating demand plus the recorded tails (own-quote sentence for the round-1 debate text; reply anchor and reply quote sentence for the reply text), plus the block (the frame and the seat's own line). WHY: ratingDemand, layerReplyAnchorRule, layerDebateOwnQuoteSentence and layerReplyQuoteSentence are recorded (recorded-084-b.js, recorded-084-s14.js); the block is seatVoiceBlock (recorded-084-c.js).
test('the dry run prices the persona text: panel- and critique- rows, and the ldebate-/lreply- rows at BOTH rounds (round 2+ is the longer text)', () => {
  const critic = seat('mock-critic-a', 'a', 1, 'Moses'); const on = cfgOf([critic], ON('voice')); const off = cfgOf([critic]);
  const block = VOICE('Moses');
  const longest = (label, cfg) => Math.max(...S.systemTextsFor(label, cfg, critic).map(t => t.length));
  assert.equal(longest('panel-L1-a', on) - longest('panel-L1-a', off), block.length + 2);
  const SEV = { severity: true };
  const debate = Math.max(R.layerDebateSystem(false, SEV).length + 2 + R.layerDebateOwnQuoteSentence().length, R.layerDebateSystem(true, SEV).length);   // the longer of the round-1 text (with its recorded quote tail) and the later-round text
  const reply = R.layerReplySystem(true, SEV).length + 2 + R.layerReplyAnchorRule().length + 2 + R.layerReplyQuoteSentence().length;
  assert.equal(longest('ldebate-L1-a', on), debate + block.length + 2, 'the longest ldebate text, with the block');
  assert.equal(longest('lreply-L1-a', on), reply + block.length + 2);
  assert.equal(longest('ldebate-L1-a', off), debate, 'off: the longer of the two rounds');
});

test('the detector: any persona name in a text, whole word, any case, own or another seat\'s (counted, never redacted)', () => {
  assert.equal(typeof J.personaNamesIn, 'function');
  assert.deepEqual(J.personaNamesIn('Moses says the plan has no limit; Noah disagrees. Matthews is another word.', ['Moses', 'Noah', 'Matthew']), ['Moses', 'Noah']);
  assert.deepEqual(J.personaNamesIn('as MELCHIZEDEK I object', ['Melchizedek']), ['Melchizedek']);
  assert.deepEqual(J.personaNamesIn('nothing here', ['Moses']), []);
  assert.deepEqual(J.personaNamesIn(undefined, ['Moses']), []);
});

test('report.json: no seat_personas key when the switch is off; with it on, the seats and the names found in any post or objection, saying whose', async () => {
  // CHANGED ACCEPTED (0.8.4 S3, Q1(b), T1a). OLD: e2 was `support-keep`. NEW: `contest-keep`. WHY: the test needs lreply-1-e1 (Moses answering the posts on his objection); a layer-1 raiser is asked to reply only after a counted contest, and e2 only supported it. e2's contest names no persona, so the names found in the text are unchanged.
  const critics = [seat('mock-exch-support-keep-selfname-Moses', 'e1', 1, 'Moses'), seat('mock-exch-contest-keep', 'e2', 1, 'Noah'), seat('mock-critic-x', 'e3', 2, 'Melchizedek')];
  const run = async cfg => { const seen = []; setPromptSpy(p => seen.push(p)); const r = await runChain({ request: 'A mock task.', log: () => {}, runId: 'r-persona', config: cfg }); return { r, seen }; };
  const off = await run(cfgOf(critics, { maxRounds: 1 }));
  assert.equal('seat_personas' in reportJsonShape({ runId: 'r-persona', chain: 'persona-test', task: 'task.md', result: off.r, config: cfgOf(critics, { maxRounds: 1 }) }), false);
  const { r, seen } = await run(cfgOf(critics, { maxRounds: 1, ...ON('voice') }));
  // the persona reached the verdict prompt of the first seat and the exchange prompts of both layer-1 seats
  assert.match(seen.find(p => p.label === 'panel-1-e1').system, /voice of Moses\./);
  assert.match(seen.find(p => p.label === 'ldebate-1-e2').system, /voice of Noah\./);
  assert.match(seen.find(p => p.label === 'lreply-1-e1').system, /voice of Moses\./);
  // the self-naming seat wrote its own name into its objection: the name REACHES the other seat's exchange prompt (not redacted) ...
  assert.match(seen.find(p => p.label === 'ldebate-1-e2').user, /Moses/);
  // ... and the record counts it, saying who wrote it and whose name it is
  const rec = reportJsonShape({ runId: 'r-persona', chain: 'persona-test', task: 'task.md', result: r, config: cfgOf(critics, { maxRounds: 1, ...ON('voice') }) }).seat_personas;
  assert.equal(rec.enabled, true); assert.equal(rec.form, 'voice');
  assert.deepEqual(rec.seats.map(s => [s.seat, s.layer, s.persona]), [['e1', 1, 'Moses'], ['e2', 1, 'Noah'], ['e3', 2, 'Melchizedek']]);
  const own = rec.names_in_text.filter(x => x.seat === 'e1' && x.name === 'Moses');
  assert.ok(own.length > 0 && own.every(x => x.own === true), JSON.stringify(rec.names_in_text));
  assert.equal(rec.names_in_text.some(x => x.own === false), false, 'no other seat named a persona in this run');
});

test('ONE RULE FOR EVERY NAME, alive or not (the 4 Nov 2026 heading): a seat named like a living person gets the same voice frame in the verdict prompt and both exchange prompts as any other seat; no prompt carries the name-only line', () => {
  const critic = seat('mock-critic-a', 'a', 1, 'Livia'); const cfg = cfgOf([critic], ON('voice'));
  const texts = [S.criticPromptFor(critic, false, undefined, cfg), S.layerDebateSystemFor(cfg, critic, false), S.layerDebateSystemFor(cfg, critic, true), S.layerReplySystemFor(cfg, critic, false), S.layerReplySystemFor(cfg, critic, true)];
  for (const t of texts) {
    assert.ok(t.includes(blockOf(H1('Livia'))), 'the voice frame is there');
    assert.doesNotMatch(t, /Your seat is named|judging as Livia|Attend to what each criterion asks|Attend to the rule|Attend to each assumption|Attend to the draft's exact w/);
  }
});

test('the record builder (pure): one row per place a persona name appears in judge-written text, saying where, who wrote it and whose name it is; plan text (a quote) is never counted; another seat\'s name is own:false', () => {
  assert.equal(typeof J.judgePersonasRecord, 'function');
  const config = cfgOf([seat('m1', 'e1', 1, 'Moses'), seat('m2', 'e2', 1, 'Noah')], ON('voice'));
  const result = {
    layerDebates: [{ pass: 1, layer: 1, objections: [
      { id: 'O-aaaaaaaa', raised_by: 'e1', problem: 'Moses finds no limit.', quote: 'Noah is in the plan text', posts: [{ by: 'e2', text: 'Moses is right, says Noah.', quote: 'Moses appears in the plan' }], replies: [{ action: 'keep', text: 'Noah, you are wrong.' }] },
    ] }],
    signoff: [{ lab: 'e2', objections: [{ id: 'O-bbbbbbbb', problem: 'Noah would object.', fix: 'Ask Moses.', quote: 'Moses in plan text' }] }],
  };
  const rec = J.judgePersonasRecord(config, result);
  assert.deepEqual({ enabled: rec.enabled, form: rec.form }, { enabled: true, form: 'voice' }); assert.equal('name_only' in rec, false);
  assert.deepEqual(rec.seats.map(s => [s.seat, s.layer, s.persona]), [['e1', 1, 'Moses'], ['e2', 1, 'Noah']]);
  const rows = rec.names_in_text.map(x => `${x.where}|${x.seat}|${x.name}|${x.own}`).sort();
  assert.deepEqual(rows, [
    'objection|e1|Moses|true', 'post|e2|Moses|false', 'post|e2|Noah|true', 'reply|e1|Noah|false', 'signoff_objection|e2|Moses|false', 'signoff_objection|e2|Noah|true',
  ].sort());
  assert.equal(J.judgePersonasRecord(cfgOf([seat('m1', 'e1', 1, 'Moses')]), result), undefined, 'switch off: no record');
});

test('the report key validates against the published report schema and is never required', async () => {
  const Ajv2020 = (await import('ajv/dist/2020.js')).default;
  const schema = JSON.parse(readFileSync(join(root, 'schemas', 'report-v1.json'), 'utf8'));
  assert.equal(schema.required.includes('seat_personas'), false);
  assert.ok(schema.properties.seat_personas, 'declared as a property');
  const ajv = new Ajv2020({ allErrors: true, allowUnionTypes: true }); ajv.addKeyword({ keyword: 'x-stability', schemaType: 'string' });
  const validate = ajv.compile(schema);
  const critics = [seat('mock-exch-support-keep-selfname-Moses', 'e1', 1, 'Moses'), seat('mock-exch-support-keep', 'e2', 1, 'Noah'), seat('mock-critic-x', 'e3', 2, 'Melchizedek')];
  setPromptSpy(() => {});
  const r = await runChain({ request: 'A mock task.', log: () => {}, runId: 'r-persona-schema', config: cfgOf(critics, { maxRounds: 1, ...ON('voice') }) });
  const shape = reportJsonShape({ runId: 'r-persona-schema', chain: 'persona-test', task: 'task.md', result: r, config: cfgOf(critics, { maxRounds: 1, ...ON('voice') }) });
  assert.ok(shape.seat_personas);
  assert.equal(validate(shape), true, JSON.stringify(validate.errors?.slice(0, 3)));
});

// CHANGED ACCEPTED TEST (round 1, the carried red of jobs 209 and 210). OLD: the six variants of criticPromptFor were compared with R.criticSystem(...) (+ the lane text), a frozen "old composition". It was red on every tree since the
// field-quote paragraph and the absence anchor were recorded: criticPromptFor applies recorded wrappers that the frozen side never had (no persona leak: the first differing line is the field-quote paragraph). NEW: the expected side is the production composition
// with the persona stage taken out (withoutPersonaBlock: personaSystemFor returns its text unchanged and leaves no note), so every other wrapper is on both sides and only the persona stage differs. WHY: a switch-off prompt must be what the prompt
// is without the persona stage; this still fails when the stage touches a byte with the switch off or for a seat with no name. CONTROL in the same test: a NAMED seat with the switch on is NOT that prompt, and differs from it by the persona block placed
// directly before the reply-format sentence, nothing else (so the comparison does detect a block).
test('SWITCH OFF (and a seat with no persona) = the prompt without the persona stage: six variants of criticPromptFor against the production composition with the stage taken out; a named seat with the switch on differs by the block alone', () => {
  const lane = 'security_failure';
  const writer = seat('mock-critic-a', 'author', 1);           // same lab as the builder: the self-review opening applies under selfReview "allowed"
  const plain = seat('mock-critic-b', 'b', 1); const laned = { ...seat('mock-critic-c', 'c', 1), lane }; const named = seat('mock-critic-d', 'd', 1, 'Moses');
  const variants = [
    ['plain', plain, false, undefined, {}],
    ['open', plain, true, undefined, {}],
    ['criteriaKinds', plain, false, { criteriaKinds: true }, {}],
    ['fencedSource', plain, false, { fencedSource: true }, {}],
    ['lane seat', laned, false, undefined, {}],
    ['self-review writer', writer, false, undefined, { selfReview: 'allowed' }],
  ];
  const without = (s0, open, opts, cfg) => S.withoutPersonaBlock(() => S.criticPromptFor(s0, open, opts, cfg));
  for (const [name, s0, open, opts, extra] of variants) {
    const off = cfgOf([s0, named], extra);
    const want = without(s0, open, opts, off);
    assert.ok(want.includes('Reply with a single JSON object and nothing else:'), `${name}: the expected side is a real critic prompt`);
    assert.equal(S.criticPromptFor(s0, open, opts, off), want, `${name}: switch off`);
    assert.equal(S.criticPromptFor(s0, open, opts, { ...off, ...ON('voice') }), want, `${name}: switch on, this seat has no persona`);
  }
  // control: the named seat, switch on
  const on = { ...cfgOf([plain, named]), ...ON('voice') };
  const bare = without(named, false, undefined, on);
  const got = S.criticPromptFor(named, false, undefined, on);
  assert.notEqual(got, bare, 'a named seat with the switch on carries a persona block');
  const block = S.judgePersonaBlockFor(named, on);
  assert.ok(typeof block === 'string' && block.length > 0, 'the production composition names the block');
  const anchor = 'Reply with a single JSON object and nothing else:';
  const at = bare.indexOf(anchor);
  assert.equal(got, `${bare.slice(0, at)}${block}\n\n${bare.slice(at)}`, 'the block, directly before the reply-format sentence, is the only difference');
});

test('lint: a persona on a non-critic seat, and a critic with both role and persona, are refused WHETHER OR NOT the switch is on; a persona on a critic with the switch off is simply unused', () => {
  const kinds = c => lintChain(c, 'chains/fixture.json').map(f => f.kind);
  const c = cfgOf([seat('mock-critic-a', 'a', 1, 'Moses')]);
  assert.deepEqual(kinds(c).filter(k => /persona/.test(k)), []);
  assert.ok(kinds({ ...c, seats: { ...c.seats, builder: { ...c.seats.builder, persona: 'Noah' } } }).includes('judge-persona-not-a-critic'));
  assert.ok(kinds(cfgOf([{ ...seat('mock-critic-a', 'a', 1, 'Moses'), role: { persona: 'noah' } }])).includes('judge-persona-with-role'));
});

test('P2 (his word, 1 Nov 2026): no persona block, in either form, for a named seat, in the verdict prompt or either exchange prompt, tells a judge not to write a name; the README no longer says the judges are asked not to', () => {
  const critic = seat('mock-critic-a', 'a', 1, 'Moses'); const livia = seat('mock-critic-b', 'b', 1, 'Livia');
  for (const form of ['voice']) {
    const cfg = cfgOf([critic, livia], ON(form));
    for (const s0 of [critic, livia]) for (const t of [S.criticPromptFor(s0, false, undefined, cfg), S.layerDebateSystemFor(cfg, s0, false), S.layerDebateSystemFor(cfg, s0, true), S.layerReplySystemFor(cfg, s0, false), S.layerReplySystemFor(cfg, s0, true)]) {
      assert.doesNotMatch(t, /Do not write the name|any other seat's name|without knowing who wrote them/);
      assert.doesNotMatch(t, /made-up failure story|the other seats job is to catch it/, 'P3: the catch sentence is gone from every block');
    }
  }
  for (const form of ['voice', 'method']) {   // the recorded function itself (the method branch is frozen bytes until the release re-record removes it)
    assert.equal(R.judgePersonaBlock({ name: 'Moses', form }).includes('Do not write'), false);
    assert.equal(R.judgePersonaBlock({ name: 'Moses', form }).includes('made-up failure story'), false);
  }
  // CHANGED (0.8.4 apply, the README rework): the persona bullet is in KNOWN-LIMITS.md now (word for word); OLD: it was read from README.md. The absence check reads both files.
  const readme = readFileSync(join(root, 'README.md'), 'utf8');
  const limits = readFileSync(join(root, 'KNOWN-LIMITS.md'), 'utf8');
  const at = limits.indexOf("**A persona is a label");
  assert.notEqual(at, -1);
  const bullet = limits.slice(at, limits.indexOf('\n- ', at + 10));
  assert.doesNotMatch(`${readme}\n${bullet}`, /asked not to write|without knowing who wrote/);
  assert.match(bullet, /Nothing stops a judge from writing a persona name/);
});
