// E3b unit one (ruled 14 Oct 2026; Review/Build_0.8.3/m6-closing/E3b_Gate_Page.md sections 8 and 10): the verdict envelope's parts, with NO shipped caller. Reply identity is a pair (review_id, draft_id) recorded per
// critic call; parseJson(text, { expect }) takes only spans that carry exactly that pair. These tests are the parts; unit two wires the call sites behind the held sentence.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync, writeFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as CH from '../src/chain.js';
const { parseJson } = CH;
const envelopeReason = (...a) => CH.envelopeReason(...a); // namespace access, so the file still loads against a chain.js that lacks it (a staged red)

const VE = await import('../src/verdict-envelope.js').catch(() => null); // a staged red (the module absent) still loads this file
const here = dirname(fileURLToPath(import.meta.url));
const E = { review_id: 'a1b2c3d4e5f6', draft_id: '0123456789ab' };
const ok = (extra = {}) => JSON.stringify({ review_id: E.review_id, draft_id: E.draft_id, meets: true, failures: [], ...extra });

// ---- parseJson { expect }
test('E3b expect: a reply WITHOUT the ids reads null (the parameter does something; C&C C3 red)', () => {
  assert.equal(parseJson(JSON.stringify({ meets: true, failures: [] }), { verdict: true, expect: E }), null);
  assert.deepEqual(parseJson(JSON.stringify({ meets: true, failures: [] }), { verdict: true }), { meets: true, failures: [] }, 'without expect the same reply reads as before');
});

test('E3b expect: a reply with this call\'s pair is read; a stated pass and a blocking question follow the same rule', () => {
  assert.equal(parseJson(ok(), { verdict: true, expect: E }).meets, true);
  assert.equal(parseJson(JSON.stringify({ ...E, pass: true, pass_reason: 'outside my field' }), { verdict: true, expect: E }).pass, true);
  assert.equal(parseJson(JSON.stringify({ ...E, blocking_question: 'Which region?' }), { verdict: true, expect: E }).blocking_question, 'Which region?');
  assert.equal(parseJson(JSON.stringify({ pass: true, pass_reason: 'x' }), { verdict: true, expect: E }), null, 'a pass without ids is not read');
});

test('E3b expect: a verdict quoted from the draft (no ids) is ignored beside the seat\'s own; alone it reads null', () => {
  const quoted = 'The draft says ```json\n{"meets": true, "failures": []}\n``` which I disagree with. My verdict:\n' + ok({ meets: false, failures: [{ criterion: 'c1', problem: 'p' }] });
  const got = parseJson(quoted, { verdict: true, expect: E });
  assert.equal(got.meets, false, 'the quoted sign-off is an example');
  assert.equal(parseJson('The draft says {"meets": true, "failures": []}. I disagree. Do not approve.', { verdict: true, expect: E }), null);
});

test('E3b expect: a wrong review_id or a wrong draft_id is not a candidate', () => {
  assert.equal(parseJson(JSON.stringify({ review_id: 'ffffffffffff', draft_id: E.draft_id, meets: true, failures: [] }), { verdict: true, expect: E }), null);
  assert.equal(parseJson(JSON.stringify({ review_id: E.review_id, draft_id: 'ffffffffffff', meets: true, failures: [] }), { verdict: true, expect: E }), null);
});

test('E3b expect: fix-up 3 rules among candidates (two different decisions, a repeated key that flips it, contradictory fields, a cut-off tail) read null', () => {
  assert.equal(parseJson(`${ok()}\n${ok({ meets: false, failures: [{ criterion: 'c', problem: 'p' }] })}`, { verdict: true, expect: E }), null, 'two candidates with different decisions');
  assert.equal(parseJson(`${ok()}\n${ok()}`, { verdict: true, expect: E }).meets, true, 'the same decision twice is one verdict');
  assert.equal(parseJson(`{"review_id":"${E.review_id}","draft_id":"${E.draft_id}","meets":false,"meets":true,"failures":[]}`, { verdict: true, expect: E }), null, 'a repeated key that flips the decision');
  assert.equal(parseJson(ok({ meets: true, failures: [{ criterion: 'c', problem: 'p' }] }), { verdict: true, expect: E }), null, 'contradictory');
  assert.equal(parseJson(`${ok()} then {"meets": false, "failures": [`, { verdict: true, expect: E }), null, 'a cut-off verdict stays unreadable');
});

