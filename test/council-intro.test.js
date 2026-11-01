// B3 prep (JUDGE, after Astra's review, 1 Nov 2026; his words about the text: "I only saw the suggested shared introduction but I do like it"; about the old opening: "'Your value comes entirely from being harder to satisfy than the model that wrote
// it.' ... That sounds degrading"): the clause leaves EVERY judge prompt THC ships (the critic template, CRITIC_OPENING, CRITIC_OPENING_SELF_REVIEW) and the Council introduction opens every chain's judge system prompt through criticSystem
// (so also the final read, which builds the same text). A-DRAFT. The four exchange prompts (post and answer, round 1 and later) open with it as well (decided later). Offline, $0.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as R from '../src/roles.js';
import { criticPromptFor, finalReadSystemFor, layerDebateSystemFor, layerReplySystemFor } from '../src/stage-system.js';
import { readChainFile } from './helpers/chain-file.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const HEAD = `${R.COUNCIL_INTRO}\n\n`;
const VARIANTS = [undefined, { fencedSource: true }, { criteriaKinds: true }, { selfReview: true }, { severity: true }, { severity: true, severityLedger: true, severityHandler: true }, { blocking_questions: true, pass: true }];

test('the introduction is Astra\'s text with ONE phrase made general ("software-engineering plans" -> "plans"); her original is kept beside it, used by nothing', () => {
  assert.equal(R.COUNCIL_INTRO_ASTRA, "You have a seat in THE HIGH COUNCIL, where LLMs from different labs work together on software-engineering plans. We test the plan against the request and acceptance criteria, examine one another's reasoning, and improve the result through clear, grounded discussion. Bring your own judgment, treat every colleague with dignity, and change your position when the evidence warrants it. Harmony includes candid disagreement, careful listening, and shared responsibility for a sound plan.");
  assert.equal(R.COUNCIL_INTRO, R.COUNCIL_INTRO_ASTRA.replace('LLMs from different labs work together on software-engineering plans', 'LLMs work together on plans'));
});

test('every criticSystem variant (open and closed scope, every freedom, the self-review opening) opens with the introduction and carries no trace of the old clause', () => {
  for (const open of [false, true]) for (const f of VARIANTS) {
    const t = f === undefined ? R.criticSystem(open) : R.criticSystem(open, f);
    assert.ok(t.startsWith(HEAD), JSON.stringify(f));
    assert.equal(t.split(R.COUNCIL_INTRO).length, 2, 'once');
    assert.doesNotMatch(t, /Your value comes entirely|harder to satisfy/);
    assert.ok(t.includes(f?.selfReview ? 'You wrote the draft you are reviewing' : 'You did not write the draft you are reviewing.'));
  }
});

test('the old clause is in no shipped text at all: not in src/, not in the chains, not in the docs', () => {
  const dirs = ['src', 'chains', 'docs', 'config'];
  const hits = [];
  const walk = d => { for (const e of readdirSync(join(root, d), { withFileTypes: true })) { const p = join(d, e.name); if (e.isDirectory()) walk(p); else if (/\.(js|mjs|json|md|html)$/.test(e.name) && /Your value comes entirely/.test(readFileSync(join(root, p), 'utf8'))) hits.push(p); } };
  for (const d of dirs) walk(d);
  assert.deepEqual(hits, []);
});

test('through the one door every panel call goes by (criticPromptFor), a shipped chain\'s judges and the final read open with the introduction, and so do the four exchange prompts (post and answer, round 1 and later)', () => {
  const cfg = readChainFile(root, 'plan-mini-council');
  const seat = cfg.seats.critics[0];
  assert.ok(criticPromptFor(seat, false, undefined, cfg).startsWith(HEAD));
  assert.ok(finalReadSystemFor(seat, cfg).startsWith(HEAD));
  for (const again of [false, true]) {
    assert.ok(layerDebateSystemFor({ ...cfg, layer_debate: { enabled: true } }, seat, again).startsWith(HEAD), `post prompt, ${again ? 'round 2+' : 'round 1'}`);
    assert.ok(layerReplySystemFor({ ...cfg, layer_debate: { enabled: true } }, seat, again).startsWith(HEAD), `answer prompt, ${again ? 'round 2+' : 'round 1'}`);
  }
});

test('the mock provider still tells a judge call from the others now that the first line is the introduction (a mock chain runs to its verdict)', async () => {
  const { runChain, setPromptSpy } = await import('../src/chain.js');
  const seen = []; setPromptSpy(p => seen.push(p));
  try {
    const cfg = readChainFile(root, 'mock');
    const r = await runChain({ request: 'A mock task.', log: () => {}, runId: 'r-intro', config: cfg });
    assert.ok(seen.some(p => /^(panel|critique)-/.test(p.label) && p.system.startsWith(HEAD)), 'a judge call was made with the introduction');
    assert.equal(r.passed, true, 'the mock judges answered as judges (the run reached its verdict)');
  } finally { setPromptSpy(null); }
});
