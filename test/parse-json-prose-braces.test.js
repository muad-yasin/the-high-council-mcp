// test/parse-json-prose-braces.test.js
//
// parseJson's decision table (Review/Build_0.8.3/m6-closing/E_ParseJson_Decision_Table.md, ruled by C&C 13 Oct 2026): ONE TEST PER TABLE ROW (T-A1 ... T-E9), then a few guards.
// Origin: audit batch 1 item 3 (braces in prose made a readable reply unreadable); three rounds of review then found the same thing three ways - a span the seat QUOTED from the draft
// standing in for a verdict the seat did not give. So every check below is about "which span did the seat produce, and how do we know?", and a reply that cannot answer that is null (an
// abstention and one re-ask), never a sign-off or an objection on the record.
//
// Callers: V = a verdict caller, `parseJson(text, { verdict: true })` (the sites that feed normaliseCritique); S = a decision-bearing caller, `{ strict: true }` (criteria = the run's checker, the
// security review, preflight, the cold reader); N = every other caller, `parseJson(text)`. Amendment 2 of the table (13 Oct 2026, Astra's review) added S, duplicate keys, contradictory decision
// fields, one canonical-equality selection rule (replacing the old last/first rules) and one inventory of failed attempts across all paths, fences included.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseJson, normaliseCritique } from '../src/chain.js';

const V = text => parseJson(text, { verdict: true });
const N = text => parseJson(text);
const S = text => parseJson(text, { strict: true });

const signoff = { meets: true, criteria: [], failures: [] };
const SIGNOFF = JSON.stringify(signoff);
const objection = { meets: false, failures: [{ criterion: 'C1', problem: 'the plan names no owner' }] };
const OBJECTION = JSON.stringify(objection);
const quotedSignoff = '{"meets": true, "failures": []}';
const fence = body => '```json\n' + body + '\n```';

