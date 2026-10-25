// 0.8.3 M3 (PLAN 5.2, pack A10): the words that ask a tree member's writer for the split block, and its handoff seat to reproduce it, are HELD until the one 0.8.3 re-record (M7, the owner's yes). While held
// they add nothing, so every prompt of every run stays what it always was; a run that is not a tree member never asks. $0, offline.
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runChain, setPromptSpy } from '../src/chain.js';
import { held, setHeldForTest } from '../src/held-roles.js';
import { SPLIT_MARKER } from '../src/tree-split.js';
import * as R from '../src/roles.js';
import * as H from './held-prompts/held-083.js';
import { promptHashes } from './helpers/prompt-hashes.js';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { ROOT_ID, lineageFile, newTree } from './helpers/tree-fixture.js';
import { registerRoot } from '../src/tree-register.js';
import { handoffPrompt } from '../src/handoff-prompt.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const golden = JSON.parse(readFileSync(join(root, 'test', 'fixtures', 'prompt-hashes-6ee1946.json'), 'utf8'));
// CHANGED ACCEPTED GOLDEN (dependency list, 18 Okt 2026, the owner's yes: "Yes to the two slices as you suggested"): ONE row of test/fixtures/prompt-hashes-6ee1946.json moved, mock-debate's `handoff` system-prompt hash, because HANDOFF_SYSTEM gained the approved "Dependencies to verify" paragraph at its end. Every other row is the 6ee1946 byte-for-byte. The stage cache is keyed by the task text and the chain config, not by the prompt (src/cli.js: the fingerprint), so a run begun on 0.8.2 still resumes.
// CHANGED ACCEPTED, as a ONE-ROW DELTA in this test and NOT in the fixture (red triage, C&C thcmcp-cd 23 Okt 2026: the 6ee1946 golden is never overwritten). OLD: every row of the golden. NEW: the golden, except mock-dispute's `dispute` USER-prompt hash (OLD 36cc5ccf..., NEW 810cce33...). WHY: 6f03fe0 (20 Okt, lab identity 3b) made the dispute prompt's "Raised by:" line name the seat's MODEL (system hash unchanged); Muad 20 Okt 02:38 (FOCUS-detail, AMENDED): "Yes of course it should say the model", shipped reviser prompts change, pins re-recorded under this yes; CHANGELOG.md:9 says so. 6f03fe0 re-recorded test/prompt-pin.test.js, not this fixture. A paused run from before 6f03fe0 runs its dispute stage again on resume (run sheet line 22). The delta asserts that the OLD row is present exactly once, so it cannot go stale in silence.
const EXPECTED = structuredClone(golden.chains);
{
  const row = 'dispute 190ad43df0237f40db1a7ebbfebc0a784304611f78118b33d404deaa72adbaa9 36cc5ccf115f358f54f978192e9a0221c6ae4b543368ed0a1607615090f58f57';
  assert.equal(EXPECTED['mock-dispute'].filter(r => r === row).length, 1, 'the delta replaces exactly one golden row');
  EXPECTED['mock-dispute'] = EXPECTED['mock-dispute'].map(r => (r === row ? row.replace('36cc5ccf115f358f54f978192e9a0221c6ae4b543368ed0a1607615090f58f57', '810cce33df1969cf33877574ed9d216fb3050a52bf5280951405da68b3fb1a79') : r));
}
const WORDS = { treeSplitWriterNote: H.treeSplitWriterNote, treeSplitHandoffNote: H.treeSplitHandoffNote };
afterEach(() => { setHeldForTest(null); setPromptSpy(null); });

// FLIPPED AT THE APPLY (decider-readiness apply patch, C&C thcmcp-cd 24 Okt 2026: 'tree-split-prompts is FLIPPED, not deleted'; the 11 held prompts JOIN the 0.8.3 wording review, Muad 24 Okt 2026: "Yes, to the 11 written prompts for 0.8.3"; the final yes on the words is lane A's to record [PLACEHOLDER]). OLD: the test asserted that both words were NOT in src/roles.js (the M7 note said it is deleted there). NEW: it asserts they ARE recorded, are functions, and render exactly as drafted (the drafted file is the reference), with no injection. WHY: the words are recorded in src/roles.js, so the held state no longer ships.
test('the 0.8.3 split-block words are recorded in src/roles.js and render exactly as drafted; held() returns them with no injection', () => {
  assert.equal(typeof R.treeSplitWriterNote, 'function'); assert.equal(typeof R.treeSplitHandoffNote, 'function');
  assert.equal(R.treeSplitWriterNote(), H.treeSplitWriterNote()); assert.equal(R.treeSplitHandoffNote(), H.treeSplitHandoffNote());
  assert.equal(held('treeSplitWriterNote'), R.treeSplitWriterNote); assert.equal(held('treeSplitHandoffNote'), R.treeSplitHandoffNote);
});

