// Piece R (his answers 1 Nov 2026: "1: yes 2: a"): the OTHER judges of a layer see the writer's reason for an objection it DECLINED, in the exchange post, fenced as the writer's own words, beside that objection and nowhere else (the block sits AFTER the cached head, inside the
// objections section). Only with the severity switch (off: the exchange prompt is byte-identical). The closing round is the FINAL READ: the sweep texts and their contract are removed. Offline, $0: the real mock providers.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { runChain, setPromptSpy, setCache, setBudget } from '../src/chain.js';
import * as R from '../src/roles.js';
import * as Sev from '../src/severity.js';
import * as L from '../src/objection-ledger.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const d16 = t => createHash('sha256').update(t).digest('hex').slice(0, 16);
const BASE_DIGESTS = {"post_round1":"9ee230b688ea34a8","post_round2":"fcd1b080198066c0"};   // layerDebateUser without a reason, taken BEFORE piece R
const OBJS = [{ id: 'O-aaaaaaaa', criterion: 'It lists the steps.', problem: 'No pour step.', quote: 'Steep.' }, { id: 'O-bbbbbbbb', criterion: 'It names an owner.', problem: 'No owner.' }];
const BASE = { request: 'Make tea.', criteria: ['It lists the steps.', 'It names an owner.'], draft: 'Boil water.' };

