// The `council tree` verbs' argument discipline (0.8.3 M5b1; PLAN 10.1; C&C M5 defaults 1 and 20): exactly one positional, a dash positional refused, each verb takes only its own options, the global-list options
// `--yes` and `--decline` are refused by the verb itself, a duplicate or valueless option is refused, nothing approves by flag/env/argument, and the tree-only options are refused on every other command.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { DEFAULT_HANDLERS, TREE_ONLY_FLAGS, TREE_VALUE_FLAGS, TREE_VERBS, parseTreeArgs, resolveRoot, treeCommand } from '../src/tree-cli.js';
import { ROOT_ID, newTree } from './helpers/tree-fixture.js';

const cli = join(import.meta.dirname, '..', 'src', 'cli.js');
const io = () => { const stdin = new PassThrough(); const stdout = new PassThrough(); const stderr = new PassThrough(); let o = ''; let e = ''; stdout.on('data', d => { o += d; }); stderr.on('data', d => { e += d; }); return { stdin, stdout, stderr, out: () => o, err: () => e }; };

test('parseTreeArgs: one positional per verb, each verb its own options, and every other shape is an error naming why', () => {
  assert.deepEqual(parseTreeArgs(['approve', 'run-1']), { verb: 'approve', rootArg: 'run-1', flags: {} });
  assert.deepEqual(parseTreeArgs(['decide', 'run-1', '--max-runs', '13']), { verb: 'decide', rootArg: 'run-1', flags: { 'max-runs': '13' } });
  assert.deepEqual(parseTreeArgs(['decide', '--top-up', 'R/M1', 'run-1', '--amount', '2.5']).flags, { 'top-up': 'R/M1', amount: '2.5' }, 'flags and the positional in any order');
  const bad = (args, re) => { const r = parseTreeArgs(args); assert.match(r.error ?? '', re, JSON.stringify(args)); return r; };
  bad([], /needs a verb/); bad(['-x'], /starts with its verb/); bad(['nope', 'r'], /not a tree command/);
  bad(['start', 'r'], /takes no run id/);   // M6 S5 commit 1 (edited, disclosed; old: bad(['start', 'r'], /not part of this build/)): `start` parses now (it makes its own run folder, so it takes no root); M6 S6 had left `start` as the only later verb
  assert.deepEqual(parseTreeArgs(['status', 'run-1']), { verb: 'status', rootArg: 'run-1', flags: {} }); bad(['status'], /needs the root run/); bad(['status', 'a', 'b'], /takes one run/); bad(['status', 'r', '--yes'], /no option approves anything/); bad(['status', 'r', '--max-runs', '3'], /not an option of `council tree status` \(it takes no options\)/); bad(['check', 'r'], /council tree check takes <rootId> <id> pass\|fail/);   // M6 S2 (edited, disclosed): `check` was a later verb ("not part of this build"); it is parsed now, so a bare root is a usage error naming its three arguments
  bad(['approve'], /needs the root run/); bad(['approve', 'a', 'b'], /takes one run/);
  bad(['approve', '-run-1'], /starts with a dash/); bad(['approve', 'r', '-y'], /starts with a dash/);
  bad(['approve', 'r', '--milestone', 'M1'], /not an option of `council tree approve` \(it takes no options\)/);
  bad(['decide', 'r', '--task', 'x'], /not an option of `council tree decide` \(it takes --milestone/);
  bad(['decide', 'r', '--max-runs'], /needs a value/); bad(['decide', 'r', '--max-runs', '--max-depth', '3'], /needs a value/);
  bad(['decide', 'r', '--max-runs', '13', '--max-runs', '14'], /given twice/);
});

test('no option approves: --yes, --approve and the like are refused by the verb itself with a sentence that says why, for every verb, even though --yes is on the CLI\'s global list', () => {
  for (const verb of Object.keys(TREE_VERBS)) {
    for (const a of ['--yes', '--approve', '--force', '--non-interactive', '--confirm', '--no-prompt']) {
      const r = parseTreeArgs([verb, 'run-1', a]);
      assert.match(r.error ?? '', /no option approves anything/, `${verb} ${a}`);
    }
    // M6 S5 commit 1 (edited, disclosed; old: the list below was the same for every verb): `--max-usd` is a SHARED option of `start` (the cap of the tree), so it is a global option for every other verb only
    // ROADMAP 56 (edited, disclosed; old: the list was `['--decline', '--json', '--dry-run', ...(verb === 'start' ? [] : ['--max-usd'])]`): `--dry-run` is a shared FLAG of `start` now, so it is a global option for every other verb only (start's own parse is pinned in S5-C1-1 and tree-start-dryrun.test.js)
    for (const a of ['--decline', '--json', ...(verb === 'start' ? [] : ['--dry-run', '--max-usd', '--pii-gate'])]) assert.match(parseTreeArgs([verb, 'run-1', a]).error ?? '', /not an option of/, `${verb} ${a} is a global option, not this verb's`);
  }
});

test('treeCommand: a usage error prints the usage and exits 2 before anything is read; an unknown run, a symlink and a run with no tree are refused; a good run reaches only its own verb\'s handler, with the parsed flags and the streams', async () => {
  const t = newTree({ cap: 10 });
  const work = t.work; const rootId = ROOT_ID;
  const a = io();
  assert.equal(await treeCommand(['approve', rootId, '--yes'], { work, ...a }), 2);
  assert.match(a.err(), /no option approves anything/); assert.match(a.err(), /usage: council tree approve <rootId>/);
  const b = io(); assert.equal(await treeCommand(['approve', 'run-nope'], { work, ...b }), 2); assert.match(b.err(), /no such run/);
  const dir = mkdtempSync(join(tmpdir(), 'tree-cli-')); mkdirSync(join(dir, 'runs', 'r1'), { recursive: true });
  try {
    const c = io(); assert.equal(await treeCommand(['approve', 'r1'], { work: dir, ...c }), 2); assert.match(c.err(), /holds no tree/);
    assert.deepEqual(resolveRoot(work, rootId), { rootDir: t.rootDir, rootId: rootId }, 'a bare id');
    assert.deepEqual(resolveRoot(work, `runs/${rootId}`), { rootDir: t.rootDir, rootId: rootId }, 'and a path to the folder');
  } finally { rmSync(dir, { recursive: true, force: true }); }
  const seen = [];
  const handlers = Object.fromEntries(Object.keys(DEFAULT_HANDLERS).map(v => [v, async x => { seen.push([v, x.rootId, x.flags, x.work === work, Boolean(x.stdin && x.stdout && x.stderr)]); return 0; }]));
  assert.equal(await treeCommand(['decide', rootId, '--max-children', '5'], { work, ...io(), handlers }), 0);
  assert.deepEqual(seen, [['decide', rootId, { 'max-children': '5' }, true, true]]);
  // M6 S6 (edited, disclosed; old: `status` here: exit 2 "council tree status is not part of this build"): `start` is the verb that is not part of this build now
  // M6 S5 commit 1 (edited, disclosed; old: treeCommand(['start', rootId], ...)): `start` takes no run id now, so the handler-less guard is reached with ['start']; commit 2 flips this assertion (the handler arrives)
  // M6 S5 commit 2 (the pre-registered flip, disclosed): OLD (commit 1) `treeCommand(['start'])` -> exit 2, /council tree start is not part of this build/; NEW the handler exists, so the same call answers its first missing-option refusal. The handler-less guard itself stays pinned by S5-C1-3 (handlers: {})
  const d = io(); assert.equal(await treeCommand(['start'], { work, ...d }), 2, 'a bare start is a usage refusal'); assert.match(d.err(), /council tree start needs --task <file>: the task the root plan answers/);
  for (const [args, re] of [[['--task', 't.md'], /needs --chain <name>: the chain the root plan runs on/], [['--task', 't.md', '--chain', 'c'], /needs --child-chain <name>: the chain every sub-plan runs on/], [['--task', 't.md', '--chain', 'c', '--child-chain', 'k'], /needs --max-usd <usd>: the cap of the whole tree/]]) {
    const e = io(); assert.equal(await treeCommand(['start', ...args], { work, ...e }), 2, args.join(' ')); assert.match(e.err(), re, args.join(' '));
  }
});

test('through the real CLI: the tree verbs run behind the unknown-flag guard, a tree-only option is refused on every other command, and an approval flag exits 2 without reaching anything', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tree-cli-'));
  const run = args => spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', cwd: dir, env: { PATH: process.env.PATH, HOME: dir }, timeout: 90_000 });
  try {
    for (const f of TREE_ONLY_FLAGS) {
      const r = run(['--chain', 'mock', '--task', 'x.md', `--${f}`, '1']);
      assert.equal(r.status, 2, `--${f}: ${r.stderr}`); assert.match(r.stderr, new RegExp(`--${f}: an option of \`council tree\` only`));
    }
    const y = run(['tree', 'approve', 'r1', '--yes']); assert.equal(y.status, 2); assert.match(y.stderr, /no option approves anything/);
    const unk = run(['tree', 'approve', 'r1', '--zzz']); assert.equal(unk.status, 2); assert.match(unk.stderr, /not an option of this command/, 'the global guard answers first for a name nobody knows');
    const none = run(['tree', 'decide', 'nope', '--max-runs', '13']); assert.equal(none.status, 2); assert.match(none.stderr, /no such run/);
    const env = spawnSync(process.execPath, [cli, 'tree', 'approve', 'r1'], { encoding: 'utf8', cwd: dir, env: { PATH: process.env.PATH, HOME: dir, COUNCIL_TREE_APPROVE: '1', COUNCIL_YES: '1', YES: '1' }, timeout: 90_000 });
    assert.equal(env.status, 2); assert.match(env.stderr, /no such run/, 'an environment value changes nothing');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('through the real CLI: the equals form of every tree value option splits like the spaced form (`--max-runs=13` is `--max-runs 13`), and a valueless or doubled one is still refused', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tree-cli-'));
  const run = args => spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', cwd: dir, env: { PATH: process.env.PATH, HOME: dir }, timeout: 90_000 });
  try {
    for (const f of TREE_VALUE_FLAGS) {
      // M6 S5 commit 1 (edited, disclosed; old: every flag here was a `decide` option): `--child-chain` belongs to `start`, which has no root to look up, so for it the check is that the equals form was split (no option refusal), and that it behaves exactly like the spaced form
      const own = TREE_VERBS.start.value.includes(`--${f}`) ? ['start'] : ['decide', 'nope'];
      const eq = run(['tree', ...own, `--${f}=13`]); const sp = run(['tree', ...own, `--${f}`, '13']);
      assert.equal(eq.status, 2, `--${f}=13: ${eq.stderr}`); assert.doesNotMatch(eq.stderr, /not an option|takes no value/, `--${f}=13 was split into the option and its value`);
      // M6 S5 commit 2 (tightened, C&C ruling 4): the handler exists now, so for `start` the split-and-dispatch is proven end to end: the equals form reached the handler, whose first refusal is the missing --task
      if (own[0] === 'decide') assert.match(eq.stderr, /no such run/, `--${f}=13 reached the verb (a root is looked up), not the option refusal`);
      else assert.match(eq.stderr, /council tree start needs --task <file>: the task the root plan answers/, `--${f}=13 reached the start handler`);
      assert.deepEqual([eq.status, eq.stderr], [sp.status, sp.stderr], `--${f}=13 behaves exactly like --${f} 13`);
    }
    const bare = run(['tree', 'decide', 'nope', '--max-runs']); assert.equal(bare.status, 2); assert.match(bare.stderr, /--max-runs needs a value/);
    const twice = run(['tree', 'decide', 'nope', '--max-runs=1', '--max-runs=2']); assert.equal(twice.status, 2); assert.match(twice.stderr, /--max-runs was given twice/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('the tree\'s command and approval modules read no environment variable and no process argument of their own', () => {
  // M6 S5 commit 2 (extended, disclosed): 'tree-start.js' joins the list (its header says it reads no environment variable and parses no argument); commit 3 adds 'run-preflight.js' and 'tree-task-pin.js' (same claim in their headers)
  for (const f of ['tree-cli.js', 'tree-start.js', 'run-preflight.js', 'tree-task-pin.js', 'tree-approve.js', 'tree-frontier.js', 'tree-decide.js', 'tree-close.js', 'tree-decide-stop.js', 'tree-affected.js', 'tree-detect.js', 'tree-obligation.js', 'tree-stop-view.js']) {
    const code = readFileSync(join(import.meta.dirname, '..', 'src', f), 'utf8').split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
    assert.equal(/process\.env|process\.argv|\bargv\b/.test(code), false, f);
  }
});

// ================================================================================================================================================================ M6 S2: the `check` verb's parse (its handler is the next commit)
const badCheck = (args, re) => { const r = parseTreeArgs(args); assert.match(r.error ?? '', re, JSON.stringify(args)); return r; };

test('check: three positionals - the root FIRST, the qualified id, then exactly pass or fail - and no options; the other verbs return exactly the old shape', () => {
  assert.deepEqual(parseTreeArgs(['check', 'run-1', 'R@g1:A1', 'pass']), { verb: 'check', rootArg: 'run-1', args: ['R@g1:A1', 'pass'], flags: {} });
  assert.deepEqual(parseTreeArgs(['check', 'run-1', 'R/M1@g2:C2', 'fail']).args, ['R/M1@g2:C2', 'fail']);
  assert.deepEqual(parseTreeArgs(['approve', 'run-1']), { verb: 'approve', rootArg: 'run-1', flags: {} }, 'the old shape is byte for byte the old shape (no `args` key)');
  for (const a of [['check'], ['check', 'run-1'], ['check', 'run-1', 'R@g1:A1'], ['check', 'run-1', 'R@g1:A1', 'pass', 'extra']]) badCheck(a, /council tree check takes <rootId> <id> pass\|fail/);
  for (const word of ['Pass', 'PASS', 'yes', 'ok', '1', 'passed', '']) badCheck(['check', 'run-1', 'R@g1:A1', word], /the result is exactly pass or fail/);
  badCheck(['check', 'run-1', 'R@g1:A1', '--pass'], /not an option of `council tree check` \(it takes no options\)/);
  badCheck(['check', 'run-1', 'R@g1:A1', 'pass', '--max-runs', '3'], /not an option of `council tree check` \(it takes no options\)/);
});

test('a second positional on approve, decide, resume and stop is still refused (the count is per verb, not loosened)', () => {
  for (const verb of ['approve', 'decide', 'resume', 'stop']) { badCheck([verb, 'run-1', 'extra'], /takes one run \(the root\), not 2/); badCheck([verb, 'run-1', 'extra', 'more'], /takes one run \(the root\), not 3/); }
});

test('no option approves on `check` either: every look-alike is refused with the "no option approves anything" sentence, before and after the positionals; -y is refused earlier by the single-dash rule', () => {
  for (const a of ['--yes', '--y', '--approve', '--force', '--no-prompt', '--non-interactive', '--confirm', '--assume-yes']) {
    badCheck(['check', 'run-1', 'R@g1:A1', 'pass', a], /no option approves anything/);
    badCheck(['check', a, 'run-1', 'R@g1:A1', 'pass'], /no option approves anything/);
  }
  badCheck(['check', 'run-1', 'R@g1:A1', 'pass', '-y'], /starts with a dash/);
});

test('`check` takes no options, so the option lists are unchanged by it (src/cli.js VALUE_FLAGS and every normal run are untouched); S5 commit 1 adds exactly `child-chain` (title edited, disclosed; old: "... start is still a later verb")', () => {
  assert.deepEqual([TREE_VERBS.check.value, TREE_VERBS.check.bool], [[], []]);
  const ten = ['accounting', 'amount', 'close', 'max-children', 'max-depth', 'max-runs', 'milestone', 'obligation', 'stop', 'top-up'];
  // M6 S5 commit 1 (edited, disclosed; old: both lists equal `ten`): `start` adds exactly one tree-only option, `--child-chain`. Its other three (--task, --chain, --max-usd) are `shared`: the CLI's own options, never tree-only
  // budget commit 2 (EDITED, disclosed; old: `eleven` = ten + child-chain): `decide` adds the tree-only VALUE option `--amend-cap`
  // member verb (EDITED, disclosed; old: `eleven` = ten + child-chain + amend-cap): `decide` adds the tree-only VALUE options `--continue-node` and `--finish-node`
  // KEEP (EDITED, disclosed; old: no `keep`): `--keep <node>@g<n>` is a tree-only VALUE option of `decide`
  const eleven = [...ten, 'child-chain', 'amend-cap', 'continue-node', 'finish-node', 'keep'].sort();
  // ROADMAP 57 (EDITED, disclosed; old: both lists equal `eleven`): `--abandon` is the first BOOLEAN tree option: tree-only, so it is in the first list and, taking no value, not in the second
  // CHANGED ACCEPTED (red triage, C&C thcmcp-cd 23 Okt 2026 (run sheet: tree-cli #10, #15, #16 = stale literals). The options added since this test was written: allow-pii-node and --allow-pii (3f26adb, 19 Okt, PII stop unit T-b), allow-size (d21e0df, 20 Okt, Muad's two-way refusal), fresh (a5d818f, 19 Okt, the earlier plan as data), prevail-node and prevail (554f042, 20 Okt, member verb)). OLD: tree-only = eleven + abandon, accept-plan, open-root-stop; value = eleven. NEW: tree-only also allow-pii-node, allow-size, fresh, prevail-node; value also allow-pii-node, allow-size, prevail, prevail-node.
  // CHANGED (gate branch, 23 Okt 2026; found by the gate suite suite-1fb0a496, both tests red with the same assertion and ONE extra name). OLD: no `accept-chain-limits`. NEW: `accept-chain-limits` is in BOTH lists. WHY: lane E's price-limit range added `council tree decide --accept-chain-limits <chain>` (7e8922ba, 23 Okt 2026, a tree-only VALUE option of `decide`, src/tree-cli.js:27); it landed AFTER the integration baseline 0a503c6 these literals were re-checked against (the fixture-B drift check read 38d2a5d..0a503c6 and so could not see it).
  assert.deepEqual([...TREE_ONLY_FLAGS].sort(), [...eleven, 'abandon', 'accept-chain-limits', 'accept-plan', 'open-root-stop', 'allow-pii-node', 'allow-size', 'fresh', 'prevail-node'].sort()); assert.deepEqual([...TREE_VALUE_FLAGS].sort(), [...eleven, 'accept-chain-limits', 'allow-pii-node', 'allow-size', 'prevail', 'prevail-node'].sort());
  badCheck(['start', 'r'], /takes no run id/);   // (status was wired in M6 S6; start parses since M6 S5 commit 1)
});

test('treeCommand on `check`: the real handler refuses on a tree with no such agreement (exit 1, nothing written); through the handlers seam a handler gets the root and `args`, and ONLY positional 1 is read as a root', async () => {
  const t = newTree({ cap: 10 });
  const eventsBefore = readFileSync(join(t.rootDir, 'tree', 'events.jsonl'), 'utf8');
  const a = io();
  // FLIPPED in the verb commit (pre-registered; rulings row 111): DEFAULT_HANDLERS.check exists now, so the real handler runs - on a bare tree it refuses (no agreement), exit 1, nothing written
  assert.equal(typeof DEFAULT_HANDLERS.check, 'function');
  assert.equal(await treeCommand(['check', ROOT_ID, 'R@g1:A1', 'pass'], { work: t.work, ...a }), 1);
  assert.match(a.err(), /no agreement .*R@g1:A1/i); assert.equal(/not part of this build|arrives with the readiness milestone/.test(a.err()), false, 'the handler-less sentence is gone');
  assert.equal(readFileSync(join(t.rootDir, 'tree', 'events.jsonl'), 'utf8'), eventsBefore, 'nothing written');
  const seen = [];
  const handlers = { ...Object.fromEntries(Object.keys(DEFAULT_HANDLERS).map(v => [v, async () => { seen.push([v]); return 0; }])), check: async x => { seen.push(['check', x.rootId, x.args, x.flags, x.work === t.work, Boolean(x.stdin && x.stdout && x.stderr)]); return 0; } };
  assert.equal(await treeCommand(['check', ROOT_ID, 'R@g1:A1', 'fail'], { work: t.work, ...io(), handlers }), 0);
  assert.deepEqual(seen, [['check', ROOT_ID, ['R@g1:A1', 'fail'], {}, true, true]]);
  seen.length = 0;
  assert.equal(await treeCommand(['approve', ROOT_ID], { work: t.work, ...io(), handlers: { ...handlers, approve: async x => { seen.push(Object.keys(x).sort()); return 0; } } }), 0);
  assert.equal(seen[0].includes('args'), false, 'the other verbs get no `args` key');
  // a qualified id given FIRST is read as the root (it has a `/`, so it is a path), refused, and no handler runs
  seen.length = 0; const b = io();
  assert.equal(await treeCommand(['check', 'R/M1@g1:A1', ROOT_ID, 'pass'], { work: t.work, ...b, handlers }), 2);
  assert.match(b.err(), /R\/M1@g1:A1/); assert.deepEqual(seen, []);
});

test('a name every object inherits (toString, constructor, __proto__, hasOwnProperty, valueOf) is not a tree verb: parsed as "not a tree command", and treeCommand never reaches a handler for it (M6 S2: the guard and the lookup both read own names only)', async () => {
  for (const v of ['toString', 'constructor', '__proto__', 'hasOwnProperty', 'valueOf']) {
    assert.match(parseTreeArgs([v, 'r']).error ?? '', /not a tree command/, v);
    assert.match(parseTreeArgs([v, 'r', '--x']).error ?? '', /not a tree command/, `${v} with an option does not throw`);
  }
  const t = newTree({ cap: 10 }); const seen = [];
  const handlers = { approve: async () => { seen.push('approve'); return 0; } };
  for (const v of ['constructor', 'toString']) { const e = io(); assert.equal(await treeCommand([v, ROOT_ID], { work: t.work, ...e, handlers }), 2); assert.match(e.err(), /not a tree command/); }
  assert.deepEqual(seen, []);
});

test('the usage block names `check`, and a verb that parses but has no handler (the seam left it out) answers "not part of this build", exit 2, before the root is read', async () => {
  const t = newTree({ cap: 10 });
  const a = io(); assert.equal(await treeCommand(['check', ROOT_ID], { work: t.work, ...a }), 2);
  assert.match(a.err(), /council tree check takes <rootId> <id> pass\|fail/); assert.match(a.err(), /usage: council tree approve <rootId>/); assert.match(a.err(), /council tree check <rootId> <id> pass\|fail/);
  const b = io(); assert.equal(await treeCommand(['check', 'run-does-not-exist', 'R@g1:A1', 'pass'], { work: t.work, ...b, handlers: {} }), 2);
  assert.match(b.err(), /council tree check is not part of this build/); assert.equal(/no such run/.test(b.err()), false, 'the root was not even looked up');
});

test('`council tree status <rootId>` (M6 S6 wiring): the real handler runs through treeCommand, prints the view and writes NOTHING (every byte under the root run folder is as it was), with no terminal; either module loads first', async () => {
  const t = newTree({ cap: 10 });
  const snapshot = dir => { const out = {}; const walk = p => { for (const n of readdirSync(p).sort()) { const f = join(p, n); if (statSync(f).isDirectory()) { out[`${f}/`] = true; walk(f); } else out[f] = readFileSync(f, 'utf8'); } }; walk(dir); return out; };
  const before = snapshot(t.work);
  const a = io();
  assert.equal(await treeCommand(['status', ROOT_ID], { work: t.work, ...a }), 0, a.err());
  assert.ok(a.out().includes(ROOT_ID), `the view names the tree: ${a.out().slice(0, 200)}`);
  assert.deepEqual(snapshot(t.work), before, 'every byte and every folder under the working folder (the root run folder included) is as it was');
  const { spawnSync: sp } = await import('node:child_process');
  for (const order of [['../src/tree-status.js', '../src/tree-cli.js'], ['../src/tree-cli.js', '../src/tree-status.js']]) {
    const r = sp(process.execPath, ['--input-type=module', '-e', `await import(${JSON.stringify(new URL(order[0], import.meta.url).href)}); const c = await import(${JSON.stringify(new URL(order[1], import.meta.url).href)}); process.stdout.write(typeof (c.DEFAULT_HANDLERS?.status ?? c.statusHandler));`], { encoding: 'utf8' });
    assert.deepEqual([r.status, r.stdout], [0, 'function'], `${order.join(' then ')}: ${r.stderr}`);
  }
});

// ---- M6 S5 commit 1 (the PARSE only; `council tree start` has no handler yet) ----
test('S5-C1-1 parseTreeArgs: `start` takes no run id and four options (--child-chain of its own, --task, --chain, --max-usd shared with a normal run); every other shape is an error naming why', () => {
  assert.deepEqual(parseTreeArgs(['start']), { verb: 'start', rootArg: null, flags: {} }, 'no handler-side check at parse: the missing options are the handler\'s refusal (S5 commit 2)');
  assert.deepEqual(parseTreeArgs(['start', '--task', 't.md', '--chain', 'c', '--max-usd', '5', '--child-chain', 'k']), { verb: 'start', rootArg: null, flags: { task: 't.md', chain: 'c', 'max-usd': '5', 'child-chain': 'k' } });
  assert.deepEqual(parseTreeArgs(['start', '--dry-run', '--task', 't.md', '--chain', 'c', '--child-chain', 'k']), { verb: 'start', rootArg: null, flags: { 'dry-run': true, task: 't.md', chain: 'c', 'child-chain': 'k' } }, '--dry-run is a flag: it takes no value and swallows no neighbour');
  const bad = (args, re) => { const r = parseTreeArgs(args); assert.match(r.error ?? '', re, JSON.stringify(args)); };
  bad(['start', 'x'], /takes no run id: it makes one/); bad(['start', '--task'], /--task needs a value/); bad(['start', '--task', 'a', '--task', 'b'], /--task was given twice/);
  bad(['start', '--max-usd', '5', '--max-usd', '6'], /was given twice/); bad(['start', '--yes'], /no option approves anything/); bad(['start', '--zzz', '1'], /not an option of `council tree start` \(it takes --child-chain, --task, --chain, --max-usd, --pii-gate, --allow-pii, --dry-run\)/);       // CHANGED ACCEPTED (3f26adb, 19 Okt, PII stop unit T-b: `start` takes --allow-pii, shared with a normal run; OLD: ... --pii-gate, --dry-run)
  bad(['start', '-x'], /starts with a dash/);
  // the shared options belong to `start` alone: no other verb takes them (they were never tree-only, and must not become a way into another verb)
  for (const v of ['approve', 'decide', 'resume', 'stop', 'status']) bad([v, 'r', '--task', 't'], /not an option of `council tree /);
  bad(['check', 'r', 'R@g1:A1', 'pass', '--chain', 'c'], /not an option of `council tree check`/);
});

test('S5-C1-2 the option lists: exactly the old ten plus `child-chain` plus the booleans `abandon` and `open-root-stop` are tree-only (ROADMAP 57 and S8-8 EDITED the title, disclosed; a shared option leaking into the list would turn a normal run\'s --task/--chain/--max-usd into a refusal)', () => {
  const old = ['accounting', 'amount', 'close', 'max-children', 'max-depth', 'max-runs', 'milestone', 'obligation', 'stop', 'top-up'];
  // ROADMAP 57 (EDITED, disclosed; old: `[...old, 'child-chain']` for both): `abandon` is the first BOOLEAN tree option, so it is tree-only but takes no value
  // budget commit 2 (EDITED, disclosed; old: no `amend-cap`): `--amend-cap <total>` is a tree-only VALUE option of `decide`
  // 2c (EDITED, disclosed; old: no `accept-plan`): `--accept-plan` is the third BOOLEAN tree option
  // member verb (EDITED, disclosed; old: no `continue-node` / `finish-node`): the two choice flags are tree-only VALUE options of `decide`
  // CHANGED ACCEPTED (red triage, C&C thcmcp-cd 23 Okt 2026 (run sheet: tree-cli #10, #15, #16 = stale literals). The options added since this test was written: allow-pii-node and --allow-pii (3f26adb, 19 Okt, PII stop unit T-b), allow-size (d21e0df, 20 Okt, Muad's two-way refusal), fresh (a5d818f, 19 Okt, the earlier plan as data), prevail-node and prevail (554f042, 20 Okt, member verb)). OLD: neither list had them. NEW: tree-only also allow-pii-node, allow-size, fresh, prevail-node; value also allow-pii-node, allow-size, prevail, prevail-node; `start` shares --allow-pii (a normal run takes it too, so it is in neither list).
  // CHANGED (gate branch, 23 Okt 2026; found by the gate suite suite-1fb0a496, both tests red with the same assertion and ONE extra name). OLD: no `accept-chain-limits`. NEW: `accept-chain-limits` is in BOTH lists. WHY: lane E's price-limit range added `council tree decide --accept-chain-limits <chain>` (7e8922ba, 23 Okt 2026, a tree-only VALUE option of `decide`, src/tree-cli.js:27); it landed AFTER the integration baseline 0a503c6 these literals were re-checked against (the fixture-B drift check read 38d2a5d..0a503c6 and so could not see it).
  assert.deepEqual([...TREE_ONLY_FLAGS].sort(), [...old, 'abandon', 'accept-chain-limits', 'accept-plan', 'amend-cap', 'child-chain', 'continue-node', 'finish-node', 'keep', 'open-root-stop', 'allow-pii-node', 'allow-size', 'fresh', 'prevail-node'].sort());
  assert.deepEqual([...TREE_VALUE_FLAGS].sort(), [...old, 'accept-chain-limits', 'amend-cap', 'child-chain', 'continue-node', 'finish-node', 'keep', 'allow-pii-node', 'allow-size', 'prevail', 'prevail-node'].sort());
  for (const shared of ['task', 'chain', 'max-usd', 'pii-gate', 'allow-pii']) { assert.equal(TREE_ONLY_FLAGS.includes(shared), false, shared); assert.equal(TREE_VALUE_FLAGS.includes(shared), false, shared); }
  // ROADMAP 56 (edited, disclosed; old: `{ value: ['--child-chain'], bool: [], positionals: 0, shared: ['--task', '--chain', '--max-usd'] }`): `--dry-run` is a shared FLAG, a key of its own (every `shared` entry takes a value), and it is in neither derived list asserted above
  // S5b part A commit 2 (edited, disclosed; old: `shared: ['--task', '--chain', '--max-usd']`): `--pii-gate` takes a value and a normal run takes it too, so it is a `shared` option, in neither derived list
  assert.deepEqual(TREE_VERBS.start, { value: ['--child-chain'], bool: [], positionals: 0, shared: ['--task', '--chain', '--max-usd', '--pii-gate', '--allow-pii'], sharedBool: ['--dry-run'] });
  assert.equal(TREE_ONLY_FLAGS.includes('dry-run'), false); assert.equal(TREE_VALUE_FLAGS.includes('dry-run'), false);
});

test('S5-C1-3 `start` is dispatched BEFORE the root is resolved (there is no root folder yet): a handler gets the flags in a work folder with no runs/, and nothing is read or written there', async () => {
  const work = mkdtempSync(join(tmpdir(), 'tree-cli-start-'));
  try {
    const seen = [];
    const handlers = { start: async x => { seen.push(x); return 0; } };
    const d = io();
    assert.equal(await treeCommand(['start', '--task', 't.md', '--chain', 'c', '--max-usd', '5', '--child-chain', 'k'], { work, ...d, handlers }), 0, d.err());
    assert.equal(seen.length, 1); assert.deepEqual(seen[0].flags, { task: 't.md', chain: 'c', 'max-usd': '5', 'child-chain': 'k' });
    assert.equal('rootDir' in seen[0] || 'rootId' in seen[0], false, 'no root was resolved for start'); assert.equal(seen[0].work, work); assert.equal(Boolean(seen[0].stdin && seen[0].stdout && seen[0].stderr), true);
    assert.deepEqual(readdirSync(work), [], 'the dispatch wrote nothing');
    // the seam: a verb parsed with no handler keeps answering plainly, exit 2, before anything is read
    const e = io(); assert.equal(await treeCommand(['start', '--task', 't.md'], { work, ...e, handlers: {} }), 2); assert.match(e.err(), /council tree start is not part of this build/);
  } finally { rmSync(work, { recursive: true, force: true }); }
});

test('S5-C1-4 through the real CLI: `--child-chain` is a tree-only option (refused on a normal run with the tree-only sentence), and a normal --task/--chain/--max-usd run still starts and exits 0', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tree-cli-start-'));
  const run = args => spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', cwd: dir, env: { PATH: process.env.PATH, HOME: dir }, timeout: 90_000 });
  try {
    writeFileSync(join(dir, 'x.md'), '# Task\n\nWrite one sentence about tides.\n');
    const r = run(['--task', 'x.md', '--chain', 'mock', '--child-chain', 'mock']);
    assert.equal(r.status, 2, r.stderr); assert.match(r.stderr, /--child-chain: an option of `council tree` only, not of this command\. Nothing was run and nothing was spent\./);
    assert.equal(readdirSync(dir).includes('runs'), false, 'a refused command made no run folder');
    const ok = run(['--task', 'x.md', '--chain', 'mock', '--max-usd', '5']);
    assert.equal(ok.status, 0, ok.stderr + ok.stdout); assert.equal(readdirSync(join(dir, 'runs')).length, 1, 'the normal run made its one run folder');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
