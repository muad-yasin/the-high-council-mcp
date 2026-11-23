// 0.8.4 S6 (M1), U6-1: the PURE parts of the shortened exchange at layers 2 and 3 (Q5, D4, W5, W14, G7): the switch, the sign-off line and field readers, the test-only mock suffixes, and the held words themselves. No run, $0.
// WRITTEN WITHOUT A RUN (overnight, no box). RED on the old source (src/short-exchange.js, the readers in src/layer-debate.js and the suffixes in src/providers.js missing): the switch row, readSignoffLine, readSignoffField, signoffOf and the two mock-suffix rows (a TypeError or an assertion; the module import is guarded, the others are namespace imports).
// PINS, green on the old source by design, each with its limit: 'W5 and W14 are drafted as the plan prints them' (test data, it can only fail if the held file changes), 'PIN (parse)' (it pins the parse S6 relies on, an old behaviour of chain.js parseJson: it fails only if that parse stops reading an object followed by a line), and the unsuffixed-mock assertion inside 'PIN (mock)'.
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as LD from '../src/layer-debate.js';
import { call } from '../src/providers.js';
import { parseJson, isNearJsonReply } from '../src/chain.js';
import { setHeldForTest } from '../src/held-roles.js';
import * as HB084 from './held-prompts/held-084-b.js';
const SE = await import('../src/short-exchange.js').catch(() => ({}));   // guarded: where the module is missing, the switch rows fail by TypeError and the file still loads

afterEach(() => setHeldForTest(null));

// CHANGED ACCEPTED TEST (0.8.4 apply, recorded state): OLD: the row proved the held states ('nothing recorded', 'W5 alone', 'W14 alone' false) through setHeldForTest maps and the pair true. NEW: the three held-state halves are REMOVED (no 0.8.4 name is unrecorded any more); the recorded-state half stays, without a map. WHY: shortExchangeRule and signoffLineRule are recorded (src/prompts/recorded-084-b.js; shortExchangeOn, src/short-exchange.js:7).
test('S6 switch: the shortened exchange is in force, both W5 and W14 being recorded', () => {
  assert.equal(SE.shortExchangeOn(), true, 'the pair is recorded');
});

test('PIN (words): W5 and W14 are drafted as the plan prints them, no em-dash, the anchors the readers and the prompts rely on', () => {
  const w5 = HB084.shortExchangeRule(); const w14 = HB084.signoffLineRule();
  // CHANGED ACCEPTED TEST (0.8.4 apply, recorded state): OLD: W5 'This layer has one exchange round: post once on your peers' standing objections raised in this pass ... which you see with their ratings and do not rule on.' and W14 'End with one line: sign-off: yes, ...'. NEW: the recorded W5 (two sentences after 'one exchange round.') and the recorded W14 (the JSON key sign_off). WHY: shortExchangeRule and signoffLineRule (src/prompts/recorded-084-b.js:101,108), the resolved text of the rows (RESOLVED_LIST).
  assert.equal(w5, 'This layer has one exchange round. Post once on your peers\' standing objections that were raised in this pass or carried from an earlier pass marked not debated, and reply once on your own. Objections sent up to you from a lower layer are not debated here.');
  assert.equal(w14, 'Add one more key to your JSON reply, "sign_off": "yes" if none of your own objections rated 4 or above (or without a rating) still stands and your table is complete; otherwise "no".');
  assert.equal(/—/.test(w5 + w14), false);
});

test('readSignoffLine: the LAST line, tolerant of markup and a full stop; yes / no / missing / garbled', () => {
  const read = LD.readSignoffLine;
  assert.equal(read('{"replies":[]}\nsign-off: yes'), 'yes');
  assert.equal(read('{"replies":[]}\nsign-off: no'), 'no');
  assert.equal(read('{"replies":[]}\n**Sign-off: Yes.**'), 'yes');
  assert.equal(read('{"replies":[]}\n- `sign-off: no`'), 'no');
  assert.equal(read('{"replies":[]}\nSign off: yes\n'), 'yes', 'trailing blank lines and the spelling "sign off"');
  assert.equal(read('```json\n{"replies":[]}\n```\nsign-off: yes'), 'yes', 'a fenced object, then the line');
  assert.equal(read('{"replies":[]}\nsign-off: no\n```'), 'no', 'a closing fence on its own line after the line is skipped');
  for (const none of ['', '{"replies":[]}', 'sign-off: yes\n{"replies":[]}', null, undefined, 42]) assert.equal(read(none), 'missing', `missing: ${JSON.stringify(none)}`);
  for (const bad of ['sign-off: maybe', 'sign-off:', 'sign-off: yes, if none of your own objections rated 4 or above still stands; otherwise sign-off: no.']) assert.equal(read(`{"replies":[]}\n${bad}`), 'garbled', `garbled: ${bad}`);
});

