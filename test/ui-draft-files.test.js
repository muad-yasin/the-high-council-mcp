// BUG-D-022: the run viewer listed every file named revise-* as a draft, so the per-stage
// `revise-N.usage.json` and `revise-N.prompt.json` records showed up as drafts (an extra column in
// the Revisions table, and the Outline tab could open on a JSON record). Only build.md,
// revise-<N>.md, revise-<N>-full.md and final.md are drafts, in the order they were written.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { request } from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const server = resolve(here, '../src/ui/server.js');

function get(port, path) {
  return new Promise((ok, fail) => {
    const req = request({ host: '127.0.0.1', port, path, headers: { host: `127.0.0.1:${port}` } }, res => {
      let body = '';
      res.on('data', d => { body += d; });
      res.on('end', () => ok({ status: res.statusCode, body }));
    });
    req.on('error', fail);
    req.end();
  });
}

test('run viewer: only draft files are listed as drafts, usage and prompt records are not', async () => {
  const work = mkdtempSync(join(tmpdir(), 'thc-drafts-'));
  const id = '2026-01-01T00-00-00-000Z';
  const dir = join(work, 'runs', id);
  mkdirSync(dir, { recursive: true });
  // Written out of order on purpose; revise-10 would sort before revise-2 as text.
  for (const f of ['final.md', 'revise-2-full.md', 'revise-2.prompt.json', 'revise-2.md', 'revise-1.usage.json',
    'revise-1.md', 'build.usage.json', 'build.md', 'revise-10.md']) {
    writeFileSync(join(dir, f), f.endsWith('.json') ? '{"usage":{}}\n' : `# ${f}\n\nbody\n`);
  }
  const port = 20000 + Math.floor(Math.random() * 20000);
  const child = spawn(process.execPath, [server], { env: { ...process.env, PORT: String(port), COUNCIL_WORKDIR: work }, stdio: ['ignore', 'pipe', 'inherit'] });
  try {
    await new Promise((ok, fail) => {
      child.stdout.on('data', d => { if (String(d).includes('relay viewer')) ok(); });
      child.on('exit', code => fail(new Error(`viewer exited early (${code})`)));
    });
    const r = await get(port, `/api/runs/${id}`);
    assert.equal(r.status, 200);
    assert.deepEqual(JSON.parse(r.body).drafts.map(d => d.name),
      ['build.md', 'revise-1.md', 'revise-2.md', 'revise-2-full.md', 'revise-10.md', 'final.md']);
  } finally {
    child.kill();
    rmSync(work, { recursive: true, force: true });
  }
});
