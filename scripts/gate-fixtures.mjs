// Writes the gate fixtures of test/fixtures/gate/ (0.8.1 plan M3, persistence register P4/P5) with the real
// gate code and a fixed clock, so they are byte-stable and test/gate-ledger.test.js can rebuild them and
// compare. Run: node scripts/gate-fixtures.mjs   (refuses if a target folder already exists; move the old
// one aside first).
//
//   run-ok/        two gates: g1 approved (then sent), g2 declined, then a stop. Verifies.
//   run-tampered/  run-ok with line 5 flipped from "declined" to "approved" (and gates/g2.json edited to
//                  match): what the chain is for. Line 5 still parses; line 6's prev no longer matches.
//   run-torn/      run-ok plus a last line a crash cut short (no newline). Verifies; the tail is ignored.
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { requestGate, answerGate, textSha256 } from '../src/gate.js';
import { appendEvent } from '../src/gate-ledger.js';

export const FIXTURE_T0 = Date.parse('2026-10-02T12:00:00.000Z');
const BRIEF = 'Should the cache key include the locale?\n\nContext: one server, two locales, a CDN in front.\n';
const OTHER = 'A second brief that the person declined.\n';

function clock() {
  let t = FIXTURE_T0;
  return () => (t += 1000);
}

function writeOk(dir) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'advice-brief.md'), BRIEF);
  writeFileSync(join(dir, 'advice-brief-2.md'), OTHER);
  const now = clock();
  const common = { kind: 'advice', price: { ceiling_usd: 0.75, expected_usd: 0.48 }, seats: [{ lab: 'openai', model: 'openai/gpt-6.1-sol', retention: 'ZDR-tagged by OpenRouter' }], sensitivity: { label: 'internal', set_by: 'operator' }, masks: { email: 1, path: 2 } };
  const ok = r => { if (!r.ok) throw new Error(`${r.code}: ${r.message}`); return r; };
  ok(requestGate(dir, { ...common, textPath: 'advice-brief.md' }, { now }));
  ok(answerGate(dir, 'g1', { channel: 'cli', shownSha256: textSha256(Buffer.from(BRIEF)), decision: 'approved', actor: 'fixture', tty: true }, { now }));
  appendEvent(dir, 'sent', { gate: 'g1', run: 'fixture' }, { now });
  ok(requestGate(dir, { ...common, textPath: 'advice-brief-2.md' }, { now }));
  ok(answerGate(dir, 'g2', { channel: 'elicitation', shownSha256: textSha256(Buffer.from(OTHER)), decision: 'declined', actor: null, reason: 'not now', tty: null }, { now }));
  appendEvent(dir, 'stopped', { by: 'user' }, { now });
}

export function writeGateFixtures(root) {
  for (const name of ['run-ok', 'run-tampered', 'run-torn']) {
    if (existsSync(join(root, name))) throw new Error(`${join(root, name)} exists; move it aside before regenerating`);
  }
  writeOk(join(root, 'run-ok'));

  writeOk(join(root, 'run-tampered'));
  const ledger = join(root, 'run-tampered', 'gate-ledger.jsonl');
  const lines = readFileSync(ledger, 'utf8').split('\n');
  if (!lines[4].includes('"decision":"declined"')) throw new Error('line 5 is not the declined answer');
  lines[4] = lines[4].replace('"decision":"declined"', '"decision":"approved"');
  writeFileSync(ledger, lines.join('\n'));
  const g2 = join(root, 'run-tampered', 'gates', 'g2.json');
  const rec = JSON.parse(readFileSync(g2, 'utf8'));
  rec.status = 'approved'; rec.answer.decision = 'approved';
  writeFileSync(g2, `${JSON.stringify(rec, null, 2)}\n`);

  writeOk(join(root, 'run-torn'));
  appendFileSync(join(root, 'run-torn', 'gate-ledger.jsonl'), '{"schema":"gate-ledger/1","seq":7,"prev":"');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'test', 'fixtures', 'gate');
  writeGateFixtures(root);
  console.log(`wrote ${root}/run-ok, run-tampered, run-torn`);
}