test('E3b envelopeReason: missing, wrong_id, or null when a candidate exists', () => {
  assert.equal(envelopeReason(JSON.stringify({ meets: true }), E), 'missing');
  // DATED OLD BAR -> NEW BAR (14 Oct 2026, E3b unit three, C&C's classification order): prose with no JSON object at all used to read 'missing'; it is MALFORMED, so envelopeReason says nothing (null).
  assert.equal(envelopeReason('no json at all', E), null);
  assert.equal(envelopeReason(JSON.stringify({ review_id: 'ffffffffffff', draft_id: E.draft_id, meets: true }), E), 'wrong_id');
  assert.equal(envelopeReason(ok(), E), null);
});

test('E3b C2: the bigger-cap retry has its OWN pair; a retry reply echoing the first attempt\'s pair is unreadable, wrong_id', () => {
  const first = { review_id: '111111111111', draft_id: E.draft_id };
  const retry = { review_id: '222222222222', draft_id: E.draft_id };
  const echoesFirst = JSON.stringify({ ...first, meets: true, failures: [] });
  assert.equal(parseJson(echoesFirst, { verdict: true, expect: first }).meets, true, 'read with the first attempt\'s pair it is a verdict');
  assert.equal(parseJson(echoesFirst, { verdict: true, expect: retry }), null);
  assert.equal(envelopeReason(echoesFirst, retry), 'wrong_id');
});

test('E3b expect: a malformed `expect` throws instead of admitting every quoted verdict (undefined === undefined)', () => {
  const quoted = '{"meets":true,"failures":[]}';
  assert.throws(() => parseJson(quoted, { verdict: true, expect: {} }), /12 hex/);
  assert.throws(() => parseJson(quoted, { verdict: true, expect: { review_id: E.review_id } }), /12 hex/);
  assert.throws(() => parseJson(quoted, { verdict: true, expect: { review_id: 'xyz', draft_id: E.draft_id } }), /12 hex/);
  assert.throws(() => CH.envelopeReason(quoted, {}), /12 hex/);
});

test('E3b envelopeReason: a failed attempt or a cut-off verdict is NOT recorded as missing (the seat may have sent the ids)', () => {
  assert.equal(envelopeReason(`{"review_id":"${E.review_id}","draft_id":"${E.draft_id}","meets":tru}`, E), null, 'broken JSON that carries the ids');
  assert.equal(envelopeReason(`{"review_id":"${E.review_id}","draft_id":"${E.draft_id}","meets":true,"failures":[`, E), null, 'cut off');
});

test('E3b expect: a stray `{` in quoted code does not hide a verdict in a fence (as the baseline); an unfenced one stays unreadable (also as the baseline)', () => {
  const stray = 'The draft has code like if (x) { run(); } and later if (y) {\n';
  assert.equal(parseJson(`${stray}\`\`\`json\n${ok()}\n\`\`\`\n`, { verdict: true, expect: E })?.meets, true);
  assert.equal(parseJson(`${stray}${ok()}\n`, { verdict: true }), null, 'the baseline reads the unfenced shape as null');
  assert.equal(parseJson(`${stray}${ok()}\n`, { verdict: true, expect: E }), null); // PIN: matches the baseline
});

test('E3b expect: rule split. A contradictory example WITHOUT the ids beside a valid candidate reads the candidate; a decision-changing duplicate key in an example reads null', () => {
  const contradictoryExample = '{"meets": true, "failures": [{"criterion": "c", "problem": "p"}]}';
  assert.equal(parseJson(`Quoted: ${contradictoryExample}\n${ok()}`, { verdict: true, expect: E })?.meets, true, 'an example is only an example');
  assert.equal(parseJson(`Quoted: ${contradictoryExample}\n${ok()}`, { verdict: true }), null, 'the baseline refuses it (contradictory span): the envelope is what makes the difference');
  assert.equal(parseJson(`Quoted: {"meets": false, "meets": true}\n${ok()}`, { verdict: true, expect: E }), null); // PIN: a failed read of the reply, example or not
});

test('E3b expect: triple backticks INSIDE a JSON string do not cut the verdict apart (the read text is byte-identical to what the seat sent); a large criteria table reads', () => {
  const fence = '```';
  const mk = problem => JSON.stringify({ ...E, meets: false, failures: [{ criterion: 'c1', problem }] });
  const a = mk(`the snippet ${fence}js x()${fence} is wrong`);
  assert.deepEqual(parseJson(a, { verdict: true, expect: E }).failures, JSON.parse(a).failures, 'a: the whole reply');
  assert.deepEqual(parseJson(`${fence}json\n${a}\n${fence}`, { verdict: true, expect: E })?.failures, JSON.parse(a).failures, 'b: the same inside a json fence');
  const c = JSON.stringify({ ...E, meets: false, failures: [{ criterion: `see ${fence}a`, problem: `and ${fence}b` }] });
  assert.deepEqual(parseJson(c, { verdict: true, expect: E }).failures, JSON.parse(c).failures, 'c: two string fields with one fence each');
  const rows = Array.from({ length: 80 }, (_, i) => ({ criterion: `c${i}`, verdict: 'MET', evidence: 'ok' }));
  assert.equal(parseJson(JSON.stringify({ ...E, meets: true, failures: [], criteria: rows }), { verdict: true, expect: E })?.criteria.length, 80, 'd: scanBraceSpans counts outermost spans, not every brace'); // PIN
});