// ---- paths A-D: the first candidate that parses wins (baseline order); the checks only ever turn a parsed value into null ----
test('T-A1 the whole reply is one JSON value: it is the seat\'s reply, for V and N', () => {
  assert.deepEqual(V(SIGNOFF), signoff);
  assert.deepEqual(N(SIGNOFF), signoff);
});
test('T-B1 a fenced verdict with nothing else competing (V)', () => {
  assert.deepEqual(V(`Here is my verdict:\n${fence(OBJECTION)}\nThanks.`), objection);
});
test('T-B2 a fenced verdict beside readable spans that stand for none or the same verdict (V): the fence marks it', () => {
  assert.deepEqual(V(`Shape: {"layout": "a list"}. A sign-off looks like ${quotedSignoff}.\n${fence(SIGNOFF)}`), signoff);
  assert.deepEqual(V(`${fence(OBJECTION)}\nFor comparison {"shape": "x"}.`), objection);
});
test('T-B3 a fenced verdict beside a readable span that stands for a DIFFERENT verdict is null (V) - the first fence quotes the draft, the second is the seat\'s own', () => {
  assert.equal(V(`The draft has:\n${fence(quotedSignoff)}\nMy verdict:\n${fence(OBJECTION)}`), null, 'two fences');
  assert.equal(V(`${fence(SIGNOFF)}\nBut actually ${OBJECTION}`), null, 'a fence, then a contradicting prose span');
});
test('T-B4 a fenced verdict beside a FAILED attempt anywhere else is null (V); a code fence that only holds a quoted key is a snippet and does not null it', () => {
  assert.equal(V(`${fence(SIGNOFF)}\nand my other verdict {"meets": false, "failures": [{"criterion": "C1", "problem": "x" ]}`), null, 'a broken JSON-looking prose span');
  assert.equal(V(`${fence(SIGNOFF)}\nand then {"meets": false, "failures": [{"criterion": "cut off`), null, 'an unclosed opener with a key after it');
  assert.equal(V(`${fence(SIGNOFF)}\n${fence('{"meets": false, "failures": [')}`), null, 'another fence that starts with a brace and does not parse');
});
// GUARD for ruling 2 (green before and after by construction): the verdict fence comes FIRST (path B), then a code fence that holds a quoted key, does not start with `{` and does not parse.
// It must not null the reply. (When the FIRST fence is the snippet, the reply falls to path E, where such a snippet reads as a failed attempt: baseline was null there too; a stated limit.)
test('GUARD ruling 2: a code fence with a quoted key after the verdict fence is a snippet, not a failed verdict (V)', () => {
  assert.equal(V(fence(SIGNOFF) + '\n```js\nconst c = f({ "mode": 1 });\n```')?.meets, true);
});
test('T-B5 N callers keep the baseline: the first fenced object wins whatever else is in the reply', () => {
  assert.deepEqual(N(`The draft has:\n${fence(quotedSignoff)}\nMy verdict:\n${fence(OBJECTION)}`), { meets: true, failures: [] });
  assert.deepEqual(N(`${fence('{"proposals": []}')}\nand a broken {"proposals": [ }`), { proposals: [] });
});
test('T-B6 several readable fences standing for the same verdict (V): equal decision payloads -> the first; payloads that differ -> null (Amendment 2 replaces the old last/first rules)', () => {
  const quoted = { meets: false, failures: [{ criterion: 'C2', problem: 'quoted from the draft: no date' }] };
  assert.equal(V(`The draft says:\n${fence(JSON.stringify(quoted))}\nMy verdict:\n${fence(OBJECTION)}`), null, 'differing objection sets');
  const sameSet = { meets: false, failures: [{ criterion: 'C1', problem: 'the plan names no owner' }], verdict_line: 'reworded' };
  assert.deepEqual(V(`${fence(OBJECTION)}\n${fence(JSON.stringify(sameSet))}`), objection, 'the same decision payload (verdict_line is not decision-bearing): the first');
  const first = { meets: true, criteria: [{ criterion: 'C1', verdict: 'MET', evidence: 'quoted' }], failures: [] };
  const second = { meets: true, criteria: [{ criterion: 'C1', verdict: 'MET', evidence: 'the seat\'s own' }], failures: [] };
  assert.equal(V(`${fence(JSON.stringify(first))}\n${fence(JSON.stringify(second))}`), null, 'two sign-offs whose criteria tables differ');
});
test('T-C1 an unclosed fence at the end (V): read like B', () => {
  assert.deepEqual(V('My verdict:\n```json\n' + OBJECTION), objection);
  assert.equal(V(`I would say ${quotedSignoff}, wrong.\n\`\`\`json\n${OBJECTION}`), null, 'a contradicting span before the fence');
});
test('T-C2 an unclosed fence at the end (N): baseline', () => {
  assert.deepEqual(N(`I would say ${quotedSignoff}, wrong.\n\`\`\`json\n{"proposals": []}`), { proposals: [] });
});
test('T-D1 one object with prose that has no braces around it (V and N): the only brace-bearing content', () => {
  assert.deepEqual(V(`Here is my verdict:\n${OBJECTION}\nHope that helps.`), objection);
  assert.deepEqual(N('Here it is:\n{"proposals": [{"title": "a"}]}\nDone.'), { proposals: [{ title: 'a' }] });
});
test('T-D2 a cut-off verdict after a quoted object (V): null - the first-to-last span would end at the quoted sign-off (the incident of 4b13171)', () => {
  assert.equal(V(`The draft says ${quotedSignoff} - wrong. My verdict: {"meets": false, "failures": [{"criterion": "C1", "problem": "cut off here`), null);
  // the neighbour that must keep reading: a trailing prose { with no key after it
  assert.deepEqual(V(`${SIGNOFF} Anything else {just ask`), signoff);
});
test('T-D3 the same cut-off tail for N: baseline, the complete first object is returned', () => {
  assert.deepEqual(N('{"proposals": [{"title": "a"}]} and a second one {"proposals": [{"title": "b"'), { proposals: [{ title: 'a' }] });
});

