// SAME-LAYER SEATS, the run browser (0.8.4 seats unit; C&C item 7): the early-finish flag compares the SEAT, not the lab. plan-claude-council seats Opus 5.5 on layer 2 (key `opus5.5`) and on layer 3 (key `opus5.5-l3`); the overseer that said yes is the layer-3 seat,
// so only its reply file is labelled `early`, not the layer-2 Opus's in the same pass. Same harness as test/early-finish-readers.test.js ER-2 (the viewer is started on a scratch folder; no run, no key).
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { request } from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const server = resolve(dirname(fileURLToPath(import.meta.url)), '../src/ui/server.js');
const STOP = { kind: 'early_finish', pass: 2, overseer_round: 1, chosen: 'early', items: [], overseer: ['opus5.5'], overseer_seats: ['opus5.5-l3'] };

test('ES-1: the viewer labels the layer-3 seat\'s reply as the early answer and not the layer-2 reply of the same lab in that pass', async () => {
  const work = mkdtempSync(join(tmpdir(), 'thc-ef-seat-'));
  const id = '2026-01-01T00-00-00-000Z'; const dir = join(work, 'runs', id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'report.json'), JSON.stringify({ passed: false, stop: STOP, stages: [{ label: 'panel-2-opus5.5', lab: 'opus5.5' }, { label: 'panel-2-opus5.5-l3', lab: 'opus5.5', seat: 'opus5.5-l3' }] }));
  const ok = JSON.stringify({ meets: true, criteria: [], failures: [], verdict_line: 'ok' });
  writeFileSync(join(dir, 'panel-2-opus5.5.md'), ok); writeFileSync(join(dir, 'panel-2-opus5.5-l3.md'), ok);
  const port = 20000 + Math.floor(Math.random() * 20000);
  const child = spawn(process.execPath, [server], { env: { ...process.env, PORT: String(port), COUNCIL_WORKDIR: work }, stdio: ['ignore', 'pipe', 'inherit'] });
  try {
    await new Promise((res, fail) => { child.stdout.on('data', d => { if (String(d).includes('relay viewer')) res(); }); child.on('exit', c => fail(new Error(`viewer exited (${c})`))); });
    const body = await new Promise((res, fail) => { const r = request({ host: '127.0.0.1', port, path: `/api/runs/${id}`, headers: { host: `127.0.0.1:${port}` } }, x => { let b = ''; x.on('data', d => { b += d; }); x.on('end', () => res(b)); }); r.on('error', fail); r.end(); });
    const panels = JSON.parse(body).panels;
    const byFile = Object.fromEntries(panels[2].map(p => [p.file, p.early === true]));
    assert.deepEqual(byFile, { 'panel-2-opus5.5.md': false, 'panel-2-opus5.5-l3.md': true }, 'only the seat that said yes is labelled');
  } finally { child.kill(); rmSync(work, { recursive: true, force: true }); }
});
