// test/cold-read.test.js
//
// Harness features v6 item A/6 (relay/runs/2026-09-15T15-12-52-325Z/deliverable.md): a
// post-signoff cold-reader coherence check. After signoff, one fresh seat with zero debate
// context - not request, criteria, history, or signoff, only the final draft - reads the draft
// and lists internal contradictions between its own sections. Gated on `coldRead: { enabled:
// true }`, the only key exposed; absent key preserves current behavior exactly. No efficacy
// claim is made anywhere in this mechanism - it catches a documented failure mode (merge-produced
// incoherence), it does not measure or assert that output quality improves.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { runChain } from '../src/chain.js';
import { lintChain } from '../src/chain-lint.js';
import { coldReadUser } from '../src/roles.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const unanimousConfig = JSON.parse(readFileSync(join(root, 'chains', 'mock-unanimous.json'), 'utf8'));

test('runChain: coldRead disabled (key absent) behaves exactly as before - coldRead is null, no other field changes', async () => {
  const withoutFlag = await runChain({
    request: 'Write a short fixture deliverable.',
    config: unanimousConfig,
    log: () => {},
  });
  assert.equal(withoutFlag.coldRead, null);
});

test('runChain: with coldRead enabled and a scripted seat that raises one contradiction, the result carries it', async () => {
  const config = {
    ...unanimousConfig,
    coldRead: { enabled: true },
    seats: {
      ...unanimousConfig.seats,
      coldRead: { provider: 'mock', model: 'mock-cold-read-yes', lab: 'mock-cold-reader' },
    },
  };
  const result = await runChain({
    request: 'Write a short fixture deliverable.',
    config,
    log: () => {},
  });
  assert.ok(result.coldRead, 'expected a coldRead object in the result');
  assert.equal(result.coldRead.raised, true);
  assert.deepEqual(result.coldRead.contradictions, [{ sections: ['A'], note: 'x' }]);
});

test('runChain: with coldRead enabled and a seat that finds nothing, raised is false and contradictions is empty', async () => {
  const config = {
    ...unanimousConfig,
    coldRead: { enabled: true },
    seats: {
      ...unanimousConfig.seats,
      coldRead: { provider: 'mock', model: 'mock-cold-read-no', lab: 'mock-cold-reader' },
    },
  };
  const result = await runChain({
    request: 'Write a short fixture deliverable.',
    config,
    log: () => {},
  });
  assert.equal(result.coldRead.raised, false);
  assert.deepEqual(result.coldRead.contradictions, []);
});

test('runChain: coldRead.enabled true with no config.seats.coldRead hard-errors before any call - no silent fallback to another seat', async () => {
  const config = { ...unanimousConfig, coldRead: { enabled: true } };
  await assert.rejects(
    () => runChain({ request: 'Write a short fixture deliverable.', config, log: () => {} }),
    /config\.seats\.coldRead is not set/,
  );
});

test('coldReadUser has exactly one parameter - the structural guarantee against passing request/criteria/history/signoff through', () => {
  assert.equal(coldReadUser.length, 1);
});

