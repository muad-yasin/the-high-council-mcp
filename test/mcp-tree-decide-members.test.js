// CR-3B-001 (25 Okt 2026): `tree_decide` checked only the ROOT run folder, while `tree_status` checks EVERY member folder the tree's record registers ("0.8.2 item 2: every run folder a tool touches is a real folder with no symbolic link in it").
// A cloned project can ship a tree record that registers a member run id which is a symbolic link to a folder outside the project; tree_decide then read that member's plan through the link (O_NOFOLLOW guards only the last path component)
// and returned it to the agent. Now one shared check (src/mcp/tree-members.js) runs before ANY step, for every form. Offline, $0.
import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, readdirSync, renameSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { treeDecideResult } from '../src/mcp/tree-decide.js';
import { treeStatusResult } from '../src/mcp/tree-status.js';
import { memberFolderRefusal } from '../src/mcp/tree-members.js';
import { readTreeRecord, stateOf } from '../src/tree-record.js';
import { runTree } from '../src/tree-run.js';
import { ROOT_ID } from './helpers/tree-fixture.js';
import { trackedRealRoot } from './helpers/temp-trees.js';
import { needsDecisionChildren } from './helpers/child-chains.js';
import { approvePending, draftStarter } from './helpers/sitting.js';

const SENTINEL = 'OUTSIDE-PLAN-SENTINEL-LINE';
const FORMS = [
  { step: 'quote', form: 'regenerate', planMode: 'data', stop: 'e1', node: 'R/M1', reason: 'r' },
  { step: 'answer', form: 'regenerate', stop: 'e1', node: 'R/M1', reason: 'r', gate: 'g1', shown: 'a'.repeat(64) },
  { step: 'quote', form: 'frontier', reason: 'r' },
  { step: 'quote', form: 'price', model: 'x/y', inUsdPerM: 1, outUsdPerM: 2, source: 's', reason: 'r' },
  { step: 'defer', stop: 'e1', conditions: 'c', reason: 'r' },
  { step: 'draft', stop: 'e1', text: 'a draft', reason: 'r' },
];

test('TD-1 (CR-3B-001): a member folder that is a symbolic link ends EVERY tree_decide step, refused BEFORE the step, with the sentence tree_status uses; without the link the call goes on', async () => {
  const r = await trackedRealRoot(needsDecisionChildren()); approvePending(r);
  await runTree(r.t.rootDir, { work: r.t.work, maxStarts: 1, startRun: draftStarter(r) });
  const call = args => treeDecideResult({ runsDir: r.t.runsDir, work: r.t.work, args: { run: ROOT_ID, ...args } }).content[0].text;
  const refusalRe = id => new RegExp(`the tree's member run ${id} is not a folder this tool may read: .*symbolic link`);
  const member = readdirSync(r.t.runsDir).find(d => d !== ROOT_ID && /^\d{4}-/.test(d));
  assert.ok(member, 'a member run exists');
  for (const a of FORMS) assert.doesNotMatch(call(a), /member run .* not a folder this tool may read/, `without the link ${a.step}/${a.form ?? ''} is not refused for containment`);
  assert.equal(memberFolderRefusal(r.t.runsDir, readTreeRecord(join(r.t.runsDir, ROOT_ID))), null, 'the helper agrees: nothing to refuse');
  // the member becomes a link to a folder outside the project (what the step would read is TD-2's business: this row pins the refusal before every step, including the two that write)
  const outside = mkdtempSync(join(tmpdir(), 'thc-outside-run-')); mkdirSync(join(outside, 'x'));
  writeFileSync(join(outside, 'HANDOFF.md'), `## What this is\n${SENTINEL}\n`);
  renameSync(join(r.t.runsDir, member), join(r.t.runsDir, `${member}.orig`));
  symlinkSync(outside, join(r.t.runsDir, member));
  for (const a of FORMS) {
    const raw = call(a);
    assert.equal(raw.includes(SENTINEL), false, `${a.step}/${a.form ?? ''}: the text of a folder outside the project is not returned`);
    assert.match(JSON.parse(raw).error, refusalRe(member), `${a.step}/${a.form ?? ''}: refused before the step`);
  }
  // tree_status says the same sentence: one source
  assert.equal(JSON.parse(treeStatusResult({ runsDir: r.t.runsDir, run: ROOT_ID, work: r.t.work }).content[0].text).error, JSON.parse(call(FORMS[0])).error);
});

test('TD-2 (CR-3B-001, the leak itself): tree_decide quotes the earlier plan of a stopped member; when that member folder is a link to a copy outside the project it must NOT return that plan (red before: it read the plan through the link)', async () => {
  const r = await trackedRealRoot(needsDecisionChildren()); approvePending(r);
  await runTree(r.t.rootDir, { work: r.t.work, maxStarts: 1, startRun: draftStarter(r) });
  const st = stateOf(readTreeRecord(r.t.rootDir)); const stopId = st.openStops[0]; const meta = st.stopMeta.get(stopId);
  const call = args => JSON.parse(treeDecideResult({ runsDir: r.t.runsDir, work: r.t.work, args: { run: ROOT_ID, ...args } }).content[0].text);
  const quote = () => call({ step: 'quote', form: 'regenerate', planMode: 'data', stop: stopId, text: 'Plan it again with a smaller first step.', reason: 'the first step was too large' });
  const before = quote();
  assert.ok(before.text && before.text.includes('<earlier-plan>'), `precondition: the quote shows the earlier plan (${JSON.stringify(before).slice(0, 300)})`);
  const plan = before.text.split('<earlier-plan>')[1].split('</earlier-plan>')[0].trim();
  const marker = plan.split('\n').map(l => l.trim()).filter(l => l.length > 20).at(0);
  assert.ok(marker, 'precondition: the earlier plan has a line to look for');
  const member = readdirSync(r.t.runsDir).find(d => d !== ROOT_ID && /^\d{4}-/.test(d) && readdirSync(join(r.t.runsDir, d)).length);
  assert.ok(member && meta.node, 'a started member exists');
  // the member folder becomes a link to an exact copy outside the project (the copy the tree record was written for)
  const outside = mkdtempSync(join(tmpdir(), 'thc-outside-member-'));
  cpSync(join(r.t.runsDir, member), outside, { recursive: true });
  renameSync(join(r.t.runsDir, member), join(r.t.runsDir, `${member}.orig`));
  symlinkSync(outside, join(r.t.runsDir, member));
  const after = quote();
  assert.equal(JSON.stringify(after).includes(marker), false, 'the plan from outside the project is not returned');
  assert.match(after.error ?? '', new RegExp(`the tree's member run .* is not a folder this tool may read: .*symbolic link`), JSON.stringify(after).slice(0, 300));
});