test('E3b expect: the region fallback never records text the seat did not write (a fence with a stray brace, then a verdict with a triple backtick inside a string, reads null)', () => {
  const fence = '```';
  const sent = JSON.stringify({ ...E, meets: false, failures: [{ criterion: 'c1', problem: `the snippet ${fence}js x()${fence} is wrong` }] });
  const reply = `${fence}js\nif (y) {\n${fence}\n${sent}\n`;
  assert.equal(parseJson(reply, { verdict: true, expect: E }), null);
  assert.equal(envelopeReason(reply, E), null, 'nothing is recorded that the seat did not do');
});

// ---- the module
test('E3b module: the nonce is random per label, recorded before the call, replayed on resume and never regenerated', () => {
  assert.ok(VE, 'src/verdict-envelope.js exists');
  const rows = new Map();
  VE.setEnvelopeStore({ read: l => rows.get(l) ?? null, write: (l, r) => rows.set(l, r) });
  const seq = ['aaaaaaaaaaaa', 'bbbbbbbbbbbb', 'cccccccccccc'];
  VE.setEnvelopeRandom(() => seq.shift());
  try {
    const a = VE.issueEnvelope('panel-1-la', 'draft one');
    assert.equal(a.review_id, 'aaaaaaaaaaaa');
    assert.deepEqual(rows.get('panel-1-la'), a, 'recorded before the call is sent (issueEnvelope writes it itself)');
    assert.deepEqual(VE.issueEnvelope('panel-1-la', 'draft one'), a, 'a resume reads the recorded pair');
    assert.equal(seq.length, 2, 'no new nonce was drawn on the replay');
    assert.equal(VE.issueEnvelope('panel-1-la-retry', 'draft one').review_id, 'bbbbbbbbbbbb', 'a retry has its own record');
    const stale = VE.issueEnvelope('panel-1-la', 'a different draft');
    assert.equal(stale.review_id, 'cccccccccccc', 'a record whose draft_id is not the draft shown now is replaced');
    assert.notEqual(stale.draft_id, a.draft_id);
  } finally { VE.setEnvelopeRandom(null); VE.setEnvelopeStore(null); }
  assert.throws(() => VE.issueEnvelope('x', 'y'), /no envelope store/);
});

test('E3b module: a corrupt stored record (non-hex review_id) is no data: a fresh pair is drawn and nothing throws', () => {
  assert.ok(VE);
  const rows = new Map([['panel-1-la', { review_id: 'zzzzzzzzzzzz', draft_id: VE.draftIdOf('d'), label: 'panel-1-la' }]]);
  VE.setEnvelopeStore({ read: l => rows.get(l) ?? null, write: (l, r) => rows.set(l, r) });
  VE.setEnvelopeRandom(() => 'abcdefabcdef');
  try {
    const pair = VE.issueEnvelope('panel-1-la', 'd');
    assert.equal(pair.review_id, 'abcdefabcdef');
    assert.equal(parseJson('{"meets":true,"failures":[]}', { verdict: true, expect: pair }), null, 'the pair is usable by parseJson');
    assert.equal(VE.isEnvelopePair({ review_id: 'zzzzzzzzzzzz', draft_id: 'abcdefabcdef' }), false);
  } finally { VE.setEnvelopeRandom(null); VE.setEnvelopeStore(null); }
  const dir = mkdtempSync(join(tmpdir(), 'envelope-'));
  writeFileSync(join(dir, 'x.envelope.json'), JSON.stringify({ review_id: 'zzzzzzzzzzzz', draft_id: 'abcdefabcdef' }));
  assert.equal(VE.fileEnvelopeStore(dir).read('x'), null, 'the file store reads a non-hex record as none');
});