// ---- path E: nothing above parsed; the balanced spans are read ----
test('T-E0 an unclosed { outside every span is unreadable (V and N): it might be the answer opening', () => {
  assert.equal(V(`Option { one is out. ${SIGNOFF}`), null);
  assert.equal(N('Option { one is out. {"proposals": []}'), null);
});
test('T-E1 a JSON-looking span that does not parse is a failed attempt: null however many readable spans surround it (V and N)', () => {
  assert.equal(V(`The draft says ${quotedSignoff} - wrong. My verdict: {"meets": false, "failures": [{"criterion": "C1", "problem": "x" ]}`), null);
  assert.equal(N('Compare {"a": 1} with {"proposals": [ }'), null);
});
test('T-E2 prose braces are not JSON and are passed over (V and N): the audit input and its relatives', () => {
  assert.deepEqual(V(`Verdict check {quick}: ${SIGNOFF}`), signoff);
  assert.deepEqual(V(`Here is {my take}. ${OBJECTION} Note {end of reply}.`), objection);
  assert.deepEqual(V('Result {draft}: {"meets": false, "failures": [{"criterion": "C1", "problem": "the text has a stray } and a { in it"}]} {done}'), { meets: false, failures: [{ criterion: 'C1', problem: 'the text has a stray } and a { in it' }] });
  assert.equal(V('Note {x}: {"meets": false, "failures": [], "problem": "he said \\"{no}\\" twice"} {y}')?.problem, 'he said "{no}" twice');
  assert.deepEqual(V('Verdict {quick}: {"meets": true, "failures": [],}'), { meets: true, failures: [] }, 'the trailing-comma repair applies to a span too');
  assert.deepEqual(N('Here {quick}: {"proposals": []}'), { proposals: [] });
});
test('T-E3 no readable span at all is null (V and N)', () => {
  assert.equal(V('Verdict {quick} and nothing else'), null);
  assert.equal(N('prose {only} braces {here}'), null);
});
test('T-E4 an N caller with exactly one readable span among prose braces takes it', () => {
  assert.deepEqual(N('Here are {three} things: {"proposals": [{"title": "a"}]} {end}'), { proposals: [{ title: 'a' }] });
});
test('T-E5 an N caller with two readable spans gets null (the baseline), never the longer: a quoted example must not become a recorded proposal or the run\'s criteria', () => {
  assert.equal(N('Example {"criteria": ["a long quoted example criterion from the task text"]} then {quick} {"criteria": ["b"]}'), null);
});
test('T-E6 a V reply whose readable spans stand for DIFFERENT verdicts is null, in both directions, including a table or failures list with no "meets"', () => {
  const longSignoff = JSON.stringify({ meets: true, criteria: ['a', 'b', 'c'], failures: [], verdict_line: 'a long quoted example of a sign-off from the draft' });
  assert.equal(V(`The draft quotes ${longSignoff} and my verdict is {"meets": false, "failures": []}`), null, 'a longer sign-off beside a shorter objection');
  assert.equal(V(`Example {"meets": true, "failures": []} then ${JSON.stringify({ ...objection, verdict_line: 'the real one' })}`), null, 'a longer objection beside a shorter sign-off');
  const metTable = { criteria: [{ criterion: 'C1', verdict: 'MET', evidence: 'the draft says so in section 2' }, { criterion: 'C2', verdict: 'MET', evidence: 'the draft says so in section 3' }] };
  assert.equal(V(`The draft quotes ${JSON.stringify(metTable)} - wrong. My verdict: {"meets": false, "failures": [{"criterion": "C1", "problem": "x"}]}`), null, 'an all-MET table with no "meets" stands for a sign-off');
  assert.equal(V(`The draft quotes {"failures": [{"criterion": "C1", "problem": "an old objection"}]} and my verdict is ${SIGNOFF}`), null, 'a failures-only object stands for an objection');
});
test('T-E7 exactly one span states a verdict and the others state none: take it, whatever its length', () => {
  const longExample = JSON.stringify({ shape: 'a list of failures', note: 'x'.repeat(200) });
  assert.deepEqual(V(`For example ${longExample} is the layout. My verdict: {"meets": false, "failures": [{"criterion": "C1", "problem": "p"}]}`), { meets: false, failures: [{ criterion: 'C1', problem: 'p' }] });
  assert.deepEqual(V(`Short {"shape": "x"} first. ${SIGNOFF}`), signoff);
});
test('T-E8a two sign-offs: equal decision payloads -> the first; sign-offs whose criteria tables differ -> null (the old "last" rule is gone)', () => {
  const a = { meets: true, failures: [], verdict_line: 'quoted from the draft' };
  const b = { meets: true, failures: [], criteria: [], verdict_line: 'the seat\'s own, said after' };
  assert.deepEqual(V(`Earlier ${JSON.stringify(a)} and then ${JSON.stringify(b)}`), a, 'canonically equal: defaults and verdict_line do not count');
  const t1 = { meets: true, failures: [], criteria: [{ criterion: 'C1', verdict: 'MET', evidence: 'x' }] };
  const t2 = { meets: true, failures: [], criteria: [{ criterion: 'C1', verdict: 'MET', evidence: 'y' }] };
  assert.equal(V(`${JSON.stringify(t1)} and ${JSON.stringify(t2)}`), null);
});
test('T-E8b two objections with the SAME failure set and the same decision payload: the first', () => {
  const a = { meets: false, failures: [{ criterion: 'C1', problem: 'no owner' }], verdict_line: 'first wording' };
  const b = { failures: [{ problem: 'no owner', criterion: 'C1' }], meets: false, verdict_line: 'second wording' };
  assert.deepEqual(V(`${JSON.stringify(a)} and also ${JSON.stringify(b)}`), a, 'key order does not matter');
});
test('T-E8c two objections with DIFFERENT failure sets are null: a quoted objection must never put another lab\'s failures on this seat\'s record', () => {
  const a = { meets: false, failures: [{ criterion: 'C1', problem: 'no owner' }] };
  const b = { meets: false, failures: [{ criterion: 'C2', problem: 'no date' }] };
  assert.equal(V(`${JSON.stringify(a)} and also ${JSON.stringify(b)}`), null);
});
test('T-E9 readable spans of which none states a verdict: null (V)', () => {
  assert.equal(V('Shapes: {"layout": "a"} and {"shape": "b"}'), null);
});