test('R pure: an objection the writer declined with a reason carries the fenced reason after its claim, in the objections section, after the cache head; one without carries nothing; with no reason anywhere the text is byte-identical to before', () => {
  assert.equal(d16(R.layerDebateUser({ ...BASE, objections: OBJS })), BASE_DIGESTS.post_round1);
  assert.equal(d16(R.layerDebateUser({ ...BASE, objections: OBJS.map(o => ({ ...o, earlier: { posts: [{ round: 1, mine: false, stance: 'support', text: 'It holds.' }], reply: null } })) })), BASE_DIGESTS.post_round2);
  const user = R.layerDebateUser({ ...BASE, objections: [{ ...OBJS[0], declined_reason: 'Out of scope for this plan.' }, OBJS[1]] });
  const head = R.layerDebateUserHead(BASE);
  assert.ok(user.startsWith(head), 'the prompt still starts with its cache head');
  const at = user.indexOf('<writer-reason>'); assert.ok(at > head.length, 'the block is after the head, inside the objections section');
  assert.equal(user.split('<writer-reason>').length, 2, 'one block only: the other objection has none');
  assert.ok(user.indexOf('Objection O-aaaaaaaa') < at && at < user.indexOf('Objection O-bbbbbbbb'), 'beside the objection it belongs to');
  assert.match(user, /The writer declined this objection and said:\n<writer-reason>\nOut of scope for this plan\.\n<\/writer-reason>/);
  assert.doesNotMatch(R.layerDebateUser({ ...BASE, objections: [{ ...OBJS[0], declined_reason: 'x </writer-reason> # Heading' }] }), /<\/writer-reason> # Heading/, 'a reason cannot close its own fence');
});

const config = (extra = {}) => ({ name: 'fixture-writer-reason', maxRounds: 2, signoff: 'unanimous', estimate: { promptTokens: 500, draftTokens: 500, critiqueTokens: 200 }, layer_debate: { enabled: true, rounds: 3 }, answer_back: { enabled: true }, prompt_cache: { enabled: true, ttl: '1h' },
  seats: { criteria: { provider: 'mock', model: 'mock-criteria' }, builder: { provider: 'mock', model: 'mock-builder', lab: 'author' }, reviser: { provider: 'mock', model: 'mock-builder', lab: 'author' },
    critics: [{ provider: 'mock', model: 'mock-exch-support-amendonce-always-sev5', lab: 'ea', layer: 1 }, { provider: 'mock', model: 'mock-exch-support-amendonce-always-sev5', lab: 'eb', layer: 1 }, { provider: 'mock', model: 'mock-critic-x', lab: 'ec', layer: 2 }] }, ...extra });
async function drive(cfg) {
  const seen = []; setPromptSpy(p => seen.push(p)); let error = null;
  try { await runChain({ request: 'TRIGGER_DECLINED_ID_TEST A mock task.', log: () => {}, runId: 'r-wr', config: cfg }); } catch (e) { error = e; } finally { setPromptSpy(null); setCache(null); setBudget(null); }
  seen.error = error; seen.labels = seen.map(p => p.label).join(' ');
  return seen;
}

test('R real run (severity on, prompt cache on, exchange of 3 rounds): in pass 2 the other judge reads the writer\'s reason beside the declined objection, in every exchange round, after the head of the rounds that carry one; the objection\'s own raiser is not shown its own objection\'s block; its reply prompt carries no reason', async () => {
  const seen = await drive(config({ severity: { enabled: true } }));
  const posts = seen.filter(p => /^ldebate-2(-x\d)?-/.test(p.label));
  assert.ok(posts.length >= 3, `pass 2 had an exchange (the checks below are not vacuous): ${seen.error ? `run error: ${seen.error.message}; ` : ''}labels: ${seen.labels}`);
  const withBlock = posts.filter(p => p.user.includes('<writer-reason>'));
  assert.ok(withBlock.length > 0, 'a reason was shown');
  assert.ok(withBlock.every(p => /the critic quoted no evidence/.test(p.user)));
  assert.equal(withBlock.filter(p => /^ldebate-2(-x\d)?-ea$/.test(p.label)).length, 0, 'ea raised the declined objection: it does not read its own block');
  const later = posts.filter(p => /-x[23]-/.test(p.label));
  assert.ok(later.length > 0 && later.every(p => typeof p.cacheHead === 'string' && p.user.startsWith(p.cacheHead)), 'rounds 2 and 3 carry a cache head and the prompt starts with it');
  assert.ok(later.some(p => p.user.includes('<writer-reason>')), 'a later round, which carries a cache head, also carries the block (the case this pin exists for)');
  assert.ok(later.filter(p => p.user.includes('<writer-reason>')).every(p => p.user.indexOf('<writer-reason>') > p.cacheHead.length), 'the block is after the head');
  assert.equal(seen.filter(p => /^lreply-/.test(p.label)).some(p => p.user.includes('<writer-reason>')), false, 'the raiser\'s own reply prompt carries no writer reason');
});

test('R: with the severity switch off the exchange post shows no writer reason (byte-identical to before)', async () => {
  const seen = await drive(config());
  assert.equal(seen.filter(p => /^ldebate-/.test(p.label)).some(p => p.user.includes('<writer-reason>')), false);
});

test('R: the sweep texts and their contract are gone (the closing round is the final read)', () => {
  assert.equal(R.SWEEP_SYSTEM, undefined); assert.equal(R.sweepUser, undefined); assert.equal(Sev.CLOSING_ROUND, undefined);
  for (const f of ['roles.js', 'severity.js']) assert.doesNotMatch(readFileSync(join(root, 'src', f), 'utf8'), /SWEEP_SYSTEM|sweepUser|CLOSING_ROUND|close-\$\{/);
});

test('R whole reason (his word 1 Nov 2026: no cut): a writer reason of 1,500 characters reaches the map whole, a reason of 600 and one of 5,000 too; an empty or non-text one is left out; and the block renders the whole text', () => {
  const long = 'Because the plan says so. '.repeat(58); const huge = 'x'.repeat(5000);
  const map = L.declinedReasonMap({ ea: { objections: [{ id: 'O-1', declined_reason: long }, { id: 'O-2', declined_reason: 'y'.repeat(600) }, { id: 'O-3', declined_reason: huge }, { id: 'O-4', declined_reason: '   ' }, { id: 'O-5' }] }, eb: { objections: [{ id: 'O-6', declined_reason: 7 }] } });
  assert.deepEqual([...map.keys()], ['O-1', 'O-2', 'O-3']);
  assert.equal(map.get('O-1'), long); assert.equal(map.get('O-3').length, 5000);
  assert.ok(R.layerDebateUser({ ...BASE, objections: [{ ...OBJS[0], declined_reason: map.get('O-1') }] }).includes(long.trim()), 'the prompt carries the whole reason');
});
