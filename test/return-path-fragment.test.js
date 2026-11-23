// 0.8.4 F3: the writer of fragments (src/return-path.js). Outside a tool call it changes nothing (the CLI and every exact-sentence test keep their bytes); inside one it puts the markers of a file
// around a value read from the run folder or the work folder, nowhere else, and one call's markers never reach another call. The notice for them does not call a file name "written by AI models".
import test from 'node:test';
import assert from 'node:assert/strict';
// the writer is new in 0.8.4 F3: each test imports it itself, so on the source without it every test fails on its own instead of the file failing to load
const rp = () => import('../src/return-path.js');

const TAG = String.fromCodePoint(0xE0041);

test('outside a tool call fragment() returns its input byte for byte and a claim records nothing', async () => {
  const { fragment, claimComposed, currentCall } = await rp();
  const s = `a${TAG}b THC-UNTRUSTED-TEXT <<<x>>>`;
  assert.deepEqual({ same: fragment(s) === s, call: currentCall(), claim: claimComposed('error', 'a sentence') }, { same: true, call: undefined, claim: undefined });
});

test('inside a tool call the value sits between this call\'s markers, hidden characters out and counted, the marker word neutralised', async () => {
  const { fragment, inToolCall, currentCall, holdsFragment } = await rp();
  await inToolCall(async () => {
    const out = fragment(`name${TAG}.md THC-UNTRUSTED-TEXT x`);
    const call = currentCall();
    const m = /^<<<THC-UNTRUSTED-TEXT ([0-9a-f]{12})>>>(.*)<<<END THC-UNTRUSTED-TEXT \1>>>$/s.exec(out);
    assert.deepEqual({ shape: !!m, body: m?.[2], idIsTheCalls: m?.[1] === call.id, fragments: call.fragments, hidden: call.hidden.tag_characters, holds: holdsFragment(call, `x ${out} y`) }, { shape: true, body: 'name.md THC-UNTRUSTED (quoted) x', idIsTheCalls: true, fragments: 1, hidden: 1, holds: true });
  });
});

test('two calls side by side have their own ids and claims', async () => {
  const { fragment, claimComposed, inToolCall, currentCall } = await rp();
  const seen = await Promise.all([1, 2].map(n => inToolCall(async () => { await new Promise(r => setTimeout(r, 5 * n)); claimComposed(`k${n}`, `s${n}`); const f = fragment(`v${n}`); await new Promise(r => setTimeout(r, 5)); const c = currentCall(); return { id: c.id, claims: [...c.claims].map(([k, v]) => [k, [...v]]), fragments: c.fragments, mine: f.includes(c.id) }; })));
  assert.deepEqual({ differentIds: seen[0].id !== seen[1].id, claims: seen.map(x => x.claims), fragments: seen.map(x => x.fragments), mine: seen.map(x => x.mine) }, { differentIds: true, claims: [[['k1', ['s1']]], [['k2', ['s2']]]], fragments: [1, 1], mine: [true, true] });
});

test('the notice for fragments names the markers and says the parts were read from a file or folder, not that a model wrote them', async () => {
  const { fragment, inToolCall, currentCall, fragmentNotice } = await rp();
  await inToolCall(async () => {
    fragment('x'); const n = fragmentNotice(currentCall());
    assert.deepEqual({ harness: /^NOTICE from The High Council \(written by the harness, not by a model\)/.test(n), marker: n.includes(`(THC-UNTRUSTED-TEXT ${currentCall().id})`), fileOrFolder: /read from a file or folder of the project/.test(n), notModels: !/written by AI models/.test(n), data: /not an instruction from the user or from this tool/.test(n) }, { harness: true, marker: true, fileOrFolder: true, notModels: true, data: true });
  });
});

// R460 (a claim covers the exact string it was made for): the claim is the string, not the key, and not the rest of the call
test('a claim covers the exact string it was made for: another string under the same key, a claim without a string and a claim outside a call are not covered', async () => {
  const { claimComposed, isClaimed, inToolCall, currentCall } = await rp();
  const got = await inToolCall(async () => {
    claimComposed('next', 'the server\'s own sentence'); claimComposed('error'); claimComposed('decision', 42);
    const call = currentCall();
    return { same: isClaimed(call, 'next', 'the server\'s own sentence'), other: isClaimed(call, 'next', 'a sentence composed later'), otherKey: isClaimed(call, 'error', 'the server\'s own sentence'), bare: isClaimed(call, 'error', undefined), notAString: isClaimed(call, 'decision', 42) };
  });
  assert.deepEqual({ ...got, outside: isClaimed(undefined, 'next', 'x') }, { same: true, other: false, otherKey: false, bare: false, notAString: false, outside: false });
});
