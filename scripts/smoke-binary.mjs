#!/usr/bin/env node
// Smoke test for a packaged council binary: "it built" is not "it runs" (see CHANGELOG, binary
// packaging). Runs from an empty directory so nothing from the repo can leak in, and checks:
//   1. `council demo` exits 0 and prints the deliverable, debate board and handoff.
//   2. `council --mcp` answers initialize, tools/list, list_chains (reads the bundled chains),
//      and dry_run (re-invokes the binary itself - the path that broke silently before).
// Usage: node scripts/smoke-binary.mjs <binary> [runner]   e.g. runner = wine for the .exe
// $0, offline: the demo uses the mock provider and dry_run calls no model.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const [binArg, runner] = process.argv.slice(2);
if (!binArg) { console.error('usage: smoke-binary.mjs <binary> [runner]'); process.exit(2); }
const bin = resolve(binArg);
const cmd = (args) => runner ? [runner, [bin, ...args]] : [bin, args];
const dir = mkdtempSync(join(tmpdir(), 'council-smoke-'));
const failures = [];
const check = (ok, what) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failures.push(what); };

// Output goes to files, not pipes, for the CLI half: under Wine, Node's stdio color detection
// throws EBADF on a pipe (a Wine console quirk, not a packaging bug - see CHANGELOG).
const outFile = join(dir, 'demo.out');
const demo = spawnSync('sh', ['-c', `"$0" "$@" > "${outFile}" 2>&1`, ...cmd(['demo']).flat()], { cwd: dir, timeout: 120_000 });
const demoOut = spawnSync('cat', [outFile], { encoding: 'utf8' }).stdout;
check(demo.status === 0, `demo exits 0 (got ${demo.status})`);
for (const marker of ['DELIVERABLE', 'DEBATE BOARD', 'HANDOFF']) check(demoOut.includes(marker), `demo prints ${marker}`);

// The MCP half is one batch: every request written to a file, fed on stdin, stdout captured to a
// file, then matched by id. Not an interactive pipe session, for the same Wine reason as above -
// under Wine a live stdin pipe never delivers, while the identical requests from a file answer.
// Request order is response order here: the server handles stdin lines in sequence.
const requests = [
  { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'smoke', version: '0' } } },
  { jsonrpc: '2.0', method: 'notifications/initialized' },
  { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
  { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'list_chains', arguments: {} } },
  { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'dry_run', arguments: { chain: 'verify' } } },
  { jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'start_run', arguments: { chain: 'mock', task: 'task.md' } } },
];
writeFileSync(join(dir, 'task.md'), 'A smoke-test task.\n');
const inFile = join(dir, 'mcp.in');
const mcpOutFile = join(dir, 'mcp.out');
writeFileSync(inFile, requests.map(r => JSON.stringify(r)).join('\n') + '\n');
spawnSync('sh', ['-c', `"$0" "$@" < "${inFile}" > "${mcpOutFile}" 2>/dev/null`, ...cmd(['--mcp']).flat()], { cwd: dir, timeout: 120_000 });
const byId = new Map(readFileSync(mcpOutFile, 'utf8').split('\n').flatMap(line => {
  try { const m = JSON.parse(line); return m.id === undefined ? [] : [[m.id, m]]; } catch { return []; } // non-JSON stdout noise is ignored
}));
const textOf = id => byId.get(id)?.result?.content?.[0]?.text || '';
check(byId.get(1)?.result?.serverInfo?.name === 'the-high-council', 'mcp initialize');
const names = (byId.get(2)?.result?.tools || []).map(t => t.name);
check(['list_chains', 'dry_run', 'start_run'].every(n => names.includes(n)), 'mcp tools/list has list_chains, dry_run, start_run');
check(textOf(3).includes('"mock"'), 'mcp list_chains reads the bundled chains');
check(!byId.get(4)?.result?.isError && /TOTAL/.test(textOf(4)), 'mcp dry_run re-invokes the binary and prices a chain');
if (!/TOTAL/.test(textOf(4))) console.log(textOf(4).slice(0, 600));
check(!byId.get(5)?.result?.isError && textOf(5).includes('"started": true'), 'mcp start_run spawns a detached run');
if (byId.get(5)?.result?.isError) console.log(textOf(5).slice(0, 600));
// The detached run outlives the server; the mock chain finishes in seconds and writes report.json.
const runsDir = join(dir, 'runs');
let report = null;
for (let i = 0; i < 90 && !report; i++) {
  const found = existsSync(runsDir) && readdirSync(runsDir).map(d => join(runsDir, d, 'report.json')).find(existsSync);
  if (found) report = JSON.parse(readFileSync(found, 'utf8'));
  else await new Promise(r => setTimeout(r, 1000));
}
check(report?.chain === 'mock', 'the started mock run finishes with a report.json');
rmSync(dir, { recursive: true, force: true });

console.log(failures.length ? `\n${failures.length} check(s) failed` : '\nall checks passed');
process.exit(failures.length ? 1 : 0);
