// Two (or more) real Node PROCESSES that act on the same tree at the same moment (budget commit 0/1: admissions and amendments). Each worker loads the library, prints READY, spins on a start barrier (a file the test writes
// once every worker is ready), performs ONE operation and prints one JSON line: { ok: true } or { ok: false, name, code }. Not a test file.
import { spawn } from 'node:child_process';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const SRC = resolve(import.meta.dirname, '..', '..', 'src');
const srcUrl = name => pathToFileURL(join(SRC, name)).href;

const WORKER = `
import { existsSync } from 'node:fs';
const [, go, job] = process.argv; const j = JSON.parse(job);       // with node -e there is no script path in argv
const { registerChildAdmitted } = await import(${JSON.stringify(srcUrl('tree-register.js'))});
const { topUp, amendCap } = await import(${JSON.stringify(srcUrl('tree-budget.js'))});
process.stdout.write('READY\\n');
while (!existsSync(go)) { /* a start barrier: every worker leaves it together */ }
let out;
try {
  if (j.kind === 'register') registerChildAdmitted(j.rootDir, j.child);
  else if (j.kind === 'amend') amendCap(j.rootDir, j.amend);
  else topUp(j.rootDir, j.top);
  out = { ok: true };
} catch (e) { out = { ok: false, name: e.name, code: e.code ?? null }; }
process.stdout.write(JSON.stringify(out) + '\\n');
`;

/** Starts one worker per job ({ kind: 'register' | 'topup' | 'amend', rootDir, child | top | amend }). -> { ready: [Promise per worker], results: [Promise per worker -> its JSON answer] }. */
export function runWorkers(jobs, goFile) {
  const ready = []; const results = [];
  for (const job of jobs) {
    let markReady; ready.push(new Promise(r => { markReady = r; }));
    results.push(new Promise((res, rej) => {
      const p = spawn(process.execPath, ['--input-type=module', '-e', WORKER, goFile, JSON.stringify(job)], { stdio: ['ignore', 'pipe', 'pipe'] });
      let out = ''; let err = ''; let seen = false;
      p.stdout.on('data', d => { out += d; if (!seen && out.includes('READY')) { seen = true; markReady(); } });
      p.stderr.on('data', d => { err += d; });
      p.on('error', rej);
      p.on('close', code => { const line = out.split('\n').filter(l => l.startsWith('{')).at(-1); code === 0 && line ? res(JSON.parse(line)) : rej(new Error(`worker exited ${code}: ${err || out}`)); });
    }));
  }
  return { ready, results };
}