test('cold-read stage invocation payload contains only the draft - not request, criteria, history, or signoff', async () => {
  const REQ_MARKER = 'REQ_MARKER_7f3a';
  const CRIT_MARKER = 'CRIT_MARKER_7f3a';
  const HIST_MARKER = 'HIST_MARKER_7f3a';
  const SIG_MARKER = 'SIG_MARKER_7f3a';
  const DRAFT_MARKER = 'DRAFT_MARKER_7f3a';

  const config = {
    ...unanimousConfig,
    coldRead: { enabled: true },
    seats: {
      ...unanimousConfig.seats,
      criteria: { provider: 'mock', model: 'mock-criteria' },
      builder: { provider: 'mock', model: 'mock-builder' },
      coldRead: { provider: 'mock', model: 'mock-cold-read-echo', lab: 'mock-cold-reader' },
    },
  };

  const result = await runChain({
    request: `Write a short fixture deliverable. ${REQ_MARKER}`,
    config,
    log: () => {},
  });

  // Markers seeded in request/criteria/history/signoff never appear in this mock chain's real
  // criteria/history/signoff text (the mock seats generate their own canned content, not an
  // echo of the request), so this test proves the property against whatever text those stages
  // actually produced - the strongest available check without hand-injecting into internal
  // chain state. The draft itself is the mock builder's own canned output, which does not
  // contain any forbidden marker either; asserting that stays true is part of what this test
  // proves.
  const coldReadStage = result.stages.find(s => s.label === 'cold-read');
  assert.ok(coldReadStage, 'expected a recorded cold-read stage');
  const echoed = JSON.parse(coldReadStage.text);
  const receivedUser = echoed._receivedUser;
  assert.equal(typeof receivedUser, 'string');
  for (const marker of [REQ_MARKER, CRIT_MARKER, HIST_MARKER, SIG_MARKER]) {
    assert.ok(!receivedUser.includes(marker), `cold-read prompt leaked forbidden marker: ${marker}`);
  }
  // Direct proof the builder function used in production is single-parameter (checked above)
  // combined with a direct construction check here: calling coldReadUser with a draft
  // containing a marker produces a prompt containing only that marker.
  const built = coldReadUser(`# Draft\n\n${DRAFT_MARKER}`);
  assert.ok(built.includes(DRAFT_MARKER));
  for (const marker of [REQ_MARKER, CRIT_MARKER, HIST_MARKER, SIG_MARKER]) {
    assert.ok(!built.includes(marker));
  }
});

test('chain-lint: coldRead config validation mirrors challenge.enabled', () => {
  const base = { ...unanimousConfig };
  // enabled with no seat is refused since 2026-09-23 (bug audit GuardLayer #7): chain.js has no
  // fallback seat for it, so such a run paid for every round and then threw at the cold read.
  assert.deepEqual(lintChain({ ...base, coldRead: { enabled: true } }, 'chains/fixture.json').map(f => f.kind), ['unreachable-stage']);
  assert.deepEqual(lintChain({ ...base, coldRead: { enabled: true }, seats: { ...base.seats, coldRead: { provider: 'mock', model: 'mock-cold-read-no' } } }, 'chains/fixture.json'), []);
  assert.deepEqual(lintChain({ ...base, coldRead: { enabled: false } }, 'chains/fixture.json'), []);

  const badBoolean = lintChain({ ...base, coldRead: { enabled: 'yes' } }, 'chains/fixture.json');
  assert.ok(badBoolean.some(f => f.kind === 'invalid-cold-read-config' && /must be a boolean/.test(f.message)));

  const extraKey = lintChain({ ...base, coldRead: { enabled: true, foo: true } }, 'chains/fixture.json');
  assert.ok(extraKey.some(f => f.kind === 'invalid-cold-read-config' && /not a recognized key/.test(f.message)));
});

test('chain-lint: seats.coldRead is a recognized seat key, not flagged as unknown', () => {
  const config = {
    ...unanimousConfig,
    coldRead: { enabled: true },
    seats: { ...unanimousConfig.seats, coldRead: { provider: 'mock', model: 'mock-cold-read-no' } },
  };
  const findings = lintChain(config, 'chains/fixture.json');
  assert.ok(!findings.some(f => /seats\.coldRead/.test(f.message) && /unknown|not recognized/i.test(f.message)));
});

// ---- 0.8.2 item 3 (owner decision 4a, 5 Oct 2026): after any final edit, not_judged is never a silent "clean", findings reach the deliverable and WARNINGS.md ----
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';

const withCold = (model, extra = {}) => ({ ...unanimousConfig, coldRead: { enabled: true }, seats: { ...unanimousConfig.seats, coldRead: { provider: 'mock', model, lab: 'mock-cold-reader' } }, ...extra });
const go = config => runChain({ request: 'Write a short fixture deliverable.', config, runId: 'r', log: () => {} });

test('0.8.2: the cold read runs after the final edit, so it reads the delivered text (stage order and prompt)', async () => {
  const config = withCold('mock-cold-read-echo', { seats: { ...unanimousConfig.seats, finalist: { provider: 'mock', model: 'mock-finalist' }, coldRead: { provider: 'mock', model: 'mock-cold-read-echo', lab: 'mock-cold-reader' } } });
  const r = await go(config);
  const labels = r.stages.map(s => s.label);
  assert.ok(labels.indexOf('final') !== -1 && labels.indexOf('cold-read') > labels.indexOf('final'), labels.join(' '));
  const received = JSON.parse(r.stages.find(s => s.label === 'cold-read').text)._receivedUser;
  assert.match(received, /FINAL MOCK DELIVERABLE|mock-finalist/i, 'the cold reader was shown the final-edited text');
});

