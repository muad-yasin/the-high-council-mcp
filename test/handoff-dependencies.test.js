// The handoff seat is asked to list the dependencies the plan names (0.8.3; owner 18 Okt 2026: "Yes to the two slices as you suggested", "OK as written", "the broader version"; brief
// Review/Build_0.8.3/m7/Brief_A_DependencyList_2026-10-18.md). The paragraph is APPROVED text, word for word. It lists and asks; nothing looks anything up. The mock provider ignores prompt text, so this file shows what is SENT, never what a model does with it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as R from '../src/roles.js';
import { handoffPrompt } from '../src/handoff-prompt.js';
import { parseMilestones, lintMilestones } from '../src/milestones.js';
import { treeSplitHandoffNote } from './held-prompts/held-083.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const norm = s => s.replace(/\s+/g, ' ').trim();
// the approved paragraph, as the owner approved it (typed here once; the comparison ignores line breaks)
const APPROVED = 'If the plan has the build session install or download anything (a package, library, plugin, MCP server, container image, install script or CI action), end the handoff with a section "Dependencies to verify". List one line per item, using only what the plan itself names: `name (what kind, version): why the plan needs it`. Copy the name and the version exactly as the plan writes them. If the plan gives no version, write "version not stated in the plan". Never supply a name or a version yourself. For every choice the plan leaves open ("a markdown parser"), write one line saying the build session must verify whatever it picks. Then tell the session: before it installs or downloads any item, it checks that the exact name exists, that it is the one the plan means, and that it is not a near-copy of a better-known name. If it cannot check, it stops and asks the person. It never treats this list as already checked. If the plan names nothing to install, write "Dependencies to verify: none named in the plan." This section does not count toward the word limit.';
const cases = [
  ['plain run', { config: {}, request: 'r', draft: 'd', criteria: ['A'] }],
  ['milestones (handoff_contract.milestones)', { config: { handoff_contract: { milestones: true } }, request: 'r', draft: 'd', criteria: ['A'] }],
  // NOT a different prompt today (C&C fix-up 18 Okt 2026): handoffPrompt adds the split note only when `treeSplitHandoffNote` is recorded in src/roles.js, and it is still held test data (test/held-prompts/held-083.js), so this case is the plain
  // prompt again. It stays to catch the day the note is recorded (HD-5 shows the two instructions together now, with the held note appended the way handoffPrompt does).
  ['treeMember flag (the split note is still held, so this equals the plain run)', { config: {}, request: 'r', draft: 'd', criteria: ['A'], treeMember: true }],
];

const ANCHOR = 'If the request contains an "Available tools"';
test('HD-1: the approved paragraph is in the handoff system prompt of the plain run, the milestone run and the treeMember call, word for word, after the Available-tools paragraph', () => {
  for (const [name, args] of cases) assert.ok(norm(handoffPrompt(args).system).includes(norm(APPROVED)), `${name}: the approved paragraph is missing or changed`);   // first: a path that lacks it is named as lacking it
  for (const [name, args] of cases) {
    const sys = norm(handoffPrompt(args).system);
    const at = sys.indexOf(ANCHOR);
    assert.notEqual(at, -1, `${name}: the Available-tools anchor is found (a missing anchor would make the order check pass on its own)`);
    assert.ok(at < sys.indexOf('If the plan has the build session install'), `${name}: after the Available-tools paragraph`);
  }
});

test('HD-2: the two paths cannot drift: HANDOFF_SYSTEM and handoffSystem({ milestones: true }) end with the same text (the tools paragraph and the dependency paragraph), and the plain path is HANDOFF_SYSTEM itself', () => {
  const from = R.HANDOFF_SYSTEM.indexOf(ANCHOR);
  assert.notEqual(from, -1, 'the anchor is found (slice(-1) would make endsWith pass on its own)');
  const tail = R.HANDOFF_SYSTEM.slice(from);
  assert.ok(R.handoffSystem({ milestones: true }).endsWith(tail));
  assert.equal(R.handoffSystem({ milestones: false }), R.HANDOFF_SYSTEM);
});

// DOCUMENTATION, not evidence (C&C fix-up 18 Okt 2026): this reads the test's own APPROVED constant, so it cannot fail against src; HD-1 is what ties that constant to src/roles.js. It records what the approved words leave out.
test('HD-3 (documentation only): nothing in the paragraph names a tool, a command or a registry to call: the list is outside the harness (no network, no new command)', () => {
  const p = norm(APPROVED);
  for (const word of ['npm ', 'pip ', 'curl', 'http', 'registry lookup', 'council ']) assert.equal(p.includes(word), false, word);
});

test('HD-4 (README): the Known limits section says the handoff lists the dependencies and does not check them; the CHANGELOG says it lists and asks', () => {
  const readme = readFileSync(join(root, 'README.md'), 'utf8');
  const at = readme.indexOf('## Known limits, stated plainly');
  const limits = readme.slice(at, readme.indexOf('\n## ', at + 10));
  assert.match(limits, /The handoff lists the dependencies the plan names; it does not check them\./);
  assert.match(readFileSync(join(root, 'CHANGELOG.md'), 'utf8'), /It lists and asks; it does not look anything up/);
});