// ---- Amendment 2 (Astra's review, 13 Oct 2026) ----
test('T-DUP-V a duplicate key that CHANGES the decision is null for V (an ordinary parse keeps the later value and can erase an explicit rejection); one that does not, reads as before', () => {
  assert.equal(V('{"meets": false, "meets": true, "failures": []}'), null, 'path A: the later key would turn false into true');
  assert.equal(V(`Verdict: ${fence('{"meets": false, "failures": [{"criterion": "C1", "problem": "x"}], "failures": []}')}`), null, 'a duplicate failures key in a fence that empties the list');
  assert.equal(V('Check {quick}: {"meets": false, "\\u006deets": true, "failures": []}'), null, 'an escaped spelling of the same key (decoded names are compared)');
  assert.equal(V('{"meets": false, "failures": [{"criterion": "C1", "problem": "a"}], "failures": [{"criterion": "C2", "problem": "b"}]}'), null, 'a duplicate failures key that swaps which failures are recorded');
  // REAL shapes (found by diffing the parser over real replies on disk, 13 Oct 2026): a duplicate that cannot change what is recorded is not a reason to re-ask.
  assert.deepEqual(V('{"meets": true, "meets": true, "failures": []}'), { meets: true, failures: [] }, 'the same value twice');
  const row = '{"criterion": "C1", "verdict": "garbled", "verdict": "FAILED", "evidence": "e"}';
  const got = V(`{"meets": false, "criteria": [${row}], "failures": [{"criterion": "C1", "problem": "p"}]}`);
  assert.equal(got?.meets, false, 'a duplicated verdict inside one criteria row whose decision (objection, the same failures) is the same either way');
  assert.equal(V('{"meets": true, "failures": [], "note": {"a": 1, "a": 2}}')?.meets, true, 'a duplicate in a field that is not decision-bearing');
  // decisionKey treats `answers` as decision-bearing (the answer-back dispositions), so a repeated `answers` key that changes them is a decision change too; the same dispositions twice are not.
  const ans = (...ids) => `[${ids.map(d => `{"id": "O1", "disposition": "${d}"}`).join(', ')}]`;
  assert.equal(V(`{"meets": false, "failures": [{"criterion": "C1", "problem": "p"}], "answers": ${ans('sustained')}, "answers": ${ans('withdrawn')}}`), null, 'a repeated answers key that flips a disposition');
  assert.equal(V(`{"meets": false, "failures": [{"criterion": "C1", "problem": "p"}], "answers": ${ans('sustained')}, "answers": ${ans('sustained')}}`)?.meets, false, 'the same answers twice');
});
test('T-DUP-S a duplicate key is null for a strict caller; an N caller keeps the plain parse', () => {
  assert.equal(S('{"criteria": ["a"], "criteria": ["b"]}'), null);
  assert.deepEqual(N('{"criteria": ["a"], "criteria": ["b"]}'), { criteria: ['b'] }, 'tolerant callers are unchanged');
});
test('T-CON contradictory decision fields are null for V: meets:false beside an all-MET table, meets:true beside a failure or a FAILED row', () => {
  const met = [{ criterion: 'C1', verdict: 'MET', evidence: 'e' }];
  assert.equal(V(JSON.stringify({ meets: false, criteria: met, failures: [] })), null, 'all-MET table with meets:false');
  assert.equal(V(JSON.stringify({ meets: true, criteria: met, failures: [{ criterion: 'C1', problem: 'p' }] })), null, 'failures beside meets:true');
  assert.equal(V(JSON.stringify({ meets: true, criteria: [{ criterion: 'C1', verdict: 'FAILED', evidence: 'e' }], failures: [] })), null, 'a FAILED row beside meets:true');
  assert.deepEqual(V(JSON.stringify({ meets: true, criteria: met, failures: [{ criterion: 'none' }] })), { meets: true, criteria: met, failures: [{ criterion: 'none' }] }, 'a placeholder failure entry is not a failure (normaliseCritique drops it)');
  // REAL shape (found by diffing the parser over real replies on disk, 13 Oct 2026; two of 541 verdict replies): every row MET, meets:false, and REAL failures listed - a consistent objection
  // (normaliseCritique reads failures first), not the Llama shape, which has only a placeholder failure.
  assert.equal(V(JSON.stringify({ meets: false, criteria: met, failures: [{ criterion: 'C1', problem: 'a cross-criterion problem the table cannot show' }] }))?.meets, false, 'all-MET table, meets:false, a real failure: an objection');
  assert.deepEqual(V(JSON.stringify({ meets: false, criteria: [{ criterion: 'C1', verdict: 'FAILED', evidence: 'e' }], failures: [] })), { meets: false, criteria: [{ criterion: 'C1', verdict: 'FAILED', evidence: 'e' }], failures: [] }, 'consistent: not contradictory');
});
test('T-LLAMA the 2026-09-07 "Llama shape" (every row MET, meets:false, a placeholder failure) is null on the verdict path AND an abstention in normaliseCritique: REVERSES the sign-off rule of that incident (C&C ruling 14 Oct 2026)', () => {
  // Llama 3.3 70B filled the schema literally: every criterion MET, meets:false, and a placeholder failure because the array "had to" hold something. normaliseCritique read that as a SIGN-OFF
  // from 2026-09-07 until C&C's ruling of 14 Oct 2026 (the table was the honest signal; test/critique-contract.test.js pinned it). Now the panel path reads it null (an abstention and a re-ask) and
  // normaliseCritique agrees (unreadable): the object contradicts itself, and an explicit false must never become approval by precedence (Astra's review, finding 5).
  const llama = { meets: false, criteria: [{ criterion: 'C1', verdict: 'MET', evidence: 'e' }, { criterion: 'C2', verdict: 'MET', evidence: 'e' }], failures: [{ criterion: 'None', problem: '' }] };
  assert.equal(normaliseCritique(llama).unreadable, true, 'normaliseCritique reads it as an abstention, the same as the verdict path (EDITED: it was `.meets === true`, a sign-off)');
  assert.equal(normaliseCritique(llama).meets, false);
  assert.equal(V(JSON.stringify(llama)), null);
  assert.deepEqual(N(JSON.stringify(llama)), llama, 'an N caller is unchanged');
});
test('T-S-B5 a strict caller with a fenced answer beside a distinct readable object, a failed attempt, or a cut-off tail is null (the criteria example case); an N caller keeps the first fence', () => {
  const example = '{"criteria":[{"id":"C1","text":"The application starts."}]}';
  const actual = '{"criteria":[{"id":"C1","text":"Credentials never appear in application logs."}]}';
  assert.equal(S(`Example from the request:\n${fence(example)}\nMy actual criteria:\n${fence(actual)}`), null, 'two fences');
  assert.deepEqual(N(`Example from the request:\n${fence(example)}\nMy actual criteria:\n${fence(actual)}`), JSON.parse(example), 'N keeps the baseline');
  assert.equal(S(`${fence(actual)}\nExample: ${example}`), null, 'a fence and a prose object');
  assert.equal(S(`${fence(actual)}\nand then {"criteria": [{"id": "C2", "text": "cut`), null, 'a cut-off attempt');
  assert.deepEqual(S(`${fence(actual)}\n${fence(actual)}`), JSON.parse(actual), 'equal duplicates are one answer');
  assert.deepEqual(S(`Here: ${actual}\nDone.`), JSON.parse(actual), 'one object in prose still reads');
});
test('T-S-E a strict caller in the span path: two distinct readable objects are null, one is taken, canonically equal ones are one', () => {
  assert.equal(S('First {"criteria": ["a"]} then {quick} {"criteria": ["b"]}'), null);
  assert.deepEqual(S('Here {quick}: {"criteria": ["a"]} {end}'), { criteria: ['a'] });
  assert.deepEqual(S('One {"criteria": ["a"]} two {"criteria":["a"]}'), { criteria: ['a'] });
});
test('T-FENCE-ATTEMPT a quoted approval fence followed by a code fence that holds a CUT-OFF verdict is null: the snippet exemption never covers a { with a quoted key', () => {
  assert.equal(V(`Previous example:\n${fence(quotedSignoff)}\nMy verdict:\n\`\`\`javascript\nconst verdict = {"meets":false,"failures":[\n\`\`\``), null);
  assert.equal(V(`${fence(quotedSignoff)}\n\`\`\`js\nconst v = {"meets": false, "failures": [{"criterion": "C1", "problem": "x" ]};\n\`\`\``), null, 'a balanced but unreadable attempt inside a code fence');
});
test('T-CANON canonical equality ignores key order, spacing, missing-versus-empty defaults and fields that are not decision-bearing, and nothing else', () => {
  const a = '{"meets": true, "failures": [], "verdict_line": "A"}';
  const b = '{ "verdict_line": "B", "failures": [ ], "criteria": [], "answers": [], "meets": true }';
  assert.deepEqual(V(`${a} and ${b}`), JSON.parse(a));
  const c = '{"meets": true, "failures": [], "answers": [{"id": "O-1", "status": "withdrawn", "evidence": "q"}]}';
  assert.equal(V(`${a} and ${c}`), null, 'a different answers array is a different decision');
});