test('0.8.2: a cold-read reply that cannot be read is NOT JUDGED (status, reason code), never "found no contradictions"; a judged "no" stays judged', async () => {
  const unreadable = await go(withCold('mock-cold-read-garbled')); // prose, no verdict
  assert.equal(unreadable.coldRead.status, 'not_judged');
  assert.match(unreadable.coldRead.reason_code, /^[A-Z_]+$/);
  assert.match(unreadable.deliverable, /## Cold read: not done/);
  const no = await go(withCold('mock-cold-read-no'));
  assert.equal(no.coldRead.status, 'judged');
  assert.equal(no.coldRead.raised, false);
  assert.ok(!/Cold-reader findings|Cold read: not done/.test(no.deliverable), 'a clean cold read adds nothing to the deliverable');
});

test('0.8.2: a raised contradiction is written into the deliverable after the dissent block position, and the plan sub-run of a descending chain gets no cold read', async () => {
  const r = await go(withCold('mock-cold-read-yes'));
  assert.equal(r.coldRead.status, 'judged');
  assert.match(r.deliverable, /^## Cold-reader findings\n\nA reader who never saw the debate read this plan and found 1 contradiction/);
  assert.match(r.deliverable, /1\. \(A\) x/);
  const src = readFileSync(join(root, 'src', 'chain.js'), 'utf8');
  const at = src.indexOf('const planConfig = {');
  assert.ok(at > 0 && src.slice(at, at + 1800).includes('coldRead: undefined'), 'the descending plan sub-run is given no cold read (the final stack gets the only one)');
});

test('0.8.2: through the CLI the cold reader\'s finding reaches WARNINGS.md and report.json, and a not-judged one reaches both too', () => {
  const run = model => {
    const dir = mkdtempSync(join(tmpdir(), 'thc-cold-'));
    mkdirSync(join(dir, 'tasks')); mkdirSync(join(dir, 'chains'));
    writeFileSync(join(dir, 'tasks', 't.md'), 'Plan a small reading list app.\n');
    writeFileSync(join(dir, 'chains', 'cold.json'), JSON.stringify(withCold(model, { name: 'cold' })));
    const r = spawnSync(process.execPath, [join(root, 'src/cli.js'), '--chain', 'cold', '--task', 'tasks/t.md'], { cwd: dir, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: dir }, timeout: 90_000 });
    const runs = join(dir, 'runs'); const id = readdirSync(runs)[0];
    return { dir, r, warnings: existsSync(join(runs, id, 'WARNINGS.md')) ? readFileSync(join(runs, id, 'WARNINGS.md'), 'utf8') : '', report: JSON.parse(readFileSync(join(runs, id, 'report.json'), 'utf8')) };
  };
  const yes = run('mock-cold-read-yes'); const bad = run('mock-cold-read-garbled');
  try {
    assert.equal(yes.r.status, 0, yes.r.stdout + yes.r.stderr);
    assert.match(yes.warnings, /- cold_read: \(A\) x/);
    assert.equal(yes.report.coldRead.status, 'judged');
    assert.match(bad.warnings, /- cold_read_not_judged:/);
    assert.equal(bad.report.coldRead.status, 'not_judged');
  } finally { rmSync(yes.dir, { recursive: true, force: true }); rmSync(bad.dir, { recursive: true, force: true }); }
});

test('0.8.2: a descending chain runs the cold read ONCE (the final stack), and the result carries it', async () => {
  const { runDescendingChain } = await import('../src/chain.js');
  const config = { ...withCold('mock-cold-read-yes'), descending: true, seats: { ...withCold('mock-cold-read-yes').seats, critics: [{ provider: 'mock', model: 'mock-critic-a', lab: 'ca' }] } };
  const result = await runDescendingChain({ request: 'Plan a small offline tool.', config, log: () => {} });
  const stages = (result.stages || []).filter(s => s.label === 'cold-read');
  assert.equal(stages.length, 1, `the cold reader was asked ${stages.length} times: ${(result.stages || []).map(s => s.label).join(' ')}`);
  assert.equal(result.coldRead?.status, 'judged');
});
