// 0.8.2 audit fixes, Tier 1 item 4 (cnc-contract F1, F2, F3). Offline, $0.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, cpSync, existsSync, renameSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { checkContract, requestAmendment } from '../src/contract-record.js';
import { lintContractDraft } from '../src/contract-lint.js';
import { writeLocked, FIXTURE_DRAFT } from '../scripts/contract-fixtures.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const FIX = join(here, 'fixtures', 'contract');
const tmp = () => mkdtempSync(join(tmpdir(), 'audit-contract-'));
const copyRun = name => { const d = join(tmp(), name); cpSync(join(FIX, name), d, { recursive: true }); return d; };
const cli = join(here, '..', 'src', 'cli.js');
const council = (cwd, ...args) => spawnSync(process.execPath, [cli, ...args], { cwd, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: cwd } });

test('cnc-contract F1: a locked contract whose source hashes are non-null needs a readable thin_contract in report.json: missing file, unparseable file or no key is a failing check, never a pass', () => {
  const control = copyRun('run-v1');
  assert.equal(checkContract(control).exit, 0, 'the untouched fixture holds');
  const noKey = copyRun('run-v1'); const r = JSON.parse(readFileSync(join(noKey, 'report.json'), 'utf8')); delete r.thin_contract; writeFileSync(join(noKey, 'report.json'), JSON.stringify(r));
  const missing = copyRun('run-v1'); renameSync(join(missing, 'report.json'), join(missing, 'report.json.moved'));
  const garbled = copyRun('run-v1'); writeFileSync(join(garbled, 'report.json'), '{ not json');
  for (const [name, d] of [['no thin_contract key', noKey], ['report.json moved away', missing], ['report.json unparseable', garbled]]) {
    const c = checkContract(d);
    assert.equal(c.exit, 1, `${name}: ${c.lines.join(' | ')}`);
    assert.match(c.lines.join('\n'), /thin_contract|thin contract/i, name);
  }
});

test('cnc-contract F2: a lone surrogate is refused in a draft (text, check) and in an amendment request (reason, proposed_text); a well-formed emoji is fine', () => {
  const lone = '\ud83d';
  for (const field of ['text', 'check']) {
    const o = { id: 'O1', text: 'The export writes atomically.', check: 'node --test x', criterion: 'C1' }; o[field] = `bad ${lone} here`;
    const r = lintContractDraft({ obligations: [o] }, { criteriaIds: ['C1'] });
    assert.equal(r.ok, false, field);
    assert.match(r.problems.join('\n'), /well-formed|lone surrogate/i, field);
  }
  assert.equal(lintContractDraft({ obligations: [{ id: 'O1', text: 'The export writes atomically 😀 always.' }] }).ok, true);
  const d = join(tmp(), 'run-x'); writeLocked(d);
  const ask = over => requestAmendment(d, { version: 1, obligation_id: 'O2', reason: 'Because it is wrong.', proposed_text: 'Every error path prints one line.', ...over });
  assert.equal(ask({ reason: `r ${lone}` }).ok, false);
  assert.equal(ask({ proposed_text: `t ${lone}` }).ok, false);
  assert.equal(ask({ proposed_text: `t ${lone}` }).code, 'not_well_formed');
  assert.equal(ask({}).ok, true, 'a normal request still files');
});

test('cnc-contract F3: contract lock on a run with NO criteria refuses a draft that names a criterion (the draft side already did); a run with criteria still accepts its own', () => {
  const mk = criteria => {
    const work = tmp(); const run = join(work, 'runs', 'run-x'); mkdirSync(join(run, 'contract'), { recursive: true });
    writeFileSync(join(run, 'report.json'), JSON.stringify({ passed: true, criteria }));
    writeFileSync(join(run, 'contract', 'draft.json'), JSON.stringify(FIXTURE_DRAFT));
    return { work, run };
  };
  const none = mk([]);
  const r = council(none.work, 'contract', 'lock', 'runs/run-x');
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stderr, /no criterion C1/);
  assert.equal(existsSync(join(none.run, 'contract', 'v1.json')), false);
  const some = mk(['one', 'two']);
  const ok = council(some.work, 'contract', 'lock', 'runs/run-x');
  assert.notEqual(ok.status, 1, ok.stdout + ok.stderr);
});
