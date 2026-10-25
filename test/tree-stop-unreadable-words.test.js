// 0.8.3 M7 apply, group 6 fix-up (E74a): the second line of the sitting's "stop was not written" text names the file to restore with the real run ids, in pass-2's shape. Pure: the renderer is called with the three shapes of `files` the producers in src/tree-check.js build.
// A plan and a report of one run: pass-2's sentence with <runId> substituted. Reports only (the reason names the report of one or several nodes, there is no plan to name): B-DRAFT, "the report is ..." / "the reports are ...".
import test from 'node:test';
import assert from 'node:assert/strict';
import { renderIntegrationStopUnreadable } from '../src/tree-stop.js';

const second = files => renderIntegrationStopUnreadable({ agreement: 'A1', reason: 'the plan of R@g1 cannot be read', files, rootId: 'ROOT' }).split('\n')[1];
const HEAD = 'The failure stays recorded and the tree stays blocked. ';

test('E74a: a plan and a report of one run: "Restore the file named above (the plan is <run>/deliverable.md, the report <run>/report.json, in the runs folder)", then the resume command', () => {
  assert.equal(second(['RUN1/report.json', 'RUN1/deliverable.md']), `${HEAD}Restore the file named above (the plan is RUN1/deliverable.md, the report RUN1/report.json, in the runs folder), then run \`council tree resume ROOT\` again: the stop is written then.`);
});

test('E74a (B-DRAFT forms): the report of one node, the reports of several, and no readable path at all', () => {
  assert.equal(second(['RUN1/report.json']), `${HEAD}Restore the file named above (the report is RUN1/report.json, in the runs folder), then run \`council tree resume ROOT\` again: the stop is written then.`);
  assert.equal(second(['RUN1/report.json', 'RUN2/report.json']), `${HEAD}Restore the files named above (the reports are RUN1/report.json and RUN2/report.json, in the runs folder), then run \`council tree resume ROOT\` again: the stop is written then.`);
  assert.equal(second(['undefined/report.json']), `${HEAD}Restore what could not be read, then run \`council tree resume ROOT\` again: the stop is written then.`);
});