test('a run that is NOT a tree member sends prompts byte-identical to 6ee1946\'s (a prompt is the stage cache key, so an old run still resumes), whether or not the 0.8.3 words are injected', async () => {
  assert.equal(golden.commit, '6ee1946');
  assert.deepEqual((await promptHashes({ repoRoot: root })).mock, EXPECTED.mock);
  assert.deepEqual(await promptHashes({ repoRoot: root }), EXPECTED, 'five mock chains: criteria, proposals, debate, build, review, revise, dispute, handoff');
  setHeldForTest(WORDS);
  assert.deepEqual(await promptHashes({ repoRoot: root }), EXPECTED, 'with the words injected, a non-member still never asks for them');
});

// FLIPPED AT THE APPLY (decider-readiness apply patch, C&C thcmcp-cd 24 Okt 2026: 'tree-split-prompts is FLIPPED, not deleted'; the 11 held prompts JOIN the 0.8.3 wording review, Muad 24 Okt 2026: "Yes, to the 11 written prompts for 0.8.3"; the final yes on the words is lane A's to record [PLACEHOLDER]). OLD: a tree member's prompts were byte-identical to 6ee1946's while the words were held. NEW: with the words recorded, ONLY a member's build, revise and handoff system prompts differ from 6ee1946's (the split note is appended), and no user prompt and no other stage does. WHY: the words are recorded in src/roles.js, so the held state no longer ships.
test('a tree member with the words recorded: only its build, revise and handoff system prompts differ from 6ee1946\'s; every user prompt and every other stage is identical', async () => {
  const got = await promptHashes({ repoRoot: root, extra: { treeMember: true } });
  const bad = [];
  for (const [chain, rows] of Object.entries(EXPECTED)) {
    const by = rs => new Map(rs.map(r => { const [label, sys, user] = r.split(' '); return [label, { sys, user }]; }));
    const want = by(rows), have = by(got[chain]);
    if ([...want.keys()].join() !== [...have.keys()].join()) { bad.push(`${chain}: the stage labels differ`); continue; }
    for (const [label, w] of want) {
      const h = have.get(label); const must = label === 'build' || label === 'handoff'; const may = label.startsWith('revise-');   // a chain's revise stage may take a path that adds no note (chain `mock`); mock-debate's is pinned below
      if (h.user !== w.user) bad.push(`${chain}/${label}: the USER prompt changed`);
      if (must && h.sys === w.sys) bad.push(`${chain}/${label}: system prompt does not carry the note`);
      if (!must && !may && h.sys !== w.sys) bad.push(`${chain}/${label}: system prompt changed although it should not`);
      if (chain === 'mock-debate' && may && h.sys === w.sys) bad.push(`${chain}/${label}: the reviser of a tree member does not carry the note`);
    }
  }
  assert.deepEqual(bad, []);
});

// NEW at the apply (C&C thcmcp-cd 24 Okt 2026): the mock provider writes the split block itself, so nothing else shows that a REAL model is told the format. This reads the system prompts a tree member sends, with NO injection.
test('SM-1 a tree member\'s builder and reviser are told the split-block format (the marker is in their system prompts); a run that is not a member is never told', async () => {
  const config = JSON.parse(readFileSync(join(root, 'chains', 'mock-debate.json'), 'utf8'));
  const collect = async treeMember => {
    const seen = new Map();
    setPromptSpy(p => seen.set(p.label, p.system));
    try { await runChain({ request: 'Plan a small reading list app with login and a shared shelf.', config, runId: 'r-sm1', log: () => {}, treeMember }); } finally { setPromptSpy(null); }
    return seen;
  };
  const MARKER = SPLIT_MARKER;   // the harness's own constant (src/tree-split.js), never a typed string
  const member = await collect(true), plain = await collect(false);
  assert.ok(member.get('build').includes(MARKER), 'the builder of a tree member is told the format');
  const revisers = [...member].filter(([l]) => l.startsWith('revise-'));
  assert.ok(revisers.length > 0 && revisers.every(([, s]) => s.includes(MARKER)), 'and so is every reviser round');
  assert.equal([...plain.values()].some(s => s.includes(MARKER)), false, 'a run that is not a tree member is never told');
});