// ---- guards: neighbours that read before and must still read, and output that must stay unreadable ----
test('GUARD the stray-quote repair (needs the wide first-to-last span) still works, with and without prose', () => {
  const stray = '{"meets": false, "failures": [{"criterion": "C1", "problem": "it says "hello" in the text"}]}';
  for (const t of [stray, `My verdict: ${stray} Thanks.`]) {
    for (const call of [V, N]) { const got = call(t); assert.equal(got?.meets, false); assert.match(got.failures[0].problem, /hello/); }
  }
});
test('GUARD genuinely garbled output is still null', () => {
  for (const t of ['{"meets": tru', '{"meets": true, "failures": [ {"criterion": ', '{ not json } and { also not }', '']) { assert.equal(V(t), null, t); assert.equal(N(t), null, t); }
});
test('GUARD a hostile reply of many unmatched { returns null promptly (the scan stops at the first opener that never closes)', () => {
  const t0 = Date.now();
  assert.equal(V('{'.repeat(1_000_000)), null);
  assert.equal(N('{'.repeat(1_000_000)), null);
  assert.ok(Date.now() - t0 < 5000, `took ${Date.now() - t0} ms`);
});
test('GUARD a bare array reply and a fenced array are returned as before (N)', () => {
  assert.deepEqual(N('[{"title": "a"}]'), [{ title: 'a' }]);
  assert.deepEqual(N('```json\n[1, 2]\n```'), [1, 2]);
});
test('GUARD parseJson\'s placeholder-failure rule agrees with normaliseCritique\'s (two copies of one small rule, kept in step by this test)', () => {
  for (const f of [{ criterion: 'none' }, { criterion: 'N/A' }, { criterion: '-' }, { problem: '' }, { criterion: 'no failures.' }]) {
    const o = { meets: true, failures: [f] };
    assert.equal(normaliseCritique(o).meets, true, JSON.stringify(f));
    assert.ok(V(JSON.stringify(o)), `${JSON.stringify(f)} is a placeholder: not contradictory`);
  }
  for (const f of [{ criterion: 'C1', problem: 'p' }, { problem: 'something is wrong' }]) {
    const o = { meets: true, failures: [f] };
    assert.equal(normaliseCritique(o).meets, false, JSON.stringify(f));
    assert.equal(V(JSON.stringify(o)), null, `${JSON.stringify(f)} is a real failure beside meets:true: contradictory`);
  }
});

