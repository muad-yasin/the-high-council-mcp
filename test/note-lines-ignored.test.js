// Notes lane unit 2, 2a (gate note addendum 1, A3; C&C PASS ON CONDITIONS 15 Okt 2026): parseDisputes strips a writer's NOTE answer lines and returns them as `noteLines`. A stage that is not asked for them ignores them
// BY DESIGN and says so with a count; `council handoff --from-run` prints one stderr line; and a source scan makes a new reader that does neither fail. Offline, $0.
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runChain, setCache, setBudget, noteLinesIgnored } from '../src/chain.js';
import { stripDeclinedWithNotes } from '../src/draft-disputes.js';
import { pickDraft, pickNotesLine, pickNoteLines } from '../src/handoff-from-run.js';

afterEach(() => { setCache(null); setBudget(null); });
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const N = n => `NOTE-TAKEN: N-${String(n).repeat(8)}`;

test('NI-1: noteLinesIgnored prints one count line when there are answer lines and NOTHING when there are none (no existing log changes)', () => {
  const out = [];
  noteLinesIgnored('build', [], l => out.push(l)); noteLinesIgnored('build', undefined, l => out.push(l));
  assert.deepEqual(out, []);
  noteLinesIgnored('dispute', [N(1), N(2)], l => out.push(l));
  assert.equal(out.length, 1);
  assert.match(out[0], /dispute: 2 answer line\(s\) to review notes were in the reply, removed from the text and not recorded/);
});

test('NI-2: a stage that is not asked for them: a builder reply that ends in NOTE lines ships the plan without them and the log names the count', async () => {
  const logs = [];
  setCache({ invalidate() {}, get(label) {
    const text = label === 'build' ? `The worker retries failed requests.\n\nStep one. Step two.\n${N(1)}\n${N(2)}\n` : 'The worker retries failed requests.';
    return { text, provider: 'mock', model: 'm', usage: { input: 0, output: 0 }, usd: 0 };
  } });
  const result = await runChain({ request: 'Write a plan.', runId: 'r-ni', log: l => logs.push(l), config: {
    name: 'fixture-ni', criteria: ['The plan exists.'], maxRounds: 1, seats: { builder: { provider: 'mock', model: 'mock-builder', lab: 'w' }, critics: [{ provider: 'mock', model: 'mock-critic-a', lab: 'a' }] } } });
  assert.equal(String(result.draft ?? result.deliverable ?? '').includes('NOTE-TAKEN'), false, 'no NOTE line in the delivered plan');
  assert.ok(logs.some(l => /build: 2 answer line\(s\) to review notes were in the reply/.test(l)), logs.filter(l => /build/.test(l)).join('\n'));
});

test('NI-3: stripDeclinedWithNotes returns the text and the lines it removed; stripDeclined still returns the text only', () => {
  const text = `Plan.\n\nStep.\nDECLINED: O-11111111: no\n${N(3)}\n`;
  const r = stripDeclinedWithNotes(text);
  assert.deepEqual(r, { draft: 'Plan.\n\nStep.', noteLines: [N(3)] });
});

test('NI-4: council handoff --from-run: the pick reports how many answer lines it removed (one stderr line), the HANDOFF.md banner lines are untouched, a run without any says nothing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ni-run-'));
  writeFileSync(join(dir, 'build.md'), '# Plan\n\nThe first draft.\n');
  writeFileSync(join(dir, 'revise-1.md'), `# Plan\n\nThe revised draft.\n\nDECLINED: O-11111111: not needed\n${N(1)}\n${N(2)}\nThanks.\n`);
  const pick = pickDraft(dir);
  assert.equal(pick.name, 'revise-1.md');
  assert.equal(pick.text.includes('NOTE-TAKEN'), false);
  assert.equal(pick.notesRemoved, 2);
  assert.equal(pickNotesLine(pick), 'note: 2 answer line(s) to review notes were removed from `revise-1.md` (they are not part of the plan).');
  assert.deepEqual(pickNoteLines(pick), [], 'the banner is not changed by it');
  const plain = mkdtempSync(join(tmpdir(), 'ni-plain-'));
  writeFileSync(join(plain, 'build.md'), '# Plan\n\nA draft.\n');
  assert.equal(pickNotesLine(pickDraft(plain)), '');
  assert.equal(pickNotesLine(null), '');
});

// The scan: every src reader of a builder's or reviser's raw text (parseDisputes, stripDeclined, readModelDraft) outside src/draft-disputes.js either reads `noteLines` / uses stripDeclinedWithNotes, or calls
// noteLinesIgnored, within the same statement (this line and the next three), or is named in the allow-table with its reason. A new reader that does none of these fails here.
const ALLOW = { /* file -> { symbol: reason } */
  'old-plan.js': { stripDeclined: 'oldPlanOf reads the FINISHED plan of an earlier run (readPlanOf, hash-checked), strips its declined lines and hands the text on as data (the <earlier-plan> tag, a decision record): the NOTE lines of that plan were recorded or counted when its stage was read; it is not a raw stage reader. Bundle unit, 20 Okt 2026.' },
  'cli.js': { stripDeclined: 'the round-stop plan copy (deliverable-partial.md) reads err.partial.currentDraft, the draft chain.js already parsed (`plan`): its NOTE lines were recorded or counted when the stage that wrote it was read; it is not a raw stage reader. C&C ruling, 18 Okt 2026 (review fix F5).' },
};
test('NI-5 (source scan): every src caller of parseDisputes / stripDeclined / readModelDraft reads noteLines, uses the WithNotes sibling, calls noteLinesIgnored, or is in the allow-table', () => {
  const files = readdirSync(join(root, 'src'), { recursive: true }).filter(f => f.endsWith('.js') && f !== 'draft-disputes.js').map(String);
  const seen = []; const bad = [];
  for (const f of files) {
    const lines = readFileSync(join(root, 'src', f), 'utf8').split('\n');
    lines.forEach((line, i) => {
      const t = line.trim();
      if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*') || /^(import|export)\b/.test(t)) return;
      const m = /\b(parseDisputes|stripDeclined|readModelDraft)\(/.exec(line.replace(/\/\/.*$/, ''));
      if (!m) return;
      seen.push(`${f}:${i + 1}`);
      const window = lines.slice(i, i + 4).join('\n');
      if (/noteLines|noteLinesIgnored\(|stripDeclinedWithNotes/.test(window)) return;
      if (ALLOW[f]?.[m[1]]) return;
      bad.push(`${f}:${i + 1}: ${t.slice(0, 100)}`);
    });
  }
  assert.ok(seen.length >= 8, `the scan found the callers it should (${seen.length})`);
  assert.deepEqual(bad, [], 'a reader of raw model text that neither records nor counts the NOTE lines it strips');
});