test('door: with the drafted words injected, a tree member\'s builder, reviser and handoff prompts end with them, after the unchanged prompt; every other prompt, and every user prompt, is unchanged', async () => {
  const config = JSON.parse(readFileSync(join(root, 'chains', 'mock-debate.json'), 'utf8'));
  const collect = async treeMember => {
    const seen = new Map();
    setPromptSpy(p => seen.set(p.label, { system: p.system, user: p.user }));
    try { await runChain({ request: 'Plan a small reading list app with login and a shared shelf.', config, runId: 'r-door', log: () => {}, treeMember }); } finally { setPromptSpy(null); }
    return seen;
  };
  const base = await collect(false);
  setHeldForTest(WORDS);
  const member = await collect(true);
  assert.deepEqual([...member.keys()].sort(), [...base.keys()].sort());
  const writer = H.treeSplitWriterNote(); const handoff = H.treeSplitHandoffNote();
  const withNote = [];
  for (const [label, p] of member) {
    assert.equal(p.user, base.get(label).user, `${label}: the user prompt is unchanged`);
    if (label === 'build' || label.startsWith('revise-')) { assert.equal(p.system, `${base.get(label).system}\n\n${writer}`, `${label}: the writer's words follow the unchanged system prompt`); withNote.push(label); }
    else if (label === 'handoff') { assert.equal(p.system, `${base.get(label).system}\n\n${handoff}`); withNote.push(label); }
    else assert.equal(p.system, base.get(label).system, `${label}: not a prompt that carries the words`);
  }
  assert.ok(withNote.includes('build') && withNote.includes('handoff') && withNote.some(l => l.startsWith('revise-')), `build, a revise round and the handoff all carry them: ${withNote.join(', ')}`);
  assert.match(writer, /the-high-council:tree-split/); assert.match(handoff, /exactly once, unchanged/);
  assert.equal(/\b(better|best|improve|quality|more accurate|outperform)/i.test(writer + handoff), false, 'no efficacy wording');
});