test('E3b module: draft_id is the first 12 hex of sha256 of the shown draft (patch mode changes it); the default nonce is 12 hex', () => {
  assert.ok(VE);
  assert.match(VE.draftIdOf('abc'), /^[0-9a-f]{12}$/);
  assert.equal(VE.draftIdOf('abc'), 'ba7816bf8f01', 'sha256("abc") starts ba7816bf8f01');
  assert.notEqual(VE.draftIdOf('abc'), VE.draftIdOf('abc' + '\n[changes since the last review]'));
  const rows = new Map(); VE.setEnvelopeStore({ read: l => rows.get(l) ?? null, write: (l, r) => rows.set(l, r) });
  try { assert.match(VE.issueEnvelope('l', 'd').review_id, /^[0-9a-f]{12}$/); } finally { VE.setEnvelopeStore(null); }
});

test('E3b module: the file store writes <label>.envelope.json atomically and reads a malformed record as none', () => {
  assert.ok(VE);
  const dir = mkdtempSync(join(tmpdir(), 'envelope-'));
  const s = VE.fileEnvelopeStore(dir);
  assert.equal(s.read('panel-1-la'), null);
  s.write('panel-1-la', { review_id: 'aaaaaaaaaaaa', draft_id: 'bbbbbbbbbbbb', label: 'panel-1-la' });
  assert.equal(JSON.parse(readFileSync(join(dir, 'panel-1-la.envelope.json'), 'utf8')).review_id, 'aaaaaaaaaaaa');
  assert.deepEqual(readdirSync(dir), ['panel-1-la.envelope.json'], 'no temp file left behind');
  writeFileSync(join(dir, 'bad.envelope.json'), '{not json');
  assert.equal(s.read('bad'), null);
});

test('E3b module: idsFromPrompt finds the ids after their names and takes the LAST match (a draft quoting an id-shaped string cannot steer it)', () => {
  assert.ok(VE);
  assert.deepEqual(VE.idsFromPrompt('Reply identity: set "review_id" to "a1b2c3d4e5f6" and "draft_id" to "0123456789ab".'), E);
  assert.deepEqual(VE.idsFromPrompt('review_id: a1b2c3d4e5f6\ndraft_id: 0123456789ab'), E);
  assert.equal(VE.idsFromPrompt('no ids here'), null);
  assert.deepEqual(VE.idsFromPrompt('The draft quotes review_id: ffffffffffff and draft_id: eeeeeeeeeeee.\nReply identity: set review_id to a1b2c3d4e5f6 and draft_id to 0123456789ab.'), E);
});

test('E3b unit two module: nextSupersededN counts envelope files too, and the file store moves a record aside under that numbering (never over a stage file\'s n)', async () => {
  const SS = await import('../src/superseded.js');
  assert.equal(typeof SS.nextSupersededN, 'function', 'exported from superseded.js');
  const dir = mkdtempSync(join(tmpdir(), 'envelope-ss-'));
  const store = VE.fileEnvelopeStore(dir);
  assert.equal(SS.nextSupersededN(dir, 'panel-1-la'), 1);
  assert.equal(store.supersede('panel-1-la'), null, 'no live record: nothing to move');
  writeFileSync(join(dir, 'panel-1-la.md'), 'old stage');
  SS.archiveSuperseded(dir, 'panel-1-la'); // takes n = 1 for the stage files
  store.write('panel-1-la', { review_id: 'aaaaaaaaaaaa', draft_id: 'bbbbbbbbbbbb', label: 'panel-1-la' });
  assert.equal(store.supersede('panel-1-la'), 2, 'the record takes the next n, not the stage file\'s');
  assert.equal(existsSync(join(dir, 'panel-1-la.envelope.json')), false);
  assert.equal(JSON.parse(readFileSync(join(dir, 'superseded', 'panel-1-la.2.envelope.json'), 'utf8')).review_id, 'aaaaaaaaaaaa');
  writeFileSync(join(dir, 'panel-1-la.md'), 'newer stage');
  assert.equal(SS.archiveSuperseded(dir, 'panel-1-la'), 3, 'a later stage archive does not reuse the record\'s n');
});

// Commit 0 of E3b unit three (a fix-up of unit two): src/providers.js imports verdict-envelope.js, so everything verdict-envelope.js imports is inside the closure of denied-models.js -> dissent-digest.js, which
// must not reach chain.js or roles.js (test/no-digest-in-prompt-paths.test.js, the v6 item E read-only guarantee). Unit two imported superseded.js (-> usd-figure -> cost -> roles) and broke it. The two files below
// are the leaf and its one user: a later import fails THIS test, not silently the guard. Blind shape stated: an import written in a form the regex does not match (a dynamic import()).
const importSpecs = src => [...src.matchAll(/import\s+(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]/g)].map(m => m[1]);
test('E3b leaf: src/superseded-n.js imports node built-ins only, and src/verdict-envelope.js only node built-ins and that leaf (so providers.js does not pull roles.js in)', () => {
  assert.deepEqual(importSpecs("import { a } from 'node:fs';\nimport b from './x.js';"), ['node:fs', './x.js'], 'self-test: the reader sees both kinds');
  const read = f => readFileSync(join(here, '..', 'src', f), 'utf8');
  assert.deepEqual(importSpecs(read('superseded-n.js')).filter(x => !x.startsWith('node:')), [], 'the leaf: node built-ins only');
  assert.deepEqual(importSpecs(read('verdict-envelope.js')).filter(x => !x.startsWith('node:')), ['./superseded-n.js'], 'verdict-envelope.js: node built-ins and the leaf');
});