// ---- Bug audit 2026-10-24 C-006: a TRAILING fence whose closing is missing is a region of the reply too ----
// checkedAgainstTheRest('fence') scanned the closed fences and the prose but cut the unclosed tail out of `outside` and never added its body anywhere, so a sign-off in the first closed fence beside a LAST fence that opens with the seat's objection read as the sign-off alone (replyRegions already read the open body).
test('C-006 a closed sign-off fence, prose, then a LAST fence that opens with an objection and is never closed: null (V), not the sign-off', () => {
  const text = `${fence(SIGNOFF)}\n\nOn reflection I disagree:\n\n\`\`\`json\n${OBJECTION}\n`;
  assert.equal(V(text), null);
});
test('C-006 a closed sign-off fence followed by a CUT-OFF JSON-looking attempt in a last unclosed fence: null (V), the failed attempt is not ignored', () => {
  const text = `${fence(SIGNOFF)}\n\nThen:\n\n\`\`\`json\n{"meets": false, "failures": [{"criterion": "C1", "problem": "the plan names no ow`;
  assert.equal(V(text), null);
});
test('C-006 PIN: a closed fence and an unclosed last fence that state the SAME decision read as that decision', () => {
  const text = `${fence(OBJECTION)}\n\nAgain:\n\n\`\`\`json\n${OBJECTION}\n`;
  assert.deepEqual(V(text), objection);
});