// Through the REAL cli.js, in a process where the drafted words are injected (the seam is in-process, so a small script sets it, then imports the CLI): the CLI tells runChain whether the run is a tree member.
test('through the real CLI: a tree member\'s build and handoff prompts carry the drafted words; the same chain run without --tree-node does not', () => {
  const hook = (work, spyFile, args) => {
    const script = join(work, 'hook.mjs');
    writeFileSync(script, `import { writeFileSync } from 'node:fs';
import { setHeldForTest } from ${JSON.stringify(new URL('../src/held-roles.js', import.meta.url).href)};
import { setPromptSpy } from ${JSON.stringify(new URL('../src/chain.js', import.meta.url).href)};
import * as H from ${JSON.stringify(new URL('./held-prompts/held-083.js', import.meta.url).href)};
setHeldForTest({ treeSplitWriterNote: H.treeSplitWriterNote, treeSplitHandoffNote: H.treeSplitHandoffNote });
const seen = []; setPromptSpy(p => seen.push({ label: p.label, system: p.system }));
process.on('exit', () => writeFileSync(${JSON.stringify(spyFile)}, JSON.stringify(seen)));
process.argv = [process.argv[0], ${JSON.stringify(join(root, 'src', 'cli.js'))}, ...${JSON.stringify(args)}];
await import(${JSON.stringify(new URL('../src/cli.js', import.meta.url).href)});
`);
    return spawnSync(process.execPath, [script], { cwd: work, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: work }, timeout: 120_000 });
  };
  const writer = H.treeSplitWriterNote(); const handoff = H.treeSplitHandoffNote();
  const t = newTree({ cap: 10, rootChain: 'mock-debate' });
  registerRoot(t.rootDir);
  const memberSpy = join(t.work, 'member.json');
  const m = hook(t.work, memberSpy, ['--chain', 'mock-debate', '--task', 'tasks/x.md', '--run-id', ROOT_ID, '--tree-node', lineageFile(t.work, 'R')]);
  assert.equal(m.status, 0, m.stdout + m.stderr);
  const member = JSON.parse(readFileSync(memberSpy, 'utf8'));
  assert.ok(member.find(p => p.label === 'build').system.endsWith(`\n\n${writer}`), 'the builder of a tree member is asked');
  assert.ok(member.filter(p => p.label.startsWith('revise-')).every(p => p.system.endsWith(`\n\n${writer}`)) && member.some(p => p.label.startsWith('revise-')), 'and so is its reviser');
  assert.ok(member.find(p => p.label === 'handoff').system.endsWith(`\n\n${handoff}`), 'and its handoff seat');
  // `council handoff --from-run` on the (closed) member root: a post-run call, and the CLI tells handoffPrompt it is a member's
  const fromRunSpy = join(t.work, 'fromrun.json');
  const f = hook(t.work, fromRunSpy, ['handoff', '--from-run', join(t.runsDir, ROOT_ID), '--max-usd', '5']);
  assert.equal(f.status, 0, f.stdout + f.stderr);
  const fromRun = JSON.parse(readFileSync(fromRunSpy, 'utf8')).find(p => p.label === 'handoff-from-run');
  assert.ok(fromRun.system.endsWith(`\n\n${handoff}`), 'a member\'s handoff --from-run is asked too (the CLI passes hMeta.tree)');
  // the same chain, no lineage: not a tree member, nothing asked
  const w2 = mkdtempSync(join(tmpdir(), 'thc-notree-')); writeFileSync(join(w2, 'x.md'), 'Plan a tiny change.\n');
  const plainSpy = join(w2, 'plain.json');
  const p = hook(w2, plainSpy, ['--chain', 'mock-debate', '--task', 'x.md', '--run-id', '2026-10-08T12-00-00-000Z']);
  assert.equal(p.status, 0, p.stdout + p.stderr);
  const plain = JSON.parse(readFileSync(plainSpy, 'utf8'));
  assert.ok(plain.length > 3);
  assert.equal(plain.some(x => x.system.includes('the-high-council:tree-split')), false, 'a run that is not a tree member is never asked');
  const plainFrom = hook(w2, join(w2, 'plain-from.json'), ['handoff', '--from-run', join(w2, 'runs', '2026-10-08T12-00-00-000Z'), '--max-usd', '5']);
  assert.equal(plainFrom.status, 0, plainFrom.stdout + plainFrom.stderr);
  assert.equal(JSON.parse(readFileSync(join(w2, 'plain-from.json'), 'utf8')).some(x => x.system.includes('the-high-council:tree-split')), false, 'nor is a handoff --from-run of a run that is not a tree member');
});

test('handoffPrompt (the one place the handoff prompts are built, for a run and for `council handoff --from-run`): the held note is appended for a tree member only, to either shape of prompt, and the user prompt never changes', () => {
  const args = { request: 'Req', draft: 'The plan.', planFile: 'PLAN.md', checks: '', criteria: ['A', 'B'] };
  const plain = handoffPrompt({ config: {}, ...args });
  // FLIPPED AT THE APPLY (decider-readiness apply patch): OLD 'while held, a member gets what everyone gets'; NEW the recorded note is appended for a member (checked below against the recorded function); WHY the words are recorded.
  setHeldForTest(null);
  assert.equal(handoffPrompt({ config: {}, ...args, treeMember: true }).system, `${plain.system}\n\n${R.treeSplitHandoffNote()}`, 'recorded: a member gets the note');
  setHeldForTest(WORDS);
  assert.deepEqual(handoffPrompt({ config: {}, ...args }), plain, 'a non-member never asks');
  const member = handoffPrompt({ config: {}, ...args, treeMember: true });
  assert.equal(member.system, `${plain.system}\n\n${H.treeSplitHandoffNote()}`); assert.equal(member.user, plain.user);
  const withMilestones = handoffPrompt({ config: { handoff_contract: { milestones: true } }, ...args, treeMember: true });
  assert.ok(withMilestones.system.endsWith(`\n\n${H.treeSplitHandoffNote()}`), 'the milestone shape of the prompt (once recorded) carries it too');
});