// ---- the only call sites (C&C C3 in unit one, changed in unit two). DATED OLD BAR -> NEW BAR (14 Oct 2026, E3b unit two): unit one asserted that NO call site in src/ passes `expect`. Unit two adds the
// first ones, so the bar is now: every call that passes `expect` takes it from the result of withEnvelope (a variable that holds `env.expect`, never a literal or a pair built at the site), only in src/chain.js,
// and withEnvelope returns expect null unless the run uses the envelope (the run.json flag) and the held sentence is available. Blind shape stated: options built in a variable of another name.
// The whole argument text of each `parseJson(` call (balanced parentheses, across lines) is read, so a call split over several lines is seen.
const callsPassingExpect = src => {
  const hits = [];
  const re = /\bparseJson\(/g;
  for (let m; (m = re.exec(src));) {
    const before = src.slice(src.lastIndexOf('\n', m.index) + 1, m.index);
    if (/^\s*(\/\/|\*)/.test(before) || /function\s+$/.test(before)) continue;
    let depth = 0, k = m.index + m[0].length - 1;
    for (; k < src.length; k++) { if (src[k] === '(') depth++; else if (src[k] === ')' && --depth === 0) break; }
    const args = src.slice(m.index, k);
    if (/\bexpect\b/.test(args)) hits.push({ line: src.slice(0, m.index).split('\n').length, args });
  }
  return hits;
};
const fromEnvelopeResult = args => /\.\.\.\((envUsed|rrEnv) \? \{ expect: \1 \} : \{\}\)/.test(args);

test('E3b only call sites: every parseJson call that passes `expect` takes it from withEnvelope\'s result, only in chain.js; withEnvelope returns null unless the run uses the envelope (self-tested)', () => {
  assert.equal(callsPassingExpect("const p = parseJson(cs.text, { verdict: true, expect: pair });").length, 1, 'self-test: a call site that passes expect is seen');
  assert.equal(fromEnvelopeResult("parseJson(cs.text, { verdict: true, expect: pair })"), false, 'self-test: a pair built at the site is refused');
  assert.equal(fromEnvelopeResult("parseJson(cs.text, { verdict: true, ...(envUsed ? { expect: envUsed } : {}) })"), true);
  assert.deepEqual(callsPassingExpect("// parseJson(x, { expect })\nconst p = parseJson(cs.text, { verdict: true });"), [], 'self-test: a comment and a plain call are not');
  assert.deepEqual(callsPassingExpect('export function parseJson(text, { verdict = false, expect = null } = {}) {'), [], 'self-test: the definition is not a call site');
  assert.equal(callsPassingExpect('x();\nconst p = parseJson(\n  cs.text,\n  { verdict: true,\n    expect: pair },\n);')[0].line, 2, 'self-test: a call split over several lines is seen');
  const walk = d => readdirSync(d, { withFileTypes: true }).flatMap(e => { const p = join(d, e.name); return e.isDirectory() ? walk(p) : p.endsWith('.js') ? [p] : []; });
  const chainPath = join(here, '..', 'src', 'chain.js');
  const all = walk(join(here, '..', 'src')).flatMap(f => callsPassingExpect(readFileSync(f, 'utf8')).map(h => ({ f, ...h })));
  assert.deepEqual(all.filter(h => h.f !== chainPath).map(h => `${h.f}:${h.line}`), [], 'no other file passes expect');
  assert.ok(all.length >= 4, 'the four critic call sites (first attempt, retry, round-robin, its retry)');
  assert.deepEqual(all.filter(h => !fromEnvelopeResult(h.args)).map(h => `${h.line}: ${h.args.slice(0, 80)}`), [], 'every one takes expect from withEnvelope\'s result');
  assert.match(readFileSync(chainPath, 'utf8'), /export function withEnvelope\(label, shownDraft, userText\) \{\n  if \(!envelopeInForce\(\)\) return \{ user: userText, expect: null \};/);
});