// ---- Bug audit 2026-10-24 C-007: a placeholder failure entry names no criterion AND says nothing ----
// The rule dropped two entries that do say something (a bare string; an object with a none-word criterion and a real problem), so `meets: true` beside one read as a sign-off around an objection the seat gave. One rule now, shared by parseJson and normaliseCritique.
test('C-007 a bare-string failure beside meets:true is an objection the seat gave: contradictory, null (V)', () => {
  assert.equal(V('{"meets": true, "failures": ["The plan has no rollback section"]}'), null);
});
test('C-007 a none-word criterion with a real problem is an objection: null beside meets:true (V), kept by normaliseCritique with its text', () => {
  assert.equal(V('{"meets": true, "failures": [{"criterion": "None", "problem": "The plan has no rollback section"}]}'), null);
  const c = normaliseCritique({ meets: false, failures: [{ criterion: 'None', problem: 'The plan has no rollback section', fix: 'Add one.' }] });
  assert.equal(c.failures.length, 1);
  assert.equal(c.failures[0].problem, 'The plan has no rollback section');
});
test('C-007 with meets:false a bare-string failure survives as an objection carrying its own text, not the generic "named no criterion" row', () => {
  const c = normaliseCritique({ meets: false, failures: ['The plan has no rollback section'] });
  assert.equal(c.failures.length, 1);
  assert.equal(c.failures[0].problem, 'The plan has no rollback section');
});
test('C-007 PIN: entries that say nothing are still placeholders (a none-word string, blanks, a none criterion with no problem or "No failures.")', () => {
  for (const f of ['None', '', '   ', { criterion: 'None', problem: 'No failures.' }, { criterion: 'N/A', problem: '', fix: '' }]) {
    const o = { meets: true, failures: [f] };
    assert.equal(normaliseCritique(o).meets, true, JSON.stringify(f));
    assert.ok(V(JSON.stringify(o)), `${JSON.stringify(f)} says nothing: not contradictory`);
  }
});