test('readSignoffField: the JSON form sign_off: "yes" / "no" (any case) or a boolean; anything else is garbled, no field is missing', () => {
  const read = LD.readSignoffField;
  assert.deepEqual([read({ sign_off: 'yes' }), read({ sign_off: 'NO' }), read({ sign_off: ' Yes. ' }), read({ sign_off: true }), read({ sign_off: false })], ['yes', 'no', 'yes', 'yes', 'no']);
  assert.deepEqual([read({ sign_off: 'maybe' }), read({ sign_off: 3 }), read({ sign_off: null }), read({ sign_off: {} })], ['garbled', 'garbled', 'garbled', 'garbled']);
  assert.deepEqual([read({}), read(null), read(undefined), read('sign_off')], ['missing', 'missing', 'missing', 'missing']);
});

test('signoffOf (G7, reading (C)): "no" wins when the line and the field differ; a garbled or missing one is no answer; both unreadable leaves the decision to the computed rule (value null)', () => {
  const of = (line, field) => { const r = LD.signoffOf(line === null ? '{"replies":[]}' : `{"replies":[]}\nsign-off: ${line}`, field === null ? {} : { sign_off: field }); return [r.line, r.field, r.value, r.mismatch]; };
  assert.deepEqual(of('yes', 'no'), ['yes', 'no', 'no', true], 'line yes, field no: no wins, a mismatch');
  assert.deepEqual(of('no', 'yes'), ['no', 'yes', 'no', true], 'line no, field yes: no wins, a mismatch');
  assert.deepEqual(of('yes', 'yes'), ['yes', 'yes', 'yes', false]);
  assert.deepEqual(of('no', 'no'), ['no', 'no', 'no', false]);
  assert.deepEqual(of('yes', null), ['yes', 'missing', 'yes', false]);
  assert.deepEqual(of(null, 'no'), ['missing', 'no', 'no', false]);
  assert.deepEqual(of('maybe', 'yes'), ['garbled', 'yes', 'yes', false], 'a garbled line is not a "no"');
  assert.deepEqual(of('maybe', 'maybe'), ['garbled', 'garbled', null, false]);
  assert.deepEqual(of(null, null), ['missing', 'missing', null, false]);
});

test('PIN (parse): a reply object followed by the sign-off line still reads as the object, with no near-JSON pause; a fenced object followed by the line too. Limit: this is chain.js parseJson as it was; it is green on the old source and is not the exit row T6b (the sign-off and no blind re-ask), which U6-2 and U6-5 build', () => {
  const object = { replies: [{ id: 'O-aaaaaaaa', action: 'withdraw', text: 'The quoted passage settles it.', quote: 'The worker retries failed requests' }] };
  for (const text of [`${JSON.stringify(object)}\nsign-off: yes`, `\`\`\`json\n${JSON.stringify(object, null, 2)}\n\`\`\`\nsign-off: yes`, `${JSON.stringify(object)}\n\n**sign-off: no**\n`]) {
    assert.deepEqual(parseJson(text), object, `parses: ${text.slice(0, 40)}`);
    assert.equal(isNearJsonReply(text), false, 'not near-JSON: nothing pauses for a repair');
  }
});

const REPLY_SYSTEM = 'You are a reviewer on a panel. Earlier you objected to a plan.';
const REPLY_USER = 'Your objection O-aaaaaaaa\nThe plan names a second deliverable.\n\n# Draft under review\n\nThe worker retries failed requests at most three times.\n';
const mockReply = async model => (await call('mock', { model, system: REPLY_SYSTEM, messages: [{ role: 'user', content: REPLY_USER }], maxTokens: 4000 })).text;

test('PIN (mock): a model with no sign-off suffix replies as it did before: the object alone, no line, no field. Limit: green on the old source; it fails only if the suffix code adds anything to an unsuffixed model', async () => {
  const plain = await mockReply('mock-exch-support-withdraw-id-s6a');
  assert.equal(plain, JSON.stringify({ replies: JSON.parse(plain).replies }), 'no suffix: the object alone, no line, no field');
  assert.equal(JSON.parse(plain).replies[0].action, 'withdraw');
});

test('mock suffixes (test-only): -signoffyes / -signoffno end the reply with the line, -signoffjunk with a line that is neither, -fieldyes / -fieldno add the JSON field, the mixed ones carry both', async () => {
  const expectations = { yes: ['yes', 'missing'], no: ['no', 'missing'], junk: ['garbled', 'missing'], fieldyes: ['missing', 'yes'], fieldno: ['missing', 'no'], yesfieldno: ['yes', 'no'], nofieldyes: ['no', 'yes'] };
  for (const [kind, [line, field]] of Object.entries(expectations)) {
    const text = await mockReply(`mock-exch-support-withdraw-id-s6a-signoff${kind}`);
    const parsed = parseJson(text);
    assert.equal(parsed.replies[0].action, 'withdraw', `${kind}: the suffix does not change the reply`);
    assert.deepEqual([LD.readSignoffLine(text), LD.readSignoffField(parsed)], [line, field], `${kind}: line and field`);
  }
});

test('mock suffixes: the sign-off suffix works after the older ones (-clean, -sev) and a reply that is garbled stays garbled', async () => {
  const text = await mockReply('mock-exch-support-keep-sev6-clean-signoffno');
  assert.equal(LD.readSignoffLine(text), 'no');
  assert.equal(parseJson(text).replies[0].action, 'keep');
  assert.equal(LD.readSignoffLine(await mockReply('mock-exch-support-garbled')), 'missing', 'a prose reply has no line the readers could take');
});
