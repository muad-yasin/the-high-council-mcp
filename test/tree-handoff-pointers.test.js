// READ-B LB-9: section 5 of the tree handoff ("Pointers to the root constraints") names what each child of a verified split is GIVEN of the root task, through the one resolver (src/tree-context-refs.js): a bare reference, every
// exclusions section, or the whole file of a task with no heading that can hold the goal. When the root task does not read against its pin, the handoff says so and lists the references as the splits wrote them (no silent guess).
// Real verbs on all-mock trees ($0): realRoot runs the root and verifies its split.
import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gatherHandoffFacts, renderTreeHandoff } from '../src/tree-handoff.js';
import { trackedRealRoot } from './helpers/temp-trees.js';
import { block3, planWith } from './helpers/split-fixture.js';

const withRefs = refs => { const b = block3(); for (const c of b.children) c.context_refs = refs; return planWith(b, { preface: 'REVISED MOCK DELIVERABLE\n\n' }); };
const section5 = r => { const text = renderTreeHandoff(gatherHandoffFacts(r.t.rootDir, { work: r.t.work })); return text.slice(text.indexOf('## 5. '), text.indexOf('## 6. ')); };
const ALL = '`R@g1:M1`, `R@g1:M2`, `R@g1:M3`';

test('LB-9: a bare root reference and the supplied exclusions section are both pointed at; with the root task edited away from its pin the handoff says the pointers could not be derived and lists the references as written', { timeout: 400_000 }, async () => {
  const r = await trackedRealRoot({ task: '# Goal\nPlan a tiny change.\n\n# Non-goals\nNo mobile app.\n', plan: withRefs(['Goal', 'parent-plan: Overview']) });
  const s = section5(r);
  assert.ok(s.includes(`- root-task heading \`Goal\`, given to ${ALL}`), s);
  assert.ok(s.includes(`- root-task heading \`Non-goals\`, given to ${ALL}`), s);
  writeFileSync(join(r.t.work, 'tasks', 'x.md'), '# Goal\nPlan a bigger change.\n\n# Non-goals\nNo mobile app.\n');
  const edited = section5(r);
  assert.match(edited, /- What each smaller plan is given could not be derived \(.+\); the references as the splits wrote them:\n {2}- `Goal`, written by `R@g1:M1`, `R@g1:M2`, `R@g1:M3`\n {2}- `parent-plan: Overview`, written by /, edited);
  assert.equal(/root-task heading/.test(edited), false, edited);
});

test('LB-9: a task with no heading that can hold the goal is pointed at as the whole root task', { timeout: 400_000 }, async () => {
  const r = await trackedRealRoot();
  const s = section5(r);
  assert.ok(s.includes(`- the whole root task (it has no heading that can hold the goal), given to ${ALL}`), s);
  assert.equal(/no context_refs name a root-task section/.test(s), false, s);
});
