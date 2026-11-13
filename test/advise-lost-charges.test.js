// 0.8.4 (his pick of 04 Nov 2026, "2: typical cost"; C&C via Mini-C&C, R181, "advice: C"): a 5xx attempt is a charge now, and a call that answered after one is returned by invoke() with `lostChargesUsd`, what its failed attempts were counted at
// (already in the run's spend and in charge files, NOT in the stage's `usd`); the real invoke() side is test/http5xx-resend.test.js.
// Pinned here: the field stays out of report.json (the stage is not a record of it; the charge files are).
// 0.8.4 (the add-on removal, wave 2): the first test of this file drove src/advise.js runAdvise with a fake invoke() to show that the advice add-on's own dollar ceiling counted the lost charges. src/advise.js is gone, so that test is removed with it; the report.json test below does not touch the add-on and stays.
import test from 'node:test';
import assert from 'node:assert/strict';
import { runChain, setCache, setBudget } from '../src/chain.js';
import { reportJsonShape } from '../src/report-shape.js';
import { readChainFile } from './helpers/chain-file.js';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

test('report.json: the stage\'s lostChargesUsd stays out of stages[] (the charge files are the record)', async () => {
  setCache(null); setBudget(null);
  const r = await runChain({ config: readChainFile(root, 'mock'), request: 'A request.', log: () => {} });
  assert.ok(r.stages.length > 0);
  r.stages[0].lostChargesUsd = 0.5;
  const rep = reportJsonShape({ runId: 'x', chain: 'mock', task: 't', result: r });
  assert.ok(rep.stages.length > 0 && rep.stages.every(s => !('lostChargesUsd' in s)), 'no stage row carries it');
});