test('HD-5: with the held split note appended the way handoffPrompt does, the handoff system prompt carries the dependency paragraph AND the split-block instruction, and the paragraph comes first', () => {
  const sys = handoffPrompt({ config: {}, request: 'r', draft: 'd', criteria: ['A'] }).system;
  const withNote = `${sys}\n\n${treeSplitHandoffNote()}`;   // handoffPrompt's own withNote, with the held function from test data (not recorded in src/roles.js yet)
  const n = norm(withNote);
  const dep = n.indexOf(norm(APPROVED)); const split = n.indexOf('## The split block');
  assert.ok(dep !== -1 && split !== -1, 'both instructions are present');
  assert.ok(dep < split, 'the dependency paragraph comes before the split note');
  // they do not compete for "the end": the split block is a fenced block copied anywhere in the handoff; the dependency instruction is about a final SECTION
  assert.match(n, /Copy that block into the handoff exactly once/);
});

// The milestone parser (src/milestones.js) bounds the milestones section at the next `## ` heading and reads milestone blocks from `###`/`####` headings. The approved paragraph says only "end the handoff with a section"; the mock ignores prompt
// text, so this row shows what the REAL parser does with each shape a model might write (C&C fix-up 18 Okt 2026). Result at the time of writing: for milestones that END ON an `Exit:` line (the fixture below) every shape parses as the plain handoff does; the other ending is HD-7.
const MS = `Status: ready_for_build

## Milestones

### M1 - Parser
Entry: nothing
Work: write the parser
Exit: it parses
- check: C1 | feed a file => it parses
- discharges: C1

### M2 - Writer
Entry: M1
Work: write the writer
Exit: it writes
- check: C1 | write a file => it exists
- discharges: C1
`;
const LIST = '- lodash (library, 4.17.21): the plan needs a deep clone\n- a markdown parser (choice left open): the build session must verify whatever it picks\n\nBefore it installs anything the session checks the exact name exists.\n';
const shape = t => { const r = parseMilestones(t); return JSON.stringify({ ids: r.milestones.map(m => m.id), checks: r.milestones.map(m => m.checks.length), disch: r.milestones.map(m => m.discharges.length), work: r.milestones.map(m => m.work), checklist: r.checklist, findings: lintMilestones({ text: t, criteriaIds: ['C1'] }).findings }); };
test('HD-6: a "Dependencies to verify" section after the milestones (as a ## heading, a ### heading, a bold line, or after the Final checklist) leaves the milestones, their checks and the lint exactly as without it; a list shaped like a milestone heading would not (known-bad control)', () => {
  const plain = shape(MS);
  assert.equal(JSON.parse(plain).findings.length, 0, 'the plain handoff lints clean');
  for (const [name, t] of [
    ['## heading', `${MS}\n## Dependencies to verify\n${LIST}`],
    ['### heading', `${MS}\n### Dependencies to verify\n${LIST}`],
    ['bold line', `${MS}\n**Dependencies to verify**\n${LIST}`],
    ['after the Final checklist', `${MS}\n## Final checklist\n- [ ] C1 holds\n\n### Dependencies to verify\n${LIST}`],
  ]) {
    const got = JSON.parse(shape(t)); const want = JSON.parse(plain);
    if (name === 'after the Final checklist') { assert.deepEqual(got.checklist, ['C1 holds'], name); want.checklist = got.checklist; }
    assert.deepEqual(got, want, name);
  }
  // known-bad control: the same list under a heading that LOOKS like a milestone becomes one more milestone, so this comparison can fail
  const bad = JSON.parse(shape(`${MS}\n### M3 - Dependencies to verify\n${LIST}`));
  assert.notDeepEqual(bad.ids, JSON.parse(plain).ids);
});

// REPORTED FINDING, current behaviour (not a promise, C&C to rule; advisor 18 Okt 2026): `Entry:` and `Work:` keep collecting the lines that follow them (src/milestones.js, the label loop). When the LAST milestone ends on a `Work:` line, a closing
// bold line or plain sentence ("**Dependencies to verify**" and its bullets) is appended to that milestone's `work` text. No extra milestone appears, the lint findings are the same as without the section, and nothing in src/ reads a milestone's `work`
// (tree-split, tree-member, tree-restore and cli.js read ids, titles and checks). A `##` or `###` heading is cut off before it gets there. This row pins what happens today so a change is a decision.
test('HD-7 (reported finding): a bold or plain "Dependencies to verify" after a last milestone that ends on Work: is appended to that milestone\'s work text; ids, checks and lint findings do not change', () => {
  const W = 'Status: ready_for_build\n\n## Milestones\n\n### M1 - Parser\nEntry: nothing\nWork: write the parser\n- check: C1 | feed a file => it parses\n- discharges: C1\n\n### M2 - Writer\nEntry: M1\nWork: write the writer\n';
  const plain = parseMilestones(W);
  for (const tail of ['\n**Dependencies to verify**\n' + LIST, '\nDependencies to verify:\n' + LIST]) {
    const r = parseMilestones(W + tail);
    assert.deepEqual(r.milestones.map(m => m.id), plain.milestones.map(m => m.id));
    assert.deepEqual(r.milestones.map(m => m.checks), plain.milestones.map(m => m.checks));
    assert.deepEqual(lintMilestones({ text: W + tail, criteriaIds: ['C1'] }).findings, lintMilestones({ text: W, criteriaIds: ['C1'] }).findings);
    assert.match(r.milestones[1].work, /Dependencies to verify/);          // swallowed into the last milestone's work text
    assert.equal(plain.milestones[1].work, 'write the writer');            // and absent without it: the control
  }
  for (const tail of ['\n## Dependencies to verify\n' + LIST, '\n### Dependencies to verify\n' + LIST]) assert.equal(parseMilestones(W + tail).milestones[1].work, 'write the writer');
});
