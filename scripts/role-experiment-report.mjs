#!/usr/bin/env node
// v6 role-seat plan §5 (phase 4 measurement harness): writes one run of the four-arm role-
// conditioning experiment to its own timestamped folder under role-experiment-runs/ - a sibling
// of, not inside, runs/, for the exact same reason quality-probe-runs/ is a sibling (see
// scripts/quality-probe-report.mjs's own header comment): no runtime runs/-scanner should ever
// be able to mistake this for a real chain run. Never writes to report.json, spend_report,
// verdict_stats, or any other runtime surface.
//
// This script does not "run the experiment" against a live council - there is no live seat-role
// mechanism to run against yet (phases 1-3). It runs this harness's own offline mock-seat model
// against the checked-in v5 fixtures, which is a legitimate, repeatable thing to do at any time
// (it is exactly what `npm test` already does) - it is NOT the phase-4 gate decision, which needs
// phases 1-3 to exist first per handoff.md. Read test/quality-probe/role-experiment.js and
// test/quality-probe/README.md before reading or sharing summary.json.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runRoleExperiment, summarize } from '../test/quality-probe/role-experiment.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const runDir = join(root, 'role-experiment-runs', stamp);
mkdirSync(runDir, { recursive: true });

const result = runRoleExperiment();
writeFileSync(join(runDir, 'summary.json'), JSON.stringify(result, null, 2));

console.log('Role-conditioning experiment (phase 4 measurement harness) - internal-only, see test/quality-probe/README.md and test/quality-probe/role-experiment.js\n');
console.log(`fixtures:   ${result.fixtureCount}`);
console.log(`defects:    ${result.defectTypeCount} types`);
console.log(`arms:       ${result.arms.map((a) => `${a} (${result.armLabels[a]})`).join('\n            ')}`);
console.log(`\n${summarize(result)}\n`);
console.log(`Full detail (every row, including any errored cell) written to ${join(runDir, 'summary.json')} - that file, not this printout, is the record.`);
