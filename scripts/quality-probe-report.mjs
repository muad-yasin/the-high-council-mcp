#!/usr/bin/env node
// v5 §1 candidate 15, Phase 1: writes one run of the seeded-defect quality probe to its own
// timestamped folder under quality-probe-runs/ (deliberately a sibling of, not inside, runs/ -
// every src/ reader that walks runs/ for real chain runs, including the local UI's listRuns(),
// has no timestamp-shaped-ID filter guarding it from treating a foreign subfolder as a phantom
// run; a flat sibling directory makes that class of collision structurally impossible rather
// than relying on every current and future runs/-scanner remembering to skip it) - never to
// report.json, spend_report, verdict_stats, or any other runtime surface. Publishing the
// resulting file anywhere is a separate, deliberate human act each time; this script only ever
// writes locally.
//
// See test/quality-probe/README.md before reading or sharing summary.json - it names exactly
// what this number does and does not mean, and the sentence it must never be quoted as.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runQualityProbe } from '../test/quality-probe/probe.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const runDir = join(root, 'quality-probe-runs', stamp);
mkdirSync(runDir, { recursive: true });

const result = runQualityProbe();
writeFileSync(join(runDir, 'summary.json'), JSON.stringify(result, null, 2));

console.log(`Seeded-defect quality probe (Phase 1) - internal-only, see test/quality-probe/README.md\n`);
console.log(`fixtures:  ${result.fixtureCount}`);
console.log(`defects:   ${result.defectTypes.join(', ')}`);
console.log(`catch-rate (majority right):  ${(result.overall.catchRate * 100).toFixed(0)}%`);
console.log(`unanimity  (panel agreed):    ${(result.overall.unanimityRate * 100).toFixed(0)}%`);
console.log(`\n${result.caveat}\n`);
console.log(`Full detail written to ${join(runDir, 'summary.json')} - that file, not this printout, is the record.`);
