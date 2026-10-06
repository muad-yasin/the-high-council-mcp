// Regenerates test/fixtures/stop/BOARD-partial-<cause>.md (0.8.1 plan M6, P20): one stopped advice run per cause, mock seats only,
// $0, no network. A run of the shipped mock council (four seats, a debate round, a synthesis seat) is stopped by a person's STOP and by
// a client's STOP while its blind calls are in flight (1.5 s mock calls), and by its wall clock inside the synthesis call (2 s calls,
// a 3x wall clock: the blind wave and the debate finish by about 2 calls' time, the synthesis call is cut at 3; 2 s calls leave
// under 2 s for process start-up and stage overhead under load before the shape changes). The fixed run id keeps the
// boards stable.
//   node scripts/stop-fixtures.mjs
import { spawn } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(root, 'src', 'cli.js');
const out = join(root, 'test', 'fixtures', 'stop');
const ID = '2026-10-03T06-00-00-000Z';
const sleep = ms => new Promise(r => setTimeout(r, ms));

export async function stoppedRun(cause, { id = ID, dir = mkdtempSync(join(tmpdir(), 'thc-stop-fixture-')) } = {}) {
  mkdirSync(join(dir, 'tasks'), { recursive: true });
  mkdirSync(join(dir, 'chains'), { recursive: true });
  writeFileSync(join(dir, 'tasks', 't.md'), '# Advice\n\nShould the note list keep ticked items or remove them?\n');
  let chain = 'mock-advise-standard';
  let delay = '1500';
  if (cause === 'wall_clock') {
    const c = JSON.parse(readFileSync(join(root, 'chains', 'mock-advise-standard.json'), 'utf8'));
    c.name = 'mock-wall-standard'; c.advise.max_wall_ms = 6000;
    writeFileSync(join(dir, 'chains', 'mock-wall-standard.json'), JSON.stringify(c));
    chain = 'mock-wall-standard'; delay = '2000';
  }
  const child = spawn(process.execPath, [cli, '--chain', chain, '--task', 'tasks/t.md', '--run-id', id], { cwd: dir, env: { PATH: process.env.PATH, HOME: dir, COUNCIL_MOCK_DELAY_MS: delay } });
  const exited = new Promise(r => child.on('exit', code => r(code)));
  const runDir = join(dir, 'runs', id);
  if (cause !== 'wall_clock') {
    const log = () => { try { return readFileSync(join(runDir, 'run.log'), 'utf8'); } catch { return ''; } };
    for (let i = 0; i < 200 && !/Stage: advice/.test(log()); i++) await sleep(50);
    writeFileSync(join(runDir, 'STOP'), `${JSON.stringify({ schema: 'stop/1', by: cause, run: id, at: '2026-10-03T06:00:01.000Z' })}\n`);
  }
  return { dir, runDir, code: await exited };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  mkdirSync(out, { recursive: true });
  for (const cause of ['user', 'client_cancel', 'wall_clock']) {
    const r = await stoppedRun(cause);
    if (r.code !== 18 || !existsSync(join(r.runDir, 'BOARD-partial.md'))) throw new Error(`${cause}: exit ${r.code}, no board`);
    copyFileSync(join(r.runDir, 'BOARD-partial.md'), join(out, `BOARD-partial-${cause}.md`));
    console.log(`wrote test/fixtures/stop/BOARD-partial-${cause}.md`);
  }
}
