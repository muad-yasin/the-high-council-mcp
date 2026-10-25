// D2 F18 (B16a) with D3's correction: a pinned chain file that is changed after the tree registered it gives a REFUSAL the sitting ends on (check 'chain', its message, and S13: put it back or abandon), never a thrown error that
// rejects `tree resume`. Two variants: a child chain at registration, and the root chain when an approved root re-plan registers. All-mock, $0; the chain files live in the working folder's chains/, where the CLI looks first.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { resumeHandler } from '../src/tree-resume.js';
import { readTreeRecord, stateOf } from '../src/tree-record.js';
import { trackedRealRoot } from './helpers/temp-trees.js';
import { pricedChildren } from './helpers/child-chains.js';
import { approvePending, draftStarter } from './helpers/sitting.js';
import { driveToDepthTwoReplan } from './helpers/depth-two-replan.js';
import { ROOT_ID } from './helpers/tree-fixture.js';

const edit = file => { const c = JSON.parse(readFileSync(file, 'utf8')); c.description = `${c.description ?? ''} (edited after the tree registered it)`; writeFileSync(file, JSON.stringify(c, null, 2)); };
const S13 = rootId => `Nothing was started: put the chain file back as the tree registered it, or end the tree with \`council tree decide ${rootId} --abandon\`.`;

test('T18 (F18, B16a): the child chain file edited after the approval -> the sitting ends refused (chain) with the chain message and S13, exit 1, nothing registered, no thrown error', { timeout: 400_000 }, async () => {
  const r = await trackedRealRoot(pricedChildren());
  approvePending(r);
  edit(join(r.t.work, 'chains', 'priced-debate.json'));
  const out = new PassThrough(); const err = new PassThrough(); const buf = []; out.on('data', d => buf.push(String(d))); err.on('data', d => buf.push(String(d)));
  const code = await resumeHandler({ rootDir: r.t.rootDir, rootId: ROOT_ID, work: r.t.work, stdout: out, stderr: err, deps: { startRun: draftStarter(r) } });
  const text = buf.join('');
  assert.equal(code, 1, text);
  assert.match(text, /was not registered \(chain\): the chain file priced-debate\.json is not the one the tree registered \(sha256 differs\)/, text);
  assert.ok(text.includes(S13(ROOT_ID)), text);
  assert.equal([...stateOf(readTreeRecord(r.t.rootDir)).nodes.keys()].some(k => k !== 'R@g1'), false, 'nothing below the root was registered');
});

test('T18 root variant (D3 F18 correction): the ROOT chain edited after a root re-plan was approved -> the sitting ends refused (chain) with S13, exit 1, R@g2 not registered, no thrown error', { timeout: 900_000 }, async () => {
  const S = await driveToDepthTwoReplan();
  const a = await S.approve(); assert.equal(a.code, 0, a.text);
  edit(join(S.work, 'chains', 'depth2-root.json'));
  const r = await S.sit();
  assert.equal(r.code, 1, r.text);
  assert.match(r.text, /R was not registered \(chain\): the root chain cannot be read: the chain file depth2-root\.json is not the one the tree registered/, r.text);
  assert.ok(r.text.includes(S13(S.rootId)), r.text);
  assert.equal(S.state().nodes.has('R@g2'), false);
});
