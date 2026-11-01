// test/stage-isolation.test.js
//
// v6 §3: the guarantee that a role can never reach the panel/critique
// stage. Phase 1 already made this TRUE by construction - applySeatRole
// is only ever called from the debate-stage invoke() - so phase 2's job
// is not "make it true", it's "make it impossible to accidentally stop
// being true". These are source-level guards, not runtime behavior
// tests: the failure mode this guards against is a future edit adding a
// second call site, not today's code being wrong. Each assertion below
// fails loudly (a real assert, not a lint warning) if that happens.
//
// See docs/v6-decisions.md for why this file does NOT also build
// KIMI-3's role-stripped panel-seat projection: the panel-stage prompt
// builders (`criticSystem`, `criticUser`) take no seat/role parameter at
// all today, so there is nothing to strip - and adding one just to
// demonstrate stripping it would create the exact new call site this
// guard exists to prevent, not close it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..');
const chainSrc = readFileSync(join(repoRoot, 'src', 'chain.js'), 'utf8');
const rolesSrc = readFileSync(join(repoRoot, 'src', 'roles.js'), 'utf8');

test('test_stage_split: applySeatRole has exactly one call site in the whole codebase', () => {
  // Every .js file under src/ except seat-role.js itself (its own
  // definition is not a call).
  const callSites = [];
  const walk = dir => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      const st = statSync(p);
      if (st.isDirectory()) { walk(p); continue; }
      if (!name.endsWith('.js') || p.endsWith(join('src', 'seat-role.js'))) continue;
      const src = readFileSync(p, 'utf8');
      const matches = [...src.matchAll(/\bapplySeatRole\s*\(/g)];
      for (const m of matches) callSites.push({ file: p, index: m.index });
    }
  };
  walk(join(repoRoot, 'src'));
  assert.equal(callSites.length, 1, `applySeatRole must be called from exactly one place; found ${callSites.length}: ${callSites.map(c => c.file).join(', ')}`);
  // CHECKER CHANGE (0.8.3 estimator unit, C&C thcmcp-6d): OLD "the one call site must be in src/chain.js"; NEW "in src/stage-system.js, inside debateSystemFor". WHY: the debate system text is now composed in ONE function that both chain.js (the
  // debate stage) and the estimator (src/cost.js, the debate rows) call, so the estimate counts the persona text the seat is really sent; the next test pins who may call that function.
  assert.ok(callSites[0].file.endsWith(join('src', 'stage-system.js')), 'the one call site must be in src/stage-system.js');
  const sys = readFileSync(callSites[0].file, 'utf8');
  assert.match(sys.slice(sys.lastIndexOf('export const debateSystemFor'), sys.indexOf('applySeatRole(', sys.lastIndexOf('export const debateSystemFor')) + 20), /export const debateSystemFor = \(config, seat\) => withHeldNote\(config, applySeatRole\(/, 'and it is the body of debateSystemFor');
});

test('test_stage_split: debateSystemFor (the one applySeatRole call site) is called from the debate stage of chain.js only, not from a panel/critique block', () => {
  // CHECKER CHANGE (see the test above): OLD scanned chain.js for `applySeatRole(` inside the debate-${lab} block; NEW scans chain.js for `debateSystemFor(`, the function that holds the call. The estimator's debate row
  // (src/stage-system.js RULES) is the only other caller and prices a debate row only.
  const sites = [...chainSrc.matchAll(/\bdebateSystemFor\(/g)].map(m => m.index);
  assert.equal(sites.length, 1, 'chain.js calls debateSystemFor exactly once');
  const idx = sites[0];
  const before = chainSrc.slice(Math.max(0, idx - 800), idx);
  const after = chainSrc.slice(idx, idx + 400);
  assert.match(before + after, /label:\s*`debate-\$\{lab\}`/, 'the call site must be inside the debate-${lab} stage block');
  assert.doesNotMatch(before, /label:\s*`panel-/, 'the call site must not be reachable from a panel-labeled block');
  assert.doesNotMatch(before, /label:\s*`critique-/, 'the call site must not be reachable from a critique-labeled block');
});

test('test_stage_split: the panel-stage prompt builders take no seat or role parameter to leak', () => {
  // criticSystem(open) and criticUser({ request, criteria, draft, prior })
  // are the two functions that build every panel/critique-stage prompt
  // (chain.js's panel-${round}-${lab} and critique-${round} call sites
  // both use them). Neither takes a seat, and neither ever mentions
  // "role" in its own definition - confirmed by scanning their exact
  // source spans, not just "role doesn't appear in roles.js" (which
  // would be too broad and could pass by accident).
  // v7 item 4: criticSystem grew a second parameter, `freedoms` (the two opt-in debate-freedoms
  // flags below), so the definition is now a function declaration rather than an arrow assigned
  // to a const. `freedoms` is not a seat and not a role - it is a per-chain config flag, the same
  // shape as `open` - so the guard below still holds; only how the definition is located needed
  // to follow the shape change (indexOf + brace-matched slice, same technique criticUser below
  // already uses, rather than a regex that can silently overshoot).
  const criticSystemStart = rolesSrc.indexOf('export function criticSystem(');
  assert.notEqual(criticSystemStart, -1, 'could not locate the criticSystem definition to check - update this guard if criticSystem moved or was renamed');
  const criticSystemNextExport = rolesSrc.indexOf('\nexport ', criticSystemStart + 10);
  const criticSystemMatch = [rolesSrc.slice(criticSystemStart, criticSystemNextExport)];
  assert.doesNotMatch(criticSystemMatch[0], /\bseat\b/i, 'criticSystem must not reference a seat');
  assert.doesNotMatch(criticSystemMatch[0], /\brole\b/i, 'criticSystem must not reference role in any form');
  assert.doesNotMatch(criticSystemMatch[0], /\bapplySeatRole\b/, 'criticSystem must not call applySeatRole');

  const criticUserStart = rolesSrc.indexOf('export function criticUser(');
  assert.notEqual(criticUserStart, -1, 'could not locate criticUser to check - update this guard if it moved or was renamed');
  // criticUser's own body, up to the next top-level export, is what a
  // panel-stage prompt is actually built from.
  const nextExport = rolesSrc.indexOf('\nexport ', criticUserStart + 10);
  const criticUserBody = rolesSrc.slice(criticUserStart, nextExport === -1 ? undefined : nextExport);
  assert.doesNotMatch(criticUserBody, /\brole\b/i, 'criticUser must not reference role in any form');
  assert.doesNotMatch(criticUserBody, /\bapplySeatRole\b/, 'criticUser must not call applySeatRole');
  // And the function's own parameter destructuring must not accept one -
  // this is the guarantee itself, stated as a signature, not a behavior:
  // there is no parameter for a future edit to wire a role into without
  // first changing this line, which this test would then also catch.
  assert.doesNotMatch(criticUserBody.split('\n')[0], /role/i, 'criticUser\'s parameter list must not accept a role/seat field');
});

test('test_stage_split: applySeatRole is not imported anywhere in src/roles.js', () => {
  assert.doesNotMatch(rolesSrc, /applySeatRole/, 'roles.js (where every prompt, debate and panel, is built) must never import applySeatRole directly - only chain.js\'s debate-stage call site may call it');
});

// B3 prep, JUDGE lane, unit P (a DELIBERATE change to this guard, C&C ruling 1 Nov 2026): this file's header says no role reaches the panel/critique stage. Muad's headings of 28 Okt 2026 (a persona per seat; the persona names of the layer-3 judges)
// and his 1 Nov 2026 amendment on judge personas supersede that for the switch-on case only (chain switch `judge_personas`, seat field `persona`). Every assertion above is unchanged and stays green: applySeatRole still has one call site,
// in the debate stage. The persona is a SECOND route with its own pin, so it cannot spread: one inner function, one composition function, three callers.
test('test_stage_split (judge persona route): withJudgePersona has ONE call site, inside personaSystemFor; personaSystemFor is called from exactly criticPromptFor, layerDebateSystemFor and layerReplySystemFor; nothing else in src/ names either', () => {
  const srcDir = join(repoRoot, 'src'); const files = []; const stack = [srcDir];
  while (stack.length) { const d = stack.pop(); for (const n of readdirSync(d)) { const p = join(d, n); if (statSync(p).isDirectory()) stack.push(p); else if (n.endsWith('.js')) files.push(p); } }
  const callsOf = word => files.flatMap(f => [...readFileSync(f, 'utf8').matchAll(new RegExp(`\\b${word}\\s*\\(`, 'g'))].map(m => ({ f: f.slice(srcDir.length + 1), at: m.index })));
  const stageSrc = readFileSync(join(srcDir, 'stage-system.js'), 'utf8');
  const innerDecl = stageSrc.indexOf('function withJudgePersona(');
  assert.notEqual(innerDecl, -1, 'withJudgePersona is declared in stage-system.js');
  const outerDecl = stageSrc.indexOf('export function personaSystemFor(');
  assert.notEqual(outerDecl, -1, 'personaSystemFor is declared and exported in stage-system.js');
  const inner = callsOf('withJudgePersona').filter(c => !(c.f === 'stage-system.js' && c.at === innerDecl + 'function '.length));
  assert.equal(inner.length, 1, JSON.stringify(inner));
  assert.ok(inner[0].f === 'stage-system.js' && inner[0].at > outerDecl && inner[0].at < outerDecl + 1500, 'the one call is inside personaSystemFor');
  const outer = callsOf('personaSystemFor').filter(c => !(c.f === 'stage-system.js' && c.at === outerDecl + 'export function '.length));
  assert.deepEqual(outer.map(c => c.f), ['stage-system.js', 'stage-system.js', 'stage-system.js'], JSON.stringify(outer));
  for (const name of ['criticPromptFor', 'layerDebateSystemFor', 'layerReplySystemFor']) {
    const at = [`function ${name}(`, `const ${name} =`].map(k => stageSrc.indexOf(k)).find(k => k >= 0);
    assert.ok(at >= 0 && outer.some(c => c.at > at && c.at < at + 900), `${name} calls personaSystemFor`);
  }
});
