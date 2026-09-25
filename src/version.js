// The harness's own version, read from its package.json so `council --version` and the MCP
// server's serverInfo can't drift from the release again (the server said 0.3.0 while the
// package said 0.7.5; pre-release audit 2026-09-23, Packaging L1 / VersionConsistency #3).
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

let cached;
function pkgJson() {
  if (cached === undefined) {
    try {
      cached = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json'), 'utf8'));
    } catch {
      cached = {};
    }
  }
  return cached;
}
export function harnessVersion() {
  return pkgJson().version || 'unknown';
}
// report.json's `producer` (0.7.7, brief 03 fix 6): which package, at which version, wrote the file.
export function harnessProducer() {
  return { name: pkgJson().name || 'the-high-council', version: harnessVersion() };
}
